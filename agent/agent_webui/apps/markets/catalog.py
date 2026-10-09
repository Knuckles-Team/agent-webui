"""The listing catalog, read from the finance-v1 ABox in the caller's graph.

A ``Listing`` node names its instrument, quote instrument and venue
(``listedInstrument``/``quoteInstrument``/``listedOn``), its listing type and
venue symbol; each ``BarSeries`` node names its listing (``barSeriesOf``), its
timeframe, calendar, price basis, store series id and tick size. Property keys
are read by their finance-v1 local name or full IRI. Nothing here is invented:
a listing without a readable bar series is listed with no timeframes.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from .gateway import EngineGateway
from .timeframes import is_timeframe

KG = 'http://knuckles.team/kg#'
MAX_LISTINGS = 5_000
MAX_SERIES = 20_000
CACHE_SECONDS = 60.0
ASSET_CLASSES = (
    'crypto',
    'stock',
    'etf',
    'fund',
    'commodity',
    'forex',
    'index',
    'bond',
)


@dataclass(frozen=True)
class BarSeriesRef:
    node_id: str
    timeframe: str
    series_id: str
    calendar_id: str
    price_basis: str
    tick_size: Decimal
    volume_step: Decimal


@dataclass(frozen=True)
class Listing:
    listing_id: str
    symbol: str
    name: str
    venue: str
    quote: str
    listing_type: str
    asset_class: str
    series: dict[str, BarSeriesRef] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        return {
            'listing_id': self.listing_id,
            'symbol': self.symbol,
            'name': self.name,
            'venue': self.venue,
            'quote': self.quote,
            'listing_type': self.listing_type,
            'asset_class': self.asset_class,
            'timeframes': sorted(self.series),
        }


def prop(props: dict[str, Any], local: str) -> Any:
    """A finance-v1 property by local name or full IRI."""

    value = props.get(local, props.get(KG + local))
    return value[0] if isinstance(value, list) and value else value


def text(props: dict[str, Any], *locals_: str) -> str:
    for local in locals_:
        value = prop(props, local)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''


def _decimal(value: Any, default: Decimal | None) -> Decimal | None:
    try:
        parsed = Decimal(str(value)) if value is not None else default
    except InvalidOperation:
        return None
    return parsed if parsed is not None and parsed > 0 else None


def series_ref(node_id: str, props: dict[str, Any]) -> BarSeriesRef | None:
    """A bar series the app can read, or ``None`` when it lacks a field."""

    timeframe = text(props, 'barTimeframe')
    tick = _decimal(prop(props, 'tickSize'), None)
    step = _decimal(prop(props, 'volumeStep'), Decimal(1))
    series_id = text(props, 'tsdbSeriesId')
    if not (is_timeframe(timeframe) and tick and step and series_id):
        return None
    return BarSeriesRef(
        node_id=node_id,
        timeframe=timeframe,
        series_id=series_id,
        calendar_id=text(props, 'tradingCalendar') or 'utc-24x7',
        price_basis=text(props, 'priceBasis') or 'trade',
        tick_size=tick,
        volume_step=step,
    )


def _series_by_listing(
    rows: list[tuple[str, dict]],
) -> dict[str, dict[str, BarSeriesRef]]:
    grouped: dict[str, dict[str, BarSeriesRef]] = {}
    for node_id, props in rows:
        ref = series_ref(node_id, props)
        owner = text(props, 'barSeriesOf')
        if ref and owner:
            grouped.setdefault(owner, {})[ref.timeframe] = ref
    return grouped


def _label(props: dict[str, Any], fallback: str) -> str:
    return text(props, 'name', 'label', 'rdfs:label', 'symbol') or fallback


def build_listing(
    node_id: str,
    props: dict[str, Any],
    related: dict[str, dict[str, Any]],
    series: dict[str, BarSeriesRef],
) -> Listing:
    base = related.get(text(props, 'listedInstrument'), {})
    quote = related.get(text(props, 'quoteInstrument'), {})
    venue = related.get(text(props, 'listedOn'), {})
    asset_class = text(base, 'assetClass')
    symbol = text(base, 'symbol') or text(props, 'venueSymbol') or node_id
    return Listing(
        listing_id=node_id,
        symbol=symbol,
        name=_label(base, symbol),
        venue=_label(venue, text(props, 'listedOn')),
        quote=text(quote, 'symbol') or _label(quote, ''),
        listing_type=text(props, 'listingType') or 'spot',
        asset_class=asset_class if asset_class in ASSET_CLASSES else 'other',
        series=series,
    )


async def load_catalog(gateway: EngineGateway) -> list[Listing]:
    listing_rows = await gateway.nodes_by_label('Listing', MAX_LISTINGS)
    series = _series_by_listing(await gateway.nodes_by_label('BarSeries', MAX_SERIES))
    related_ids = sorted(
        {
            text(props, key)
            for _, props in listing_rows
            for key in ('listedInstrument', 'quoteInstrument', 'listedOn')
        }
        - {''}
    )
    related = await gateway.nodes(related_ids)
    return [
        build_listing(node_id, props, related, series.get(node_id, {}))
        for node_id, props in listing_rows
    ]


@dataclass
class CatalogCache:
    """A short per-tenant cache: the catalog changes on ingestion, not per view."""

    entries: dict[str, tuple[float, list[Listing]]] = field(default_factory=dict)

    async def get(self, tenant: str, gateway: EngineGateway) -> list[Listing]:
        cached = self.entries.get(tenant)
        now = time.monotonic()
        if cached and now - cached[0] < CACHE_SECONDS:
            return cached[1]
        listings = await load_catalog(gateway)
        self.entries[tenant] = (now, listings)
        return listings


def _rank(listing: Listing, needle: str) -> int:
    symbol = listing.symbol.upper()
    if needle in (symbol, listing.listing_id.upper()):
        return 0
    if symbol.startswith(needle):
        return 1
    return 2


def search(
    listings: list[Listing], query: str, asset_class: str | None, limit: int
) -> list[Listing]:
    """Listings whose symbol, name or venue contains ``query``, exact symbol
    first, then by symbol and venue so one ticker across venues groups."""

    needle = query.strip().upper()
    hits = [
        listing
        for listing in listings
        if (asset_class is None or listing.asset_class == asset_class)
        and (
            not needle
            or needle in f'{listing.symbol} {listing.name} {listing.venue}'.upper()
        )
    ]
    hits.sort(key=lambda item: (_rank(item, needle), item.symbol, item.venue))
    return hits[:limit]
