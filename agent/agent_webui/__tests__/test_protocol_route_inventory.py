"""The documented local routes must exist on the mounted enhanced router."""

from agent_webui.api_extensions import router
from agent_webui.protocol_routes import UI_LOCAL_ENHANCED_ROUTES


def test_ui_local_routes_are_mounted_and_do_not_claim_domain_families() -> None:
    mounted = {
        (method, route.path)
        for route in router.routes
        for method in getattr(route, 'methods', ())
    }
    assert UI_LOCAL_ENHANCED_ROUTES <= mounted
    assert all(
        not path.startswith(
            (
                '/kb/',
                '/sdd/',
                '/sessions',
                '/goals',
                '/prompts',
                '/llm/',
                '/mcp/servers',
            )
        )
        for _, path in UI_LOCAL_ENHANCED_ROUTES
    )
