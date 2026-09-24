"""Bars and the trend signal for one listing at one timeframe.

The engine does all of it: ``resolve`` decodes and resolves the stored bar
versions (as of a point in time when asked), ``rollup`` derives a coarser
timeframe from a finer stored series on the UTC calendar, and
``signal_replay`` projects the trend signal and its flips. The chart and the
scanner both read through :func:`load_signal` over the same
:func:`signal_window`, so they agree exactly on every finalised flip.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .catalog import BarSeriesRef, Listing
from .gateway import EngineGateway, MarketsUnavailable
from .timeframes import (
    NS_PER_DAY,
    bar_width_ns,
    finer_than,
    wire_calendar,
    wire_timeframe,
)

#: How far back the signal reads, per timeframe (``None`` = all history). A
#: fixed window per timeframe is what keeps chart and scanner identical.
_LOOKBACK_DAYS: dict[str, int | None] = {
    '1m': 7,
    '15m': 60,
    '1h': 366,
    '4h': 3 * 366,
    '12h': 5 * 366,
    '1D': None,
    '1W': None,
    '1M': None,
}
_GRID_DIVISOR = 8
_STALE_WIDTHS = 3
_FAR_FUTURE_NS = 2**62


@dataclass(frozen=True)
class SignalSpec:
    """The versioned ATR trailing-line parameters (engine ``super_trend@1``)."""

    atr_period: int = 10
    multiplier_milli: int = 3_000
    basis: str = 'raw'

    def wire(self) -> dict[str, Any]:
        return {
            'version': 1,
            'kind': {
                'kind': 'super_trend',
                'atr_period': self.atr_period,
                'multiplier_milli': self.multiplier_milli,
                'basis': self.basis,
            },
        }


@dataclass(frozen=True)
class SeriesData:
    listing: Listing
    timeframe: str
    source: BarSeriesRef
    identity: dict[str, Any]
    #: Resolved bars: the latest version of each, provisional ones included.
    bars: list[dict[str, Any]]

    @property
    def final_bars(self) -> list[dict[str, Any]]:
        return [bar for bar in self.bars if bar['status'] == 'final']


def signal_window(timeframe: str, now_ns: int) -> tuple[int, int]:
    """``[start, end)`` of the signal's history. The start moves on a grid of
    one eighth of the lookback, so every read within one grid step sees the
    same bars."""

    days = _LOOKBACK_DAYS[timeframe]
    if days is None:
        return 0, _FAR_FUTURE_NS
    lookback = days * NS_PER_DAY
    grid = lookback // _GRID_DIVISOR
    start = ((now_ns - lookback) // grid) * grid
    return max(0, start), _FAR_FUTURE_NS


def _source_for(listing: Listing, timeframe: str) -> BarSeriesRef:
    native = listing.series.get(timeframe)
    if native is not None:
        return native
    finer = [
        ref
        for code, ref in listing.series.items()
        if finer_than(code, timeframe) and wire_calendar(ref.calendar_id)
    ]
    if not finer:
        raise MarketsUnavailable(
            f'{listing.symbol} has no {timeframe} bars and no finer UTC series to roll up'
        )
    return max(finer, key=lambda ref: _order(ref.timeframe))


def _order(code: str) -> int:
    return list(_LOOKBACK_DAYS).index(code)


async def _resolved(
    gateway: EngineGateway,
    ref: BarSeriesRef,
    window: tuple[int, int],
    as_of: int | None,
) -> list[dict[str, Any]]:
    points = await gateway.series_points(ref.series_id, *window)
    if not points:
        return []
    params: dict[str, Any] = {'points': points, 'finality': 'include_provisional'}
    if as_of is not None:
        params['as_of'] = as_of
    return list(await gateway.market('resolve', **params))


async def load_series(
    gateway: EngineGateway,
    listing: Listing,
    timeframe: str,
    now_ns: int,
    as_of: int | None = None,
) -> SeriesData:
    source = _source_for(listing, timeframe)
    window = signal_window(timeframe, now_ns)
    bars = await _resolved(gateway, source, window, as_of)
    if bars and source.timeframe != timeframe:
        bars = await gateway.market(
            'rollup',
            bars=bars,
            calendar=wire_calendar(source.calendar_id),
            timeframe=wire_timeframe(timeframe),
            watermark=as_of if as_of is not None else now_ns,
        )
        # A bounded window starts mid-period: its first rolled bar is partial.
        bars = list(bars)[1:] if window[0] > 0 else list(bars)
    identity = {
        'listing_id': listing.listing_id,
        'price_basis': source.price_basis,
        'timeframe': wire_timeframe(timeframe),
        'calendar_id': source.calendar_id,
    }
    return SeriesData(listing, timeframe, source, identity, bars)


async def load_signal(
    gateway: EngineGateway, data: SeriesData, spec: SignalSpec, as_of: int
) -> dict[str, Any]:
    """The engine's replay as of ``as_of``: ``{state, records, current}``. A
    last final bar older than three bar widths reads as ``stale``."""

    request: dict[str, Any] = {
        'series': data.identity,
        'spec': spec.wire(),
        'records': data.bars,
        'as_of': as_of,
        'stale_after': _STALE_WIDTHS * bar_width_ns(data.timeframe),
    }
    return dict(await gateway.market('signal_replay', request=request))
