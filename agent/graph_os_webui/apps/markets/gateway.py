"""The Markets app's one seam to the engine.

Every engine call the app makes goes through :class:`EngineGateway`: the
``FinanceMarket`` ops (all finance math), the time-series store (bars), graph
nodes (the finance-v1 catalog and analysis snapshots) and control leases
(``share.read`` links). The gateway adds no math and no authority of its own; it
only resolves the caller's session client, bounds each call's deadline, and
turns an absent capability into :class:`MarketsUnavailable` so a route answers
a stated absence instead of an error.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import msgpack

#: Resolves the verified caller's engine client (``None`` when no engine).
ClientProvider = Callable[[], Any]
#: Runs one engine call under the host's deadline and capacity policy.
Invoker = Callable[..., Awaitable[Any]]

_DEADLINE_S = 15.0


class MarketsUnavailable(Exception):
    """The engine, or the capability a route needs, is not available."""


class MarketsRefused(Exception):
    """The engine refused a request with a typed ``CODE: detail`` answer."""


@dataclass(frozen=True)
class EngineGateway:
    client_provider: ClientProvider
    invoke: Invoker

    def _client(self) -> Any:
        client = self.client_provider()
        if client is None:
            raise MarketsUnavailable('The engine is not available')
        return client

    def _method(self, namespace: str, name: str) -> Any:
        method = getattr(getattr(self._client(), namespace, None), name, None)
        if method is None:
            raise MarketsUnavailable(
                f'The engine does not serve {namespace}.{name} (upgrade the engine)'
            )
        return method

    def supports_markets(self) -> bool:
        try:
            self._method('finance', 'market')
        except MarketsUnavailable:
            return False
        return True

    async def _call(self, namespace: str, name: str, *args: Any, **kwargs: Any) -> Any:
        method = self._method(namespace, name)
        try:
            return await self.invoke(method, *args, deadline=_DEADLINE_S, **kwargs)
        except (MarketsUnavailable, MarketsRefused):
            raise
        except Exception as error:
            raise _classified(error) from error

    async def market(self, op: str, **params: Any) -> Any:
        """One ``FinanceMarket`` op; the engine does every calculation."""

        return await self._call('finance', 'market', op, **params)

    async def series_points(
        self, series_id: str, from_ts: int, to_ts: int
    ) -> list[dict[str, Any]]:
        rows = await self._call('timeseries', 'range', series_id, from_ts, to_ts)
        return [{'ts': int(ts), 'values': list(values)} for ts, values in rows or []]

    async def nodes_by_label(self, label: str, limit: int) -> list[tuple[str, dict]]:
        rows = await self._call('nodes', 'list_by_label', label, limit)
        return [(str(node_id), _properties(props)) for node_id, props in rows or []]

    async def nodes(self, node_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not node_ids:
            return {}
        rows = await self._call('nodes', 'properties_batch', node_ids)
        return {key: _properties(value) for key, value in (rows or {}).items() if value}

    async def node(self, node_id: str) -> dict[str, Any] | None:
        props = await self._call('nodes', 'properties', node_id)
        return _properties(props) if props is not None else None

    async def create_node(self, node_id: str, properties: dict[str, Any]) -> bool:
        return bool(await self._call('nodes', 'create_if_absent', node_id, properties))

    async def issue_lease(self, **request: Any) -> dict[str, Any]:
        return await self._call('control_leases', 'issue', **request)

    async def get_lease(self, *, tenant: str, lease_id: str) -> dict[str, Any] | None:
        return await self._call(
            'control_leases', 'get', tenant=tenant, lease_id=lease_id
        )

    async def transition_lease(self, **request: Any) -> dict[str, Any]:
        return await self._call('control_leases', 'transition', **request)


def _properties(raw: Any) -> dict[str, Any]:
    if isinstance(raw, (bytes, bytearray)):
        raw = msgpack.unpackb(raw, raw=False)
    return raw if isinstance(raw, dict) else {}


#: The closed ``FinanceMarket`` refusal codes (``eg_compute::finance::market``).
_REFUSAL = re.compile(
    r'\b(INVALID_BAR|CONFLICTING_REVISION|OUT_OF_ORDER|CALENDAR|OVERFLOW|'
    r'INVALID_REQUEST|REVISION_NEEDS_REPLAY|LOOK_AHEAD|UNSOURCED_CLAIM): [^\n]{0,240}'
)


def _classified(error: Exception) -> Exception:
    """A typed engine refusal (``CODE: detail``) stays a refusal; anything else
    is an unavailable engine, whose cause is never echoed to the browser."""

    match = _REFUSAL.search(str(error))
    if match:
        return MarketsRefused(match.group(0))
    return MarketsUnavailable('The engine call failed')
