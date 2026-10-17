"""Borrowed host resources scoped to one WebUI ASGI invocation."""

from collections.abc import Callable, Mapping
from contextvars import ContextVar
from dataclasses import dataclass
from types import MappingProxyType
from typing import TYPE_CHECKING, Any

from starlette.types import ASGIApp, Receive, Scope, Send

if TYPE_CHECKING:
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

EngineProvider = Callable[[], 'IntelligenceGraphEngine']


@dataclass(frozen=True)
class AppComposition:
    engine_provider: EngineProvider
    workspace_helpers: Mapping[str, Any]


_CURRENT: ContextVar[AppComposition | None] = ContextVar(
    'webui_app_composition', default=None
)


def current_app_composition() -> AppComposition | None:
    return _CURRENT.get()


class AppCompositionMiddleware:
    """Retain borrowed resources through HTTP, websocket and lifespan completion."""

    def __init__(
        self,
        app: ASGIApp,
        engine_provider: EngineProvider | None,
        workspace_helpers: dict[str, Any],
    ) -> None:
        self.app = app
        self.composition = (
            AppComposition(engine_provider, MappingProxyType(workspace_helpers))
            if engine_provider is not None
            else None
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        token = _CURRENT.set(self.composition)
        try:
            await self.app(scope, receive, send)
        finally:
            _CURRENT.reset(token)
