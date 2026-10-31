"""The latest-state scanner over a universe of listings.

Each listing's signal state is the engine's replay over the same window the
chart reads (:mod:`.series`), and the engine's ``signal_scan`` filters, counts
and orders them with its stated denominator (one state per signal key). The
states are cached briefly per tenant and universe, because they only change
when a bar finalises; filters then re-run the cheap scan over the cache.

Until the scheduler keeps signal checkpoints server-side (EH-419), a cache miss
replays every series in the universe, bounded in size and concurrency.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from .catalog import Listing
from .chart import NS_PER_MS, Scale
from .gateway import EngineGateway, MarketsRefused, MarketsUnavailable
from .series import SignalSpec, load_series, load_signal
from .timeframes import NS_PER_DAY, wire_timeframe

MAX_UNIVERSE = 500
CONCURRENCY = 8
CACHE_SECONDS = 60.0
NEAR_ATH_RATIO = 0.95


@dataclass(frozen=True)
class ScanQuery:
    timeframe: str
    asset_class: str | None
    quote: str | None
    direction: str | None
    statuses: tuple[str, ...]
    flipped_within_days: int | None
    near_ath: bool
    limit: int


@dataclass(frozen=True)
class ScannedListing:
    listing: Listing
    state: dict[str, Any]
    scale: Scale
    all_time_high: int | None


@dataclass
class StateCache:
    entries: dict[tuple, tuple[float, list[ScannedListing]]] = field(
        default_factory=dict
    )

    def get(self, key: tuple) -> list[ScannedListing] | None:
        cached = self.entries.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            return cached[1]
        return None

    def put(self, key: tuple, value: list[ScannedListing]) -> None:
        self.entries[key] = (time.monotonic(), value)


def universe(listings: list[Listing], query: ScanQuery) -> list[Listing]:
    quote = (query.quote or '').upper()
    return [
        listing
        for listing in listings
        if listing.series
        and (query.asset_class is None or listing.asset_class == query.asset_class)
        and (not quote or listing.quote.upper() == quote)
    ]


async def _scan_one(
    gateway: EngineGateway, listing: Listing, query: ScanQuery, now_ns: int
) -> ScannedListing | None:
    try:
        data = await load_series(gateway, listing, query.timeframe, now_ns)
        replay = await load_signal(gateway, data, SignalSpec(), now_ns)
    except (MarketsUnavailable, MarketsRefused):
        return None
    highs = [bar['high'] for bar in data.final_bars]
    return ScannedListing(
        listing=listing,
        state=replay['state'],
        scale=Scale(data.source.tick_size, data.source.volume_step),
        all_time_high=max(highs) if highs else None,
    )


async def scan_states(
    gateway: EngineGateway, members: list[Listing], query: ScanQuery, now_ns: int
) -> list[ScannedListing]:
    gate = asyncio.Semaphore(CONCURRENCY)

    async def bounded(listing: Listing) -> ScannedListing | None:
        async with gate:
            return await _scan_one(gateway, listing, query, now_ns)

    results = await asyncio.gather(*(bounded(listing) for listing in members))
    return [result for result in results if result is not None]


def _filter(query: ScanQuery, now_ns: int) -> dict[str, Any]:
    wire: dict[str, Any] = {
        'statuses': list(query.statuses),
        'timeframe': wire_timeframe(query.timeframe),
    }
    if query.direction:
        wire['direction'] = query.direction
    if query.flipped_within_days is not None:
        wire['flipped_since'] = now_ns - query.flipped_within_days * NS_PER_DAY
    return wire


def _near_ath(item: ScannedListing) -> bool:
    close = item.state.get('last_close')
    return bool(
        close is not None
        and item.all_time_high
        and close >= NEAR_ATH_RATIO * item.all_time_high
    )


def _row(item: ScannedListing, row: dict[str, Any]) -> dict[str, Any]:
    bps = row.get('change_since_flip_bps')
    flipped = row.get('last_flip_at')
    return {
        **item.listing.public(),
        'key_digest': row['key_digest'],
        'direction': row.get('direction'),
        'data_status': row['data_status'],
        'last_flip_at': None if flipped is None else flipped // NS_PER_MS,
        'change_since_flip_pct': None if bps is None else bps / 100,
        'last_close': item.scale.price(row.get('last_close')),
        'flip_price': item.scale.price(row.get('flip_reference_price')),
        'near_ath': _near_ath(item),
    }


async def run_scan(
    gateway: EngineGateway, scanned: list[ScannedListing], query: ScanQuery, now_ns: int
) -> dict[str, Any]:
    """The engine's scan over the cached states, joined to listing metadata."""

    pool = [item for item in scanned if not query.near_ath or _near_ath(item)]
    by_key = {item.state['key']['digest']: item for item in pool}
    page = await gateway.market(
        'signal_scan',
        request={
            'states': [item.state for item in pool],
            'filter': _filter(query, now_ns),
            'limit': query.limit,
        },
    )
    return {
        'counts': page['counts'],
        'superseded': page.get('superseded', 0),
        'rows': [_row(by_key[row['key_digest']], row) for row in page['rows']],
    }
