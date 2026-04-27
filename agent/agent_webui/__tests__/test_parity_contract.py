"""Regression-guard contract tests for web-UI views.

This module enforces the parity invariant that every ``fetch(...)`` call in
the React views under ``src/components/views/`` reaches a real FastAPI route
registered on ``agent_webui.api_extensions.router``.

The check runs over the frontend source as plain text -- no TypeScript
compiler, no Playwright, no live backend. Template-literal path parameters
(``${encodeURIComponent(id)}``) and FastAPI path captures (``{filename}``)
are normalised to a single ``*`` wildcard so both sides compare cleanly.

Failure modes:

* A view fetches ``/api/enhanced/foo/bar`` but no route declares that path
  -- the test prints the offending file, URL, and normalised path.
* A view fetches a URL under an unknown prefix (typo, missing ``/api/``
  root) -- the test prints the offending URL and the allowed prefixes.

Both failures flag a parity bug that a human must resolve.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from agent_webui.api_extensions import router
from fastapi.routing import APIRoute

pytestmark = pytest.mark.integration


ENHANCED_PREFIX = '/api/enhanced'

ALLOWED_URL_PREFIXES = (
    '/api/enhanced/',
    '/mcp/',
    '/ag-ui',
    '/stream',
    '/chats',
    '/health',
    '/api/approve',
)

VIEWS_DIR = Path(__file__).resolve().parents[3] / 'src' / 'components' / 'views'

_FETCH_PATTERN = re.compile(r"""fetch\s*\(\s*[`'"]([^`'"]+)[`'"]""")

_TEMPLATE_PLACEHOLDER = re.compile(r'\$\{[^}]+\}')
_ROUTE_PLACEHOLDER = re.compile(r'\{[^}]+\}')


def _normalize(path: str) -> str:
    """Collapse path parameters and query strings to a comparable template.

    Both frontend template-literal placeholders (``${var}``) and FastAPI
    path captures (``{name}``) are flattened to ``*``. A trailing slash is
    stripped so ``/foo`` and ``/foo/`` compare equal.
    """
    path = path.split('?', 1)[0]
    path = path.split('#', 1)[0]
    path = _TEMPLATE_PLACEHOLDER.sub('*', path)
    path = _ROUTE_PLACEHOLDER.sub('*', path)
    if len(path) > 1 and path.endswith('/'):
        path = path[:-1]
    return path


def _registered_routes() -> set[str]:
    """Return the set of normalised ``/api/enhanced/*`` route paths."""
    out: set[str] = set()
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        out.add(_normalize(f'{ENHANCED_PREFIX}{route.path}'))
    return out


def _iter_view_fetches() -> list[tuple[Path, str]]:
    """Collect ``(file, url)`` pairs for every fetch call in the views tree."""
    assert VIEWS_DIR.is_dir(), (
        f'Views directory not found: {VIEWS_DIR}. '
        'Did the agent-webui package layout change?'
    )
    pairs: list[tuple[Path, str]] = []
    for tsx in sorted(VIEWS_DIR.rglob('*.tsx')):
        if '__tests__' in tsx.parts:
            continue
        try:
            source = tsx.read_text(encoding='utf-8')
        except OSError:
            continue
        for match in _FETCH_PATTERN.findall(source):
            if match.startswith('/'):
                pairs.append((tsx, match))
    return pairs


@pytest.fixture(scope='module')
def registered_routes() -> set[str]:
    """Cache the registered-route set for all assertions in this module."""
    return _registered_routes()


@pytest.fixture(scope='module')
def view_fetches() -> list[tuple[Path, str]]:
    """Cache the scan of views-tree fetch calls for all assertions."""
    return _iter_view_fetches()


class TestViewFetchPrefixes:
    """Every view-level fetch URL must use an approved server prefix."""

    def test_all_view_fetch_urls_use_known_prefix(
        self, view_fetches: list[tuple[Path, str]]
    ) -> None:
        """Fetch URLs must start with one of the allowed backend prefixes."""
        violators: list[tuple[Path, str]] = []
        for path, url in view_fetches:
            if not any(url.startswith(p) for p in ALLOWED_URL_PREFIXES):
                violators.append((path, url))
        if violators:
            rendered = '\n'.join(
                f'  - {p.relative_to(VIEWS_DIR.parents[2])}: {u}' for p, u in violators
            )
            allowed = ', '.join(ALLOWED_URL_PREFIXES)
            pytest.fail(
                f'View fetch URLs must begin with one of [{allowed}]:\n{rendered}'
            )


class TestViewFetchEndpoints:
    """Each ``/api/enhanced/*`` fetch must resolve to a registered route."""

    def test_every_enhanced_url_matches_a_registered_route(
        self,
        view_fetches: list[tuple[Path, str]],
        registered_routes: set[str],
    ) -> None:
        """Views must not invent ``/api/enhanced/*`` routes that do not exist."""
        unmatched: list[tuple[Path, str, str]] = []
        for path, url in view_fetches:
            if not url.startswith(ENHANCED_PREFIX + '/'):
                continue
            normalized = _normalize(url)
            if normalized not in registered_routes:
                unmatched.append((path, url, normalized))
        if unmatched:
            rendered = '\n'.join(
                f'  - {p.relative_to(VIEWS_DIR.parents[2])}: {u} (normalised: {n})'
                for p, u, n in unmatched
            )
            pytest.fail(
                'The following view fetch URLs do not match any route in '
                f'agent_webui.api_extensions.router:\n{rendered}\n\n'
                'Either add the route or correct the fetch URL.'
            )

    def test_route_set_has_expected_shape(self, registered_routes: set[str]) -> None:
        """The extracted route set must contain core ``/api/enhanced/`` paths.

        Guards against the route-extraction helper silently returning an
        empty set (e.g. if the router import is shadowed or the route
        normalisation regresses).
        """
        assert '/api/enhanced/graph/stats' in registered_routes
        assert '/api/enhanced/chats' in registered_routes
        assert '/api/enhanced/sdd/specs' in registered_routes

    def test_scan_found_fetch_calls(self, view_fetches: list[tuple[Path, str]]) -> None:
        """At least one fetch call must be discovered in the views tree.

        Guards against the regex silently returning an empty list (e.g.
        after a refactor that replaces ``fetch(`...`)`` with an alias).
        """
        assert view_fetches, (
            'No fetch calls discovered under '
            f'{VIEWS_DIR.relative_to(VIEWS_DIR.parents[2])}. '
            'Either the views no longer call fetch() directly, or the '
            'regex in this test needs updating.'
        )


class TestPathNormalisation:
    """Smoke checks on the shared ``_normalize`` helper."""

    def test_normalize_strips_query_string(self) -> None:
        """Query parameters must not participate in route comparison."""
        assert _normalize('/api/enhanced/sdd/tasks?plan_id=1') == (
            '/api/enhanced/sdd/tasks'
        )

    def test_normalize_collapses_template_literal(self) -> None:
        """``${encodeURIComponent(id)}`` must collapse to the wildcard."""
        assert (
            _normalize('/api/enhanced/graph/memory/${encodeURIComponent(id)}')
            == '/api/enhanced/graph/memory/*'
        )

    def test_normalize_collapses_route_parameter(self) -> None:
        """FastAPI captures (``{memory_id}``) must collapse to the wildcard."""
        assert (
            _normalize('/api/enhanced/graph/memory/{memory_id}')
            == '/api/enhanced/graph/memory/*'
        )

    def test_normalize_strips_trailing_slash(self) -> None:
        """A trailing slash must not cause a spurious mismatch."""
        assert _normalize('/api/enhanced/graph/stats/') == ('/api/enhanced/graph/stats')
