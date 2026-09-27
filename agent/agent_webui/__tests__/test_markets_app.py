"""The Markets app routes (EH-420/EH-421) and the apps catalog (EH-429).

The routes run through a real FastAPI app (``build_apps_router``) with a fake
engine client that has the epistemic-graph client's surface (``finance.market``,
``timeseries.range``, ``nodes.*``, ``control_leases.*``). The fake answers each
``FinanceMarket`` op with the documented result shape and records every call, so
the tests prove what the app asks the engine for -- it computes no finance math
itself -- and how it shapes, caches, verifies and refuses.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from agent_webui.apps import AppBackend, build_apps_router
from agent_webui.apps.markets import EngineGateway, build_markets_router
from fastapi import FastAPI
from fastapi.testclient import TestClient

DAY = 86_400_000_000_000
START = 20_000 * DAY
LISTING = 'listing:binance:SOLUSDT:spot'


def _bar(index: int, status: str = 'final') -> dict[str, Any]:
    close = 10_000 + (index * 37) % 500
    return {
        'open_time': START + index * DAY,
        'close_time': START + (index + 1) * DAY,
        'open': close - 5,
        'high': close + 20,
        'low': close - 20,
        'close': close,
        'volume': 7,
        'status': status,
        'revision': 0,
        'known_at': START + (index + 1) * DAY,
    }


def _range_rows(bars: list[dict[str, Any]], series_id: str, frm: int, to: int) -> list:
    return [
        (bar['open_time'], [float(len(series_id))])
        for bar in bars
        if frm <= bar['open_time'] <= to
    ]


def _state(key_digest: str, direction: str = 'bullish') -> dict[str, Any]:
    return {
        'key': {
            'series': {'listing_id': LISTING},
            'indicator_version': 'super_trend@1',
            'param_hash': 'sha256:' + '1' * 64,
            'digest': key_digest,
        },
        'direction': direction,
        'data_status': 'valid',
        'line': 9_500_000,
        'last_close': 10_300,
        'last_bar_close': START + 40 * DAY,
        'last_flip_at': START + 30 * DAY,
        'flip_reference_price': 10_000,
        'source_revision': 'sha256:' + '2' * 64,
    }


class _Namespace:
    def __init__(self, **methods: Any) -> None:
        for name, method in methods.items():
            setattr(self, name, method)


class FakeEngine:
    """The engine client surface the Markets gateway reaches."""

    def __init__(self, bars: int = 60, finance: bool = True) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.bars = [_bar(i) for i in range(bars)] + [_bar(bars, 'provisional')]
        self.nodes_store: dict[str, dict[str, Any]] = _catalog()
        self.leases: dict[str, dict[str, Any]] = {}
        self.nodes = _Namespace(
            list_by_label=self._by_label,
            properties_batch=self._batch,
            properties=self._props,
            create_if_absent=self._create,
        )
        self.timeseries = _Namespace(range=self._range)
        self.control_leases = _Namespace(
            issue=self._issue, get=self._get, transition=self._transition
        )
        if finance:
            self.finance = _Namespace(market=self._market)

    def ops(self) -> list[str]:
        return [op for op, _ in self.calls]

    async def _by_label(self, label: str, limit: int) -> list:
        rows = [(k, v) for k, v in self.nodes_store.items() if v.get('type') == label]
        return rows[:limit]

    async def _batch(self, ids: list[str]) -> dict:
        return {node_id: self.nodes_store.get(node_id) for node_id in ids}

    async def _props(self, node_id: str) -> dict | None:
        return self.nodes_store.get(node_id)

    async def _create(self, node_id: str, props: dict) -> bool:
        created = node_id not in self.nodes_store
        self.nodes_store.setdefault(node_id, props)
        return created

    async def _range(self, series_id: str, frm: int, to: int) -> list:
        return _range_rows(self.bars, series_id, frm, to)

    async def _issue(self, **request: Any) -> dict:
        view = {**request, 'status': 'active', 'revision': 1}
        self.leases[request['lease_id']] = view
        return {'outcome': 'issued', 'lease': view}

    async def _get(self, *, tenant: str, lease_id: str) -> dict | None:
        lease = self.leases.get(lease_id)
        return lease if lease and lease['tenant'] == tenant else None

    async def _transition(self, **request: Any) -> dict:
        lease = self.leases[request['lease_id']]
        lease['status'] = request['to']
        return {'outcome': 'applied', 'lease': lease}

    async def _market(self, op: str, **params: Any) -> Any:
        self.calls.append((op, params))
        return _ANSWERS[op](self, params)


def _catalog() -> dict[str, dict[str, Any]]:
    return {
        LISTING: {
            'type': 'Listing',
            'listedInstrument': 'instrument:SOL',
            'quoteInstrument': 'instrument:USDT',
            'listedOn': 'venue:binance',
            'listingType': 'spot',
            'venueSymbol': 'SOLUSDT',
        },
        'listing:kraken:SOLUSD:spot': {
            'type': 'Listing',
            'listedInstrument': 'instrument:SOL',
            'quoteInstrument': 'instrument:USD',
            'listedOn': 'venue:kraken',
            'venueSymbol': 'SOLUSD',
        },
        'instrument:SOL': {'symbol': 'SOL', 'name': 'Solana', 'assetClass': 'crypto'},
        'instrument:USDT': {'symbol': 'USDT', 'name': 'Tether'},
        'instrument:USD': {'symbol': 'USD', 'name': 'US dollar'},
        'venue:binance': {'name': 'Binance'},
        'venue:kraken': {'name': 'Kraken'},
        'series:sol:1D': {
            'type': 'BarSeries',
            'barSeriesOf': LISTING,
            'barTimeframe': '1D',
            'tradingCalendar': 'utc-24x7',
            'priceBasis': 'trade',
            'tsdbSeriesId': 'bars/sol/1D',
            'tickSize': '0.01',
        },
        'series:sol:kraken': {
            'type': 'BarSeries',
            'barSeriesOf': 'listing:kraken:SOLUSD:spot',
            'barTimeframe': '1D',
            'tsdbSeriesId': 'bars/solusd/1D',
        },
        'macro:fomc': {
            'type': 'MacroEvent',
            'policyAction': 'hold',
            'announcedAt': '2026-09-17T18:00:00Z',
            'sourceUrl': 'https://www.federalreserve.gov/',
        },
    }


def _indicator(engine: FakeEngine, params: dict) -> list:
    kind = params['spec']['kind']['kind']
    value = (
        {'kind': 'trail', 'line': 9_900_000, 'atr': 100_000, 'direction': 'bullish'}
        if kind == 'super_trend'
        else {'kind': 'line', 'value': 50_000}
    )
    return [
        {'open_time': b['open_time'], 'close_time': b['close_time'], 'value': value}
        for b in params['bars']
    ]


def _decimate(engine: FakeEngine, params: dict) -> dict:
    request = params['request']
    keep = request['bars'][:: max(1, len(request['bars']) // request['width'] + 1)]
    kept = {bar['open_time'] for bar in keep}
    series = [[p for p in s if p['open_time'] in kept] for s in request['indicators']]
    return {
        'bars': keep,
        'indicators': series,
        'source_bars': len(request['bars']),
        'decimated': True,
    }


def _scan(engine: FakeEngine, params: dict) -> dict:
    states = params['request']['states']
    rows = [
        {
            'key_digest': s['key']['digest'],
            'listing_id': s['key']['series']['listing_id'],
            'direction': s['direction'],
            'data_status': s['data_status'],
            'last_flip_at': s['last_flip_at'],
            'flip_reference_price': s['flip_reference_price'],
            'last_close': s['last_close'],
            'change_since_flip_bps': 300,
        }
        for s in states
    ]
    bullish = sum(1 for s in states if s['direction'] == 'bullish')
    counts = {
        'total': len(states),
        'bullish': bullish,
        'bearish': len(states) - bullish,
    }
    return {
        'rows': rows[: params['request']['limit']],
        'counts': counts,
        'superseded': 0,
    }


def _replay(engine: FakeEngine, params: dict) -> dict:
    listing = params['request']['series']['listing_id']
    digest = 'sha256:' + hashlib.sha256(listing.encode()).hexdigest()
    state = _state(digest)
    state['key']['series'] = params['request']['series']
    flip = {
        'event_id': 'sha256:' + '3' * 64,
        'key_digest': digest,
        'from': 'bearish',
        'to': 'bullish',
        'bar_open': START + 29 * DAY,
        'effective_at': START + 30 * DAY,
        'observed_at': START + 30 * DAY,
        'price': 10_000,
        'line': 9_800_000,
        'bar_revision': 0,
    }
    return {'state': state, 'records': [], 'current': [flip]}


def _seal(engine: FakeEngine, params: dict) -> dict:
    draft = params['draft']
    if any(not claim['sources'] for claim in draft.get('claims', [])):
        raise RuntimeError(
            'engine error: UNSOURCED_CLAIM: every claim must cite a source'
        )
    body = json.dumps(draft, sort_keys=True).encode()
    return {
        'digest': 'sha256:' + hashlib.sha256(body).hexdigest(),
        'draft': draft,
        'notices': {
            'version': 1,
            'informational_only': 'i',
            'hallucination': 'h',
            'mechanical_trigger': 'm',
        },
        'informational_only': True,
        'excludes_positions': True,
    }


_ANSWERS: dict[str, Any] = {
    'resolve': lambda engine, params: engine.bars,
    'rollup': lambda engine, params: engine.bars[::7],
    'indicators': _indicator,
    'decimate': _decimate,
    'signal_scan': _scan,
    'signal_replay': _replay,
    'analysis_snapshot': _seal,
}


async def _invoke(method: Any, *args: Any, deadline: float, **kwargs: Any) -> Any:
    return await method(*args, **kwargs)


def _client(engine: FakeEngine | None) -> TestClient:
    def gateway() -> EngineGateway:
        return EngineGateway(client_provider=lambda: engine, invoke=_invoke)

    app = FastAPI()
    backend = AppBackend(
        app_id='markets',
        router=build_markets_router(gateway),
        available=lambda: gateway().supports_markets(),
        unavailable_reason='no market signals',
    )
    app.include_router(build_apps_router([backend]))
    return TestClient(app)


def _session(tenant: str | None = 'tenant-a', actor: str = 'alice'):
    session = None
    if tenant is not None:
        session = MagicMock()
        session.tenant = tenant
        session.actor.actor_id = actor
    return patch(
        'agent_utilities.knowledge_graph.core.session.current_session',
        return_value=session,
    )


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


def test_the_apps_catalog_states_availability() -> None:
    assert _client(FakeEngine()).get('/api/apps').json() == {
        'apps': [{'id': 'markets', 'available': True, 'detail': None}]
    }
    absent = _client(FakeEngine(finance=False)).get('/api/apps').json()['apps'][0]
    assert absent == {
        'id': 'markets',
        'available': False,
        'detail': 'no market signals',
    }


def test_search_ranks_the_exact_symbol_and_reads_series_only_with_a_tick_size(
    engine: FakeEngine,
) -> None:
    with _session():
        body = _client(engine).get('/api/apps/markets/listings?q=sol').json()
    assert body['total'] == 2
    first, second = body['listings']
    assert (first['symbol'], first['venue'], first['quote']) == (
        'SOL',
        'Binance',
        'USDT',
    )
    assert first['asset_class'] == 'crypto' and first['timeframes'] == ['1D']
    assert second['venue'] == 'Kraken' and second['timeframes'] == []
    with _session():
        none = (
            _client(engine).get('/api/apps/markets/listings?asset_class=stock').json()
        )
    assert none['listings'] == []


def test_a_chart_is_engine_computed_scaled_by_tick_size_and_decimated(
    engine: FakeEngine,
) -> None:
    with _session():
        body = (
            _client(engine)
            .get(
                f'/api/apps/markets/chart?listing={LISTING}&range=all&width=16&layers=trail,flips,atr'
            )
            .json()
        )
    assert engine.ops() == [
        'resolve',
        'signal_replay',
        'indicators',
        'indicators',
        'decimate',
        'signal_scan',
    ]
    assert body['decimated'] is True and body['source_bars'] == 60
    assert body['bars'][-1]['final'] is False
    assert body['bars'][0]['c'] == pytest.approx(100.0)
    assert body['trail'][0] == {
        't': START // 1_000_000,
        'value': pytest.approx(99.0),
        'direction': 'bullish',
    }
    assert body['atr'] and body['sma200'] == []
    assert body['flips'][0]['price'] == pytest.approx(100.0)
    assert body['state']['change_since_flip_pct'] == pytest.approx(3.0)
    assert body['state']['last_close'] == pytest.approx(103.0)


def test_a_chart_that_fits_is_not_decimated(engine: FakeEngine) -> None:
    with _session():
        body = (
            _client(engine)
            .get(f'/api/apps/markets/chart?listing={LISTING}&range=all&width=900')
            .json()
        )
    assert 'decimate' not in engine.ops()
    assert body['decimated'] is False and len(body['bars']) == 61


def test_a_coarser_timeframe_is_rolled_up_by_the_engine(engine: FakeEngine) -> None:
    with _session():
        body = (
            _client(engine)
            .get(f'/api/apps/markets/chart?listing={LISTING}&timeframe=1W&range=all')
            .json()
        )
    rollup = dict(engine.calls)['rollup']
    assert rollup['calendar'] == {'kind': 'utc24x7'}
    assert rollup['timeframe'] == {'unit': 'week'}
    assert body['rolled_up_from'] == '1D' and body['timeframe'] == '1W'


def test_unknown_listings_layers_and_sessions_are_refused(engine: FakeEngine) -> None:
    client = _client(engine)
    with _session():
        assert client.get('/api/apps/markets/chart?listing=nope').status_code == 404
        traversal = client.get('/api/apps/markets/chart?listing=listing:../../x')
        assert traversal.status_code == 422
        bad = client.get(f'/api/apps/markets/chart?listing={LISTING}&layers=trail,rsi')
        assert bad.status_code == 400
    with _session(None):
        assert client.get('/api/apps/markets/listings').status_code == 401


def test_an_absent_engine_is_a_stated_absence() -> None:
    with _session():
        response = _client(None).get('/api/apps/markets/listings')
    assert response.status_code == 503


def test_the_scanner_replays_once_then_filters_the_cached_states(
    engine: FakeEngine,
) -> None:
    client = _client(engine)
    with _session():
        body = client.get('/api/apps/markets/scanner?timeframe=1D').json()
        again = client.get(
            '/api/apps/markets/scanner?timeframe=1D&direction=bullish'
        ).json()
    assert engine.ops().count('signal_replay') == 1
    assert body['universe'] == {'listings': 1, 'scanned': 1, 'truncated': False}
    assert body['counts']['bullish'] == 1
    row = body['rows'][0]
    assert row['symbol'] == 'SOL' and row['change_since_flip_pct'] == pytest.approx(3.0)
    assert again['rows'][0]['listing_id'] == LISTING
    assert (
        dict(engine.calls)['signal_scan']['request']['filter']['direction'] == 'bullish'
    )


def test_near_ath_keeps_only_listings_close_to_their_high(engine: FakeEngine) -> None:
    with _session():
        body = _client(engine).get('/api/apps/markets/scanner?near_ath=true').json()
    assert [row['near_ath'] for row in body['rows']] == [True]


def _share(client: TestClient, **extra: Any):
    return client.post(
        '/api/apps/markets/shares',
        json={'listing_id': LISTING, 'timeframe': '1D', 'range': 'all', **extra},
    )


def test_a_share_is_sealed_stored_leased_and_verified_on_read(
    engine: FakeEngine,
) -> None:
    client = _client(engine)
    note = {
        'text': 'Volume rose into the flip.',
        'sources': [{'title': 'v', 'url': 'https://example.org'}],
    }
    with _session():
        created = _share(client, notes=[note]).json()
        shared = client.get(f'/api/apps/markets/shares/{created["lease_id"]}').json()
    lease = engine.leases[created['lease_id']]
    assert (
        lease['kind'] == 'share.read' and lease['grant']['digest'] == created['digest']
    )
    node = engine.nodes_store[lease['grant']['snapshot']]
    assert node['type'] == 'AnalysisSnapshot' and node['analysisOf'] == LISTING
    assert created['path'] == f'/apps/markets/share/{created["lease_id"]}'
    assert shared['snapshot']['digest'] == created['digest']
    assert shared['snapshot']['draft']['claims'][0]['author'] == 'person'
    assert shared['reproduced'] is True and shared['can_revoke'] is True
    assert shared['chart']['flips'][0]['to'] == 'bullish'


def test_a_tampered_expired_or_foreign_share_is_not_available(
    engine: FakeEngine,
) -> None:
    client = _client(engine)
    with _session():
        lease_id = _share(client).json()['lease_id']
    lease = engine.leases[lease_id]
    node = engine.nodes_store[lease['grant']['snapshot']]
    with _session('tenant-b'):
        assert client.get(f'/api/apps/markets/shares/{lease_id}').status_code == 404
    record = json.loads(node['record'])
    record['draft']['last_close'] = 1
    node['record'] = json.dumps(record)
    with _session():
        assert client.get(f'/api/apps/markets/shares/{lease_id}').status_code == 404
    lease['expires_at_ms'] = 1
    with _session():
        assert client.get(f'/api/apps/markets/shares/{lease_id}').status_code == 404
        assert client.get('/api/apps/markets/shares/not-a-lease').status_code == 404


def test_only_the_issuer_revokes_and_a_revoked_share_is_gone(
    engine: FakeEngine,
) -> None:
    client = _client(engine)
    with _session(actor='alice'):
        lease_id = _share(client).json()['lease_id']
    with _session(actor='mallory'):
        denied = client.post(f'/api/apps/markets/shares/{lease_id}/revoke')
        assert denied.status_code == 403
        assert (
            client.get(f'/api/apps/markets/shares/{lease_id}').json()['can_revoke']
            is False
        )
    with _session(actor='alice'):
        assert client.post(f'/api/apps/markets/shares/{lease_id}/revoke').json() == {
            'revoked': True
        }
        assert client.get(f'/api/apps/markets/shares/{lease_id}').status_code == 404


def test_notes_need_sources_and_an_engine_refusal_keeps_its_code(
    engine: FakeEngine,
) -> None:
    client = _client(engine)
    with _session():
        unsourced = _share(client, notes=[{'text': 'trust me', 'sources': []}])
        assert unsourced.status_code == 422
        with patch.dict(_ANSWERS, {'analysis_snapshot': _refuse}):
            refused = _share(client)
    assert refused.status_code == 422
    assert refused.json()['detail'].startswith('UNSOURCED_CLAIM:')


def _refuse(engine: FakeEngine, params: dict) -> dict:
    raise RuntimeError(
        'remote: UNSOURCED_CLAIM: every claim must cite at least one source'
    )


def test_macro_events_carry_their_source(engine: FakeEngine) -> None:
    with _session():
        events = _client(engine).get('/api/apps/markets/macro-events').json()['events']
    assert events == [
        {
            'id': 'macro:fomc',
            'action': 'hold',
            'announced_at': '2026-09-17T18:00:00Z',
            'title': 'hold',
            'source_url': 'https://www.federalreserve.gov/',
        }
    ]
