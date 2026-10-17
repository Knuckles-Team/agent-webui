"""Application surfaces hosted by the WebUI (EH-429).

An app is a product area with its own routes under ``/api/apps/<id>`` and its
own frontend section. :func:`build_apps_router` mounts every registered app and
serves ``GET /api/apps``, the catalog the browser reads to decide which apps to
show: an app whose engine capability is absent is listed as unavailable with a
reason, never silently hidden or shown broken.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter

from ..app_composition import EngineProvider


@dataclass(frozen=True)
class AppBackend:
    """One hosted app: its id (the URL segment), its router, and a cheap
    availability probe (no engine round trip)."""

    app_id: str
    router: APIRouter
    available: Callable[[], bool]
    unavailable_reason: str


def build_apps_router(apps: list[AppBackend]) -> APIRouter:
    router = APIRouter()

    @router.get('/api/apps')
    async def app_catalog() -> dict[str, Any]:
        entries = []
        for app in apps:
            available = bool(app.available())
            entries.append(
                {
                    'id': app.app_id,
                    'available': available,
                    'detail': None if available else app.unavailable_reason,
                }
            )
        return {'apps': entries}

    for app in apps:
        router.include_router(app.router, prefix=f'/api/apps/{app.app_id}')
    return router


def default_apps(engine_provider: EngineProvider | None = None) -> list[AppBackend]:
    """Hosted apps over a supplied engine getter or the standalone default."""

    from .markets import EngineGateway, build_markets_router

    def gateway() -> EngineGateway:
        from ..api_extensions import invoke_governed_helper

        return EngineGateway(
            client_provider=_resolve_engine_provider(engine_provider),
            invoke=invoke_governed_helper,
        )

    return [
        AppBackend(
            app_id='markets',
            router=build_markets_router(gateway),
            available=lambda: gateway().supports_markets(),
            unavailable_reason='The engine does not serve market signals yet',
        )
    ]


def _resolve_engine_provider(provider: EngineProvider | None) -> EngineProvider:
    if provider is not None:
        return provider
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    return IntelligenceGraphEngine.get_active
