"""Browser-host routes whose authority remains in Agent WebUI.

Domain operations belong to GraphOS.  This inventory is deliberately narrow:
it names the local workspace, browser upload, and MCP App transport endpoints
that cannot be replaced by a GraphOS domain operation.  Keep it in sync with
``api_extensions.router`` when adding or removing host routes.
"""

from typing import Final

UI_LOCAL_ENHANCED_ROUTES: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ('GET', '/files'),
        ('GET', '/files/{filename:path}'),
        ('PUT', '/files/{filename:path}'),
        ('DELETE', '/files/{filename:path}'),
        ('GET', '/editor-context'),
        ('POST', '/editor-context'),
        ('GET', '/config-files'),
        ('POST', '/upload'),
        ('GET', '/agent-icon'),
        ('GET', '/download/{filename:path}'),
        ('POST', '/voice/transcribe'),
        ('POST', '/mcp/apps/resource'),
    }
)
