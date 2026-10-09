"""HTTP routes of the Markets app, mounted at ``/api/apps/markets``.

Reads are GETs (``kg:read``); creating and revoking a share link are POSTs
(``kg:write``), under the host's ordinary scope, origin and role enforcement.
Every answer carries data from the engine only. An absent engine capability is
a 501/503 with a stated reason; a typed engine refusal is a 422 with its code.
"""

from __future__ import annotations

import re
import time
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Literal, TypeVar

from fastapi import APIRouter, HTTPException, Query
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from .catalog import CatalogCache, Listing, search
from .chart import LAYERS, ChartRequest, build_chart, macro_events
from .gateway import EngineGateway, MarketsRefused, MarketsUnavailable
from .scanner import (
    MAX_UNIVERSE,
    ScanQuery,
    StateCache,
    run_scan,
    scan_states,
    universe,
)
from .series import SeriesData, SignalSpec, load_series, load_signal
from .session import verified_caller
from .snapshots import (
    MAX_SHARE_HOURS,
    ShareNotFound,
    build_draft,
    create_share,
    read_share,
    revoke_share,
)
from .timeframes import TIMEFRAMES, range_start

T = TypeVar('T')
Timeframe = Literal['1m', '15m', '1h', '4h', '12h', '1D', '1W', '1M']
RangeCode = Literal['1M', '3M', '1Y', '5Y', 'all']
AssetClass = Literal[
    'crypto', 'stock', 'etf', 'fund', 'commodity', 'forex', 'index', 'bond', 'other'
]
Direction = Literal['bullish', 'bearish']
DataStatus = Literal['warming', 'valid', 'stale', 'unavailable']
Basis = Literal['raw', 'heikin_ashi']
Layer = Literal['trail', 'flips', 'volume', 'atr', 'sma200', 'macro']
#: A listing id: no path traversal and no leading slash (checked in Python:
#: the validator's regex engine has no lookahead).
_LISTING_ID = re.compile(r'^(?!.*\.\.)[A-Za-z0-9:._@+-][A-Za-z0-9:._/@+-]{0,255}$')


def _listing_id(value: str) -> str:
    if not _LISTING_ID.fullmatch(value):
        raise ValueError('not a listing id')
    return value


ListingId = Annotated[str, AfterValidator(_listing_id)]
_LEASE_ID = r'^share-[A-Za-z0-9_-]{8,64}$'


def _default_layers() -> list[Layer]:
    return ['trail', 'flips', 'volume']


class SourceIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=256)
    url: str = Field(pattern=r'^https?://', max_length=2048)


class NoteIn(BaseModel):
    """A person's note on the analysis: a claim, so it must cite a source."""

    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=2000)
    sources: list[SourceIn] = Field(min_length=1, max_length=16)


class ShareIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    listing_id: ListingId
    timeframe: Timeframe
    range: RangeCode = '1Y'
    layers: list[Layer] = Field(default_factory=_default_layers, max_length=len(LAYERS))
    atr_period: int = Field(default=10, ge=1, le=200)
    multiplier: float = Field(default=3.0, ge=0.5, le=10.0)
    basis: Basis = 'raw'
    notes: list[NoteIn] = Field(default_factory=list, max_length=8)
    hours: int = Field(default=MAX_SHARE_HOURS, ge=1, le=MAX_SHARE_HOURS)


def _now_ns() -> int:
    return time.time_ns()


def _spec(atr_period: int, multiplier: float, basis: str) -> SignalSpec:
    return SignalSpec(atr_period, round(multiplier * 1000), basis)


def _layers(raw: str) -> frozenset[str]:
    chosen = frozenset(part for part in raw.split(',') if part)
    unknown = chosen - set(LAYERS)
    if unknown:
        raise HTTPException(status_code=400, detail='Unknown chart layer')
    return chosen


async def _guarded(call: Awaitable[T]) -> T:
    try:
        return await call
    except MarketsRefused as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except MarketsUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ShareNotFound as error:
        raise HTTPException(
            status_code=404, detail='This share link is not available'
        ) from error


