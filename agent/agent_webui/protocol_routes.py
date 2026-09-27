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

# Guard the exception inventory against a newly mounted sibling route. A new
# browser-host route must be reviewed explicitly before it joins this set.
UI_LOCAL_ENHANCED_PREFIXES: Final[tuple[str, ...]] = (
    '/files',
    '/editor-context',
    '/config-files',
    '/upload',
    '/agent-icon',
    '/download/',
    '/voice/transcribe',
    '/mcp/apps/resource',
)

# These mounted host routes still need GraphOS operation parity before removal.
# A prefix names a whole route family, including parameterized members.  Keep
# this list explicit so a new local-looking route cannot quietly be treated as
# a WebUI protocol exception.
GRAPHOS_DOMAIN_ENHANCED_PREFIXES: Final[tuple[str, ...]] = (
    '/kb/',
    '/sdd/',
    '/sessions',
    '/goals',
    '/prompts',
    '/mcp/servers',
    '/mcp/server-schema',
    '/mcp/tools',
    '/tools/',
    '/skills/',
    '/reload',
    '/llm/',
    '/models',
    '/config/backend',
)

# The exact outstanding MCPI-26c host surface. Remove a row only when its
# GraphOS operation, browser caller, and served-route proof land together.
# Keeping method as well as path prevents a new mutation under an existing
# read path from escaping the migration inventory.
GRAPHOS_DOMAIN_ENHANCED_ROUTES: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ('GET', '/mcp/servers/{server_name}/tools'),
        ('GET', '/mcp/server-schema'),
        ('GET', '/mcp/servers/{server_name}/config'),
        ('POST', '/mcp/servers'),
        ('PUT', '/mcp/servers/{server_name}'),
        ('DELETE', '/mcp/servers/{server_name}'),
        ('POST', '/mcp/tools/call'),
        ('POST', '/tools/toggle'),
        ('POST', '/skills/{skill_id}/toggle'),
        ('POST', '/reload'),
        ('POST', '/kb/ingest'),
        ('GET', '/kb/list'),
        ('GET', '/kb/search'),
        ('GET', '/kb/article/{article_id}'),
        ('POST', '/kb/health'),
        ('POST', '/kb/update'),
        ('GET', '/sdd/constitution'),
        ('POST', '/sdd/constitution'),
        ('GET', '/sdd/specs'),
        ('POST', '/sdd/spec'),
        ('GET', '/sdd/plans'),
        ('GET', '/sdd/tasks'),
        ('POST', '/sdd/sync'),
        ('GET', '/models'),
        ('GET', '/config/backend'),
        ('PUT', '/config/backend'),
        ('GET', '/prompts/graph'),
        ('GET', '/prompts/graph/{prompt_id}'),
        ('POST', '/prompts/graph'),
        ('PUT', '/prompts/graph/{prompt_id}'),
        ('GET', '/prompts/graph/{prompt_id}/versions'),
        ('POST', '/prompts/graph/{prompt_id}/rollback/{version_id}'),
        ('GET', '/prompts/graph/{prompt_id}/diff/{version_a}/{version_b}'),
        ('GET', '/tools/graph'),
        ('POST', '/tools/graph/{tool_id}/toggle'),
        ('GET', '/sessions'),
        ('GET', '/sessions/{session_id}'),
        ('DELETE', '/sessions/{session_id}'),
        ('POST', '/sessions/{session_id}/reply'),
        ('POST', '/sessions/{session_id}/cancel'),
        ('POST', '/goals'),
        ('GET', '/goals'),
        ('GET', '/goals/{goal_id}/iterations'),
        ('POST', '/goals/{goal_id}/cancel'),
        ('GET', '/llm/models'),
        ('GET', '/llm/embedding-models'),
        ('GET', '/llm/model-schema'),
        ('GET', '/llm/model-detail'),
        ('PUT', '/llm/models'),
        ('PUT', '/llm/embedding-models'),
        ('GET', '/prompts'),
        ('GET', '/prompts/{name}'),
        ('PUT', '/prompts/{name}'),
    }
)
