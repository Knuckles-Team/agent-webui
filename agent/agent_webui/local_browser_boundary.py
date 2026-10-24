"""Optional nominal host port; no identity or policy authority lives here."""

from typing import Any


def validate_local_browser_boundary(boundary: Any, mode: str) -> None:
    if boundary is None:
        return
    try:
        from arbora.client.browser_boundary import LocalBrowserBoundary
    except ModuleNotFoundError as exc:
        if exc.name not in {
            'arbora',
            'arbora.client',
            'arbora.client.browser_boundary',
        }:
            raise
        raise RuntimeError('Canonical local browser boundary is unavailable') from None

    if mode != 'none' or type(boundary) is not LocalBrowserBoundary:
        raise RuntimeError(
            'Canonical local browser boundary requires explicit none mode'
        )


class LocalBrowserBoundaryMiddleware:
    """Delegate only the fixed websocket path to its qualified upstream owner."""

    def __init__(self, app: Any, *, boundary: Any) -> None:
        from arbora.client.browser_boundary import LOCAL_BROWSER_PATH

        self.app, self.boundary = app, boundary
        self.path = LOCAL_BROWSER_PATH

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get('type') == 'websocket' and scope.get('path') == self.path:
            await self.boundary(scope, receive, send)
            return
        await self.app(scope, receive, send)
