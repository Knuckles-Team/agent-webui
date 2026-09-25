"""Chart timeframes and history ranges for the Markets app.

A timeframe code (``1h``, ``4h``, ``1D`` ...) is what the ontology stores on a
``BarSeries`` (``barTimeframe``) and what the browser sends; the engine's wire
form is the tagged ``Timeframe`` object. Ranges bound how much history one
chart request reads before the engine decimates it.
"""

from __future__ import annotations

from typing import Any

NS_PER_DAY = 86_400_000_000_000

#: Browser/ontology code -> engine wire timeframe, finest first.
TIMEFRAMES: dict[str, dict[str, Any]] = {
    '1m': {'unit': 'minutes', 'n': 1},
    '15m': {'unit': 'minutes', 'n': 15},
    '1h': {'unit': 'hours', 'n': 1},
    '4h': {'unit': 'hours', 'n': 4},
    '12h': {'unit': 'hours', 'n': 12},
    '1D': {'unit': 'day'},
    '1W': {'unit': 'week'},
    '1M': {'unit': 'month'},
}

#: Approximate bar width, used only to pick the finest stored series that can
#: be rolled up to a requested timeframe.
_WIDTH_NS: dict[str, int] = {
    '1m': 60_000_000_000,
    '15m': 900_000_000_000,
    '1h': 3_600_000_000_000,
    '4h': 14_400_000_000_000,
    '12h': 43_200_000_000_000,
    '1D': NS_PER_DAY,
    '1W': 7 * NS_PER_DAY,
    '1M': 30 * NS_PER_DAY,
}

#: History range code -> lookback in days (``all`` is unbounded).
RANGES: dict[str, int | None] = {
    '1M': 31,
    '3M': 92,
    '1Y': 366,
    '5Y': 5 * 366,
    'all': None,
}

#: The calendar the engine can roll up without extra calendar data.
UTC_CALENDAR = 'utc-24x7'


def is_timeframe(code: str) -> bool:
    return code in TIMEFRAMES


def wire_timeframe(code: str) -> dict[str, Any]:
    return dict(TIMEFRAMES[code])


def finer_than(source: str, target: str) -> bool:
    """True when bars of ``source`` can roll up into ``target``."""

    return _WIDTH_NS[source] < _WIDTH_NS[target]


def bar_width_ns(code: str) -> int:
    return _WIDTH_NS[code]


def range_start(range_code: str, now_ns: int) -> int:
    """The inclusive lower time bound of a history range (0 for ``all``)."""

    days = RANGES[range_code]
    return 0 if days is None else max(0, now_ns - days * NS_PER_DAY)


def wire_calendar(calendar_id: str) -> dict[str, Any] | None:
    """The engine calendar for a rollup, or ``None`` when this app has no
    calendar data for it (exchange calendars need their session data)."""

    return {'kind': 'utc24x7'} if calendar_id == UTC_CALENDAR else None
