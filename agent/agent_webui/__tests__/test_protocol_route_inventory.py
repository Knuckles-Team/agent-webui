"""The documented local routes must exist on the mounted enhanced router."""

from agent_webui.api_extensions import router
from agent_webui.protocol_routes import (
    GRAPHOS_DOMAIN_ENHANCED_PREFIXES,
    GRAPHOS_DOMAIN_ENHANCED_ROUTES,
    UI_LOCAL_ENHANCED_PREFIXES,
    UI_LOCAL_ENHANCED_ROUTES,
)


def test_ui_local_routes_are_mounted_and_do_not_claim_domain_families() -> None:
    mounted = {
        (method, route.path)
        for route in router.routes
        for method in getattr(route, 'methods', ())
    }
    local = {
        route for route in mounted if route[1].startswith(UI_LOCAL_ENHANCED_PREFIXES)
    }
    assert local == UI_LOCAL_ENHANCED_ROUTES
    assert all(
        not path.startswith(GRAPHOS_DOMAIN_ENHANCED_PREFIXES)
        for _, path in UI_LOCAL_ENHANCED_ROUTES
    )


def test_remaining_domain_families_are_classified_and_mounted() -> None:
    mounted = {
        (method, route.path)
        for route in router.routes
        for method in getattr(route, 'methods', ())
        if route.path.startswith(GRAPHOS_DOMAIN_ENHANCED_PREFIXES)
    }
    assert mounted == GRAPHOS_DOMAIN_ENHANCED_ROUTES
    assert not (mounted & UI_LOCAL_ENHANCED_ROUTES)


def test_protocol_exceptions_do_not_relabel_remote_domain_calls() -> None:
    assert ('POST', '/mcp/apps/resource') in UI_LOCAL_ENHANCED_ROUTES
    assert ('POST', '/mcp/tools/call') in GRAPHOS_DOMAIN_ENHANCED_ROUTES
    assert ('POST', '/mcp/tools/call') not in UI_LOCAL_ENHANCED_ROUTES
    assert ('GET', '/kb/search') not in UI_LOCAL_ENHANCED_ROUTES
    assert ('POST', '/kb/search') not in GRAPHOS_DOMAIN_ENHANCED_ROUTES
