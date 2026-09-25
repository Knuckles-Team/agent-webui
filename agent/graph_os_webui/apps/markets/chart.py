"""The layered chart payload for one listing.

Indicators run in the engine over the full signal window of final bars, the
engine's M4 ``decimate`` thins them to the requested pixel width, and only then
is the display range cut out. This module converts integer ticks and milli-ticks
to prices with the series' tick size and shapes the result for the browser; it
computes no indicator itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .catalog import text
from .gateway import EngineGateway
from .series import SeriesData, SignalSpec, load_signal

NS_PER_MS = 1_000_000
MILLI = Decimal(1000)
ATR_PERIOD = 14
SMA_PERIOD = 200
MAX_MACRO_EVENTS = 500
LAYERS = ('trail', 'flips', 'volume', 'atr', 'sma200', 'macro')


@dataclass(frozen=True)
class ChartRequest:
    timeframe: str
    from_ns: int
    width: int
    layers: frozenset[str]
    spec: SignalSpec
    as_of: int


@dataclass(frozen=True)
class Scale:
    tick: Decimal
    step: Decimal

    def price(self, ticks: int | None) -> float | None:
        return None if ticks is None else float(Decimal(ticks) * self.tick)

    def milli(self, value: int | None) -> float | None:
        return None if value is None else float(Decimal(value) / MILLI * self.tick)

    def volume(self, units: int) -> float:
        return float(Decimal(units) * self.step)


def _ms(ns: int | None) -> int | None:
    return None if ns is None else ns // NS_PER_MS


def _atr_spec() -> dict[str, Any]:
    return {'version': 1, 'kind': {'kind': 'atr', 'period': ATR_PERIOD}}


def _sma_spec() -> dict[str, Any]:
    return {'version': 1, 'kind': {'kind': 'sma', 'period': SMA_PERIOD}}


def _indicator_specs(request: ChartRequest) -> list[tuple[str, dict[str, Any]]]:
    """``(layer, spec)`` pairs; the trailing line is always computed."""

    specs = [('trail', request.spec.wire())]
    if 'atr' in request.layers:
        specs.append(('atr', _atr_spec()))
    if 'sma200' in request.layers:
        specs.append(('sma200', _sma_spec()))
    return specs


async def _indicator_series(
    gateway: EngineGateway, bars: list[dict], specs: list[tuple[str, dict[str, Any]]]
) -> list[list[dict]]:
    if not bars:
        return [[] for _ in specs]
    return [
        list(await gateway.market('indicators', bars=bars, spec=spec))
        for _, spec in specs
    ]


def _bar_row(bar: dict, scale: Scale) -> dict[str, Any]:
    return {
        't': _ms(bar['open_time']),
        'T': _ms(bar['close_time']),
        'o': scale.price(bar['open']),
        'h': scale.price(bar['high']),
        'l': scale.price(bar['low']),
        'c': scale.price(bar['close']),
        'v': scale.volume(bar['volume']),
        'final': bar['status'] == 'final',
    }


def _point_row(point: dict, scale: Scale) -> dict[str, Any] | None:
    value = point['value']
    kind = value.get('kind')
    if kind == 'trail':
        return {
            't': _ms(point['open_time']),
            'value': scale.milli(value['line']),
            'direction': value['direction'],
        }
    if kind == 'line':
        return {'t': _ms(point['open_time']), 'value': scale.milli(value['value'])}
    return None


def _rows(points: list[dict], scale: Scale, from_ns: int) -> list[dict[str, Any]]:
    rows = (
        _point_row(point, scale) for point in points if point['open_time'] >= from_ns
    )
    return [row for row in rows if row is not None]


def flip_row(flip: dict, scale: Scale) -> dict[str, Any]:
    return {
        'event_id': flip['event_id'],
        'from': flip['from'],
        'to': flip['to'],
        'at': _ms(flip['effective_at']),
        'bar_open': _ms(flip['bar_open']),
        'price': scale.price(flip['price']),
        'line': scale.milli(flip['line']),
    }


def state_view(state: dict, scale: Scale, change_bps: int | None) -> dict[str, Any]:
    """The signal state for display; the change since the flip is the engine's
    scanner figure (basis points), so chart and scanner show the same number."""

    return {
        'direction': state.get('direction'),
        'data_status': state['data_status'],
        'last_flip_at': _ms(state.get('last_flip_at')),
        'flip_price': scale.price(state.get('flip_reference_price')),
        'last_close': scale.price(state.get('last_close')),
        'line': scale.milli(state.get('line')),
        'change_since_flip_pct': None if change_bps is None else change_bps / 100,
        'last_bar_close': _ms(state.get('last_bar_close')),
        'source_revision': state['source_revision'],
        'key_digest': state['key']['digest'],
        'indicator_version': state['key']['indicator_version'],
        'param_hash': state['key']['param_hash'],
    }


async def macro_events(gateway: EngineGateway) -> list[dict[str, Any]]:
    """Documented macro events (finance-v1 ``MacroEvent``) with their sources."""

    rows = await gateway.nodes_by_label('MacroEvent', MAX_MACRO_EVENTS)
    events = []
    for node_id, props in rows:
        at = text(props, 'announcedAt')
        events.append(
            {
                'id': node_id,
                'action': text(props, 'policyAction'),
                'announced_at': at,
                'title': text(props, 'name', 'label') or text(props, 'policyAction'),
                'source_url': text(props, 'sourceUrl', 'source_url') or None,
            }
        )
    return [event for event in events if event['action'] and event['announced_at']]


async def scan_change_bps(gateway: EngineGateway, state: dict) -> int | None:
    page = await gateway.market('signal_scan', request={'states': [state], 'limit': 1})
    rows = page.get('rows') or []
    return rows[0].get('change_since_flip_bps') if rows else None


async def _thinned(
    gateway: EngineGateway, final: list[dict], series: list[list[dict]], width: int
) -> dict[str, Any]:
    if len(final) <= width:
        return {
            'bars': final,
            'indicators': series,
            'source_bars': len(final),
            'decimated': False,
        }
    return dict(
        await gateway.market(
            'decimate', request={'bars': final, 'indicators': series, 'width': width}
        )
    )


def _named_rows(
    names: list[str], thinned: list[list[dict]], scale: Scale, from_ns: int
) -> dict[str, list[dict[str, Any]]]:
    named = {
        name: _rows(points, scale, from_ns)
        for name, points in zip(names, thinned, strict=True)
    }
    return {layer: named.get(layer, []) for layer in ('trail', 'atr', 'sma200')}


def _from(rows: list[dict], from_ns: int) -> list[dict]:
    return [row for row in rows if row['open_time'] >= from_ns]


async def build_chart(
    gateway: EngineGateway, data: SeriesData, request: ChartRequest
) -> tuple[dict[str, Any], dict[str, Any]]:
    """``(chart, replay)``: indicators over the whole signal window, cut to the
    display range, then decimated; the replay is kept for snapshots."""

    scale = Scale(data.source.tick_size, data.source.volume_step)
    replay = await load_signal(gateway, data, request.spec, request.as_of)
    specs = _indicator_specs(request)
    full = await _indicator_series(gateway, data.final_bars, specs)
    final = _from(data.final_bars, request.from_ns)
    series = [_from(points, request.from_ns) for points in full]
    chart = await _thinned(gateway, final, series, request.width)
    provisional = [bar for bar in data.bars if bar['status'] != 'final']
    flips = [
        flip_row(flip, scale)
        for flip in replay['current']
        if flip['effective_at'] > request.from_ns
    ]
    change = await scan_change_bps(gateway, replay['state'])
    names = [name for name, _ in specs]
    view = {
        'timeframe': data.timeframe,
        'rolled_up_from': (
            None if data.source.timeframe == data.timeframe else data.source.timeframe
        ),
        'tick_size': str(data.source.tick_size),
        'source_bars': chart['source_bars'],
        'decimated': chart['decimated'],
        'bars': [_bar_row(bar, scale) for bar in [*chart['bars'], *provisional]],
        **_named_rows(names, chart['indicators'], scale, request.from_ns),
        'flips': flips,
        'state': state_view(replay['state'], scale, change),
        'spec': {
            'atr_period': request.spec.atr_period,
            'multiplier': request.spec.multiplier_milli / 1000,
            'basis': request.spec.basis,
        },
    }
    return view, replay