def build_markets_router(gateway_factory: Callable[[], EngineGateway]) -> APIRouter:
    """The Markets routes over one engine gateway (resolved per request)."""

    router = APIRouter(tags=['apps:markets'])
    catalog = CatalogCache()
    states = StateCache()

    async def listings(tenant: str) -> list[Listing]:
        return await catalog.get(tenant, gateway_factory())

    async def find(tenant: str, listing_id: str) -> Listing:
        for listing in await listings(tenant):
            if listing.listing_id == listing_id:
                return listing
        raise HTTPException(status_code=404, detail='Unknown listing')

    @router.get('/status')
    async def status() -> dict[str, Any]:
        available = gateway_factory().supports_markets()
        detail = None if available else 'The engine does not serve market signals yet'
        return {'available': available, 'detail': detail}

    @router.get('/listings')
    async def list_listings(
        q: Annotated[str, Query(max_length=64)] = '',
        asset_class: AssetClass | None = None,
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
    ) -> dict[str, Any]:
        caller = verified_caller()
        every = await _guarded(listings(caller.tenant))
        hits = search(every, q, asset_class, limit)
        return {'listings': [item.public() for item in hits], 'total': len(every)}

    @router.get('/chart')
    async def chart(
        listing: Annotated[ListingId, Query(max_length=256)],
        timeframe: Timeframe = '1D',
        range: RangeCode = '1Y',
        width: Annotated[int, Query(ge=16, le=4096)] = 900,
        layers: Annotated[str, Query(max_length=128)] = 'trail,flips,volume',
        atr_period: Annotated[int, Query(ge=1, le=200)] = 10,
        multiplier: Annotated[float, Query(ge=0.5, le=10.0)] = 3.0,
        basis: Basis = 'raw',
    ) -> dict[str, Any]:
        caller = verified_caller()
        found = await _guarded(find(caller.tenant, listing))
        now = _now_ns()
        request = ChartRequest(
            timeframe,
            range_start(range, now),
            width,
            _layers(layers),
            _spec(atr_period, multiplier, basis),
            now,
        )
        gateway = gateway_factory()
        data = await _guarded(load_series(gateway, found, timeframe, now))
        view, _ = await _guarded(build_chart(gateway, data, request))
        return {'listing': found.public(), 'range': range, **view}

    @router.get('/macro-events')
    async def macro() -> dict[str, Any]:
        verified_caller()
        return {'events': await _guarded(macro_events(gateway_factory()))}

    @router.get('/scanner')
    async def scanner(
        timeframe: Timeframe = '1D',
        asset_class: AssetClass | None = None,
        quote: Annotated[str | None, Query(max_length=16)] = None,
        direction: Direction | None = None,
        status: Annotated[list[DataStatus] | None, Query()] = None,
        flipped_within_days: Annotated[int | None, Query(ge=1, le=3650)] = None,
        near_ath: bool = False,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
    ) -> dict[str, Any]:
        caller = verified_caller()
        query = ScanQuery(
            timeframe,
            asset_class,
            quote,
            direction,
            tuple(status or ()),
            flipped_within_days,
            near_ath,
            limit,
        )
        now = _now_ns()
        members = universe(await _guarded(listings(caller.tenant)), query)
        key = (caller.tenant, timeframe, asset_class, (quote or '').upper())
        scanned = states.get(key)
        if scanned is None:
            gateway = gateway_factory()
            scanned = await _guarded(
                scan_states(gateway, members[:MAX_UNIVERSE], query, now)
            )
            states.put(key, scanned)
        page = await _guarded(run_scan(gateway_factory(), scanned, query, now))
        size = {
            'listings': len(members),
            'scanned': len(scanned),
            'truncated': len(members) > MAX_UNIVERSE,
        }
        return {'timeframe': timeframe, 'universe': size, **page}

    @router.post('/shares')
    async def share(body: ShareIn) -> dict[str, Any]:
        caller = verified_caller()
        found = await _guarded(find(caller.tenant, body.listing_id))
        now = _now_ns()
        gateway = gateway_factory()
        data = await _guarded(load_series(gateway, found, body.timeframe, now))
        draft = await _guarded(_share_draft(gateway, data, body, now))
        created = await _guarded(
            create_share(gateway, caller, draft, now // 1_000_000, body.hours)
        )
        path = f'/apps/markets/share/{created["lease_id"]}'
        return {**created, 'path': path}

    @router.get('/shares/{lease_id}')
    async def shared(lease_id: str) -> dict[str, Any]:
        if not _valid_lease(lease_id):
            raise HTTPException(
                status_code=404, detail='This share link is not available'
            )
        caller = verified_caller()
        gateway = gateway_factory()
        lease, record = await _guarded(
            read_share(gateway, caller, lease_id, _now_ns() // 1_000_000)
        )
        return await _guarded(_shared_view(gateway, caller, lease, record, find))

    @router.post('/shares/{lease_id}/revoke')
    async def revoke(lease_id: str) -> dict[str, Any]:
        if not _valid_lease(lease_id):
            raise HTTPException(
                status_code=404, detail='This share link is not available'
            )
        caller = verified_caller()
        revoked = await _guarded(
            revoke_share(gateway_factory(), caller, lease_id, _now_ns() // 1_000_000)
        )
        if not revoked:
            raise HTTPException(
                status_code=403,
                detail='Only the person who shared this link can revoke it',
            )
        return {'revoked': True}

    return router


async def _share_draft(
    gateway: EngineGateway, data: SeriesData, body: ShareIn, now: int
) -> dict[str, Any]:
    """The snapshot draft for a share: the signal replayed as of now, the final
    bars of the chosen range as its window, and the notes as sourced claims."""

    spec = _spec(body.atr_period, body.multiplier, body.basis)
    replay = await load_signal(gateway, data, spec, now)
    start = range_start(body.range, now)
    shown = [bar for bar in data.final_bars if bar['open_time'] >= start]
    if not shown:
        raise HTTPException(
            status_code=409, detail='No final bars in this range to share'
        )
    window = {
        'from_open': shown[0]['open_time'],
        'to_close': shown[-1]['close_time'],
        'bars': len(shown),
    }
    claims = [
        {
            'text': note.text,
            'author': 'person',
            'sources': [source.model_dump() for source in note.sources],
        }
        for note in body.notes
    ]
    return build_draft(replay, spec.wire(), window, list(body.layers), claims, now)


def _valid_lease(lease_id: str) -> bool:
    return re.fullmatch(_LEASE_ID, lease_id) is not None


async def _shared_view(
    gateway: EngineGateway,
    caller: Any,
    lease: dict[str, Any],
    record: dict[str, Any],
    find: Callable[[str, str], Awaitable[Listing]],
) -> dict[str, Any]:
    """The verified record and its chart rebuilt as of the snapshot's time."""

    draft = record['draft']
    listing = await find(caller.tenant, draft['key']['series']['listing_id'])
    timeframe = _timeframe_code(draft['key']['series']['timeframe'])
    kind = draft['spec']['kind']
    spec = SignalSpec(kind['atr_period'], kind['multiplier_milli'], kind['basis'])
    as_of = int(draft['created_at'])
    data = await load_series(gateway, listing, timeframe, as_of, as_of)
    request = ChartRequest(
        timeframe,
        draft['window']['from_open'],
        900,
        frozenset(draft['layers']),
        spec,
        as_of,
    )
    view, _ = await build_chart(gateway, data, request)
    return {
        'snapshot': record,
        'listing': listing.public(),
        'chart': view,
        'reproduced': view['state']['source_revision'] == draft['source_revision'],
        'expires_at': lease['expires_at_ms'],
        'can_revoke': (lease.get('grant') or {}).get('issued_by') == caller.actor_ref,
    }


def _timeframe_code(wire: dict[str, Any]) -> str:
    for code, candidate in TIMEFRAMES.items():
        if candidate == wire:
            return code
    raise MarketsUnavailable('The snapshot names a timeframe this app does not read')
