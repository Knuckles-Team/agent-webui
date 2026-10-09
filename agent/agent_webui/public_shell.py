"""The public application shell: the built SPA bundle, served without identity.

The sign-in, first-run setup and second-factor screens are part of the React
application, so a browser with no session must be able to load the bundle
that renders them. The bundle is static and carries no data: every data route
stays behind the identity gate, and a request is only treated as a shell
request when NO application route (API, gateway, websocket, bridged
pydantic-ai route) would serve it — only the SPA mount itself.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from starlette.routing import Match, Mount

__all__ = ['PublicShell', 'public_shell_of']

_SHELL_METHODS = frozenset({'GET', 'HEAD'})


class PublicShell:
    """Decide whether one request asks for the static SPA shell only."""

    def __init__(
        self,
        dist_path: Path,
        route_matcher: Callable[[str], bool],
        spa_mount: Mount,
    ) -> None:
        self._dist = dist_path.resolve()
        self._matches_route = route_matcher
        self._spa_mount = spa_mount

    def _is_bundle_file(self, path: str) -> bool:
        relative = path.lstrip('/')
        if not relative:
            return True
        candidate = (self._dist / relative).resolve()
        return candidate.is_relative_to(self._dist) and candidate.is_file()

    def _claimed_by_application(self, scope: Any) -> bool:
        routes = getattr(getattr(scope.get('app'), 'router', None), 'routes', ())
        for route in routes:
            if route is self._spa_mount:
                continue
            match, _ = route.matches(scope)
            if match is not Match.NONE:
                return True
        return False

    def admits(self, scope: Any) -> bool:
        if scope.get('type') != 'http':
            return False
        if str(scope.get('method') or '').upper() not in _SHELL_METHODS:
            return False
        path = str(scope.get('path') or '')
        if not (self._is_bundle_file(path) or self._matches_route(path)):
            return False
        return not self._claimed_by_application(scope)


def public_shell_of(scope: Any) -> PublicShell | None:
    """The shell the application registered, if it serves a built bundle."""

    state = getattr(scope.get('app'), 'state', None)
    shell = getattr(state, 'public_shell', None)
    return shell if isinstance(shell, PublicShell) else None
