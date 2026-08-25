"""BUG-PE-004 regression guard: bare `/health` must not be swallowed by the SPA.

Root cause: ``create_agent_web_app`` mounts ``SPAStaticFiles`` at ``/`` to serve
the built dashboard bundle, falling back to ``index.html`` for any 404 whose
path does not start with one of a short list of exempt prefixes
(``api``/``chat``/``configure``/``mcp``/``a2a``/``ag-ui``) and contains no
``.``. Bare ``/health`` and ``/healthz`` match none of those prefixes, so a
probe hitting either one got HTTP 200 with the dashboard's `index.html` --
even though ``_PUBLIC_LIVENESS_PATHS`` (server.py) already treats both as
unauthenticated liveness checks, which shows a real endpoint was intended.
``/api/health`` (added by ``add_pydantic_routes`` from pydantic-ai's own
web app) was never swallowed -- it starts with ``api`` -- but
``/api/healthz`` had no handler at all and 404'd.

These tests reproduce the swallow for real: they write a throwaway
``dist/index.html`` at the exact path ``create_agent_web_app`` hard-codes
(``Path(__file__).parent / 'dist'`` in ``agent_webui/server.py``, gitignored,
normally produced by the Vite build) so ``SPAStaticFiles`` actually mounts,
then assert the fix -- explicit routes registered before that mount --
prevents `/health`, `/healthz`, and `/api/healthz` from ever reaching the
SPA fallback, while a genuine unknown client route still gets the SPA shell.

``/health/ready`` is included even though it wasn't named as swallowed in the
original bug report's evidence: the SHARED base identity boundary
(``agent_utilities.security.request_identity.UNAUTHENTICATED_PATHS``, which
sits OUTSIDE this app's own ``WebUIAuthorizationMiddleware``/
``_PUBLIC_LIVENESS_PATHS`` in the middleware stack) already treated it as
unauthenticated -- so with identity unenforced (the default, e.g. these
tests) it reached routing with no credential and no matching route, landing
on the exact same SPA fallback as ``/health``. Fixing the class rather than
the instance means covering it too.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

_FAKE_INDEX_HTML = (
    '<!doctype html><html><head><title>Agent Web Dashboard</title></head>'
    '<body><div id="root">spa-shell-marker</div></body></html>'
)


@pytest.fixture
def webui_dist_present():
    """Materialize a throwaway ``dist/index.html`` so the SPA mount is live.

    ``create_agent_web_app`` only mounts ``SPAStaticFiles`` when
    ``dist_path.exists()`` is true (server.py, ``if not html_source: if
    dist_path.exists(): app.mount(...)``); in this checkout ``dist/`` doesn't
    exist (it's a gitignored Vite build artifact), so without this fixture
    the bug never reproduces -- an unmatched path 404s honestly instead of
    being swallowed. Removes only what it created.
    """
    import agent_webui

    dist_dir = Path(agent_webui.__file__).parent / 'dist'
    index_path = dist_dir / 'index.html'
    dist_already_existed = dist_dir.exists()
    dist_dir.mkdir(parents=True, exist_ok=True)
    index_path.write_text(_FAKE_INDEX_HTML)
    try:
        yield
    finally:
        index_path.unlink(missing_ok=True)
        if not dist_already_existed:
            try:
                dist_dir.rmdir()
            except OSError:
                pass


@pytest.fixture
def app(webui_dist_present):
    """The real FastAPI app, built exactly as production builds it.

    No ``html_source`` -- that argument takes an entirely different code
    path (``add_pydantic_routes``'s ``/`` and ``/{id}`` routes) that never
    exercises ``SPAStaticFiles`` at all, so this must stay unset for the
    test to mean anything.
    """
    # Depended on for its side effect (materializing dist/index.html before
    # ``create_agent_web_app`` checks ``dist_path.exists()``), not a value.
    _ = webui_dist_present
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    return create_agent_web_app(Agent(TestModel()), {'get_path': lambda x: x})


@pytest.fixture
def client(app):
    # No identity config is set up (mirrors the default, unenforced posture),
    # so ``_identity_enforced()`` is False and every route -- not only the
    # liveness set -- bypasses the actor/authorization middleware. That
    # matches production too: `/health*` is in ``_PUBLIC_LIVENESS_PATHS`` and
    # bypasses identity even when it IS enforced.
    return TestClient(app)


@pytest.mark.parametrize(
    'path', ['/health', '/health/ready', '/healthz', '/api/healthz']
)
def test_liveness_path_returns_json_not_spa_shell(client, path):
    """The paths BUG-PE-004 named must return a real JSON payload, not HTML."""
    response = client.get(path)

    assert response.status_code == 200, f'{path} did not return 200'
    assert 'spa-shell-marker' not in response.text, (
        f'{path} returned the SPA index.html shell instead of a real payload '
        '-- BUG-PE-004 regression'
    )
    content_type = response.headers.get('content-type', '')
    assert 'html' not in content_type.lower(), (
        f'{path} content-type is {content_type!r}, expected JSON'
    )
    payload = response.json()
    assert payload == {'ok': True}


def test_api_health_still_served_by_pydantic_ai(client):
    """Regression guard: the fix must not disturb the pre-existing route.

    ``/api/health`` was never swallowed (it starts with the SPA's exempt
    ``api`` prefix) and is pydantic-ai's own handler, mounted by
    ``add_pydantic_routes`` before the new liveness routes are registered.
    """
    response = client.get('/api/health')

    assert response.status_code == 200
    assert response.json() == {'ok': True}


def test_unknown_client_route_still_falls_back_to_spa_shell(
    app, authenticated_client_factory
):
    """The fix must be narrowly scoped: real SPA client-side routing survives.

    A path with no relation to any liveness or API prefix (e.g. a
    client-side router path like ``/dashboard/settings``) must still hit
    ``SPAStaticFiles``'s 404-to-``index.html`` fallback -- proving the fix
    added explicit liveness routes rather than broadening the SPA's
    exemption list in a way that could mask other 404s.

    Uses ``authenticated_client_factory`` (tests/conftest.py) rather than the
    bare unauthenticated ``client`` fixture: with a real credential absent,
    ``WebUIActorIdentityMiddleware``/``ActorIdentityMiddleware`` reject an
    unclassified path with 401 before the request ever reaches routing --
    correct production behavior, but it would make this assertion about the
    SPA fallback specifically fail for the wrong reason.
    """
    authed_client = authenticated_client_factory(app)

    response = authed_client.get('/dashboard/settings')

    assert response.status_code == 200
    assert 'spa-shell-marker' in response.text


def test_bare_root_still_serves_the_spa_shell_authenticated(
    app, authenticated_client_factory
):
    """Regression guard for a suspected (but unconfirmed) BUG-PE-004 regression.

    An authenticated `GET /` was independently reported live as a 404 JSON
    `{"detail":"Request failed"}` instead of the SPA shell. This fix's own
    route registration order was the prime suspect (explicit `/health*`
    routes were added, via `app.add_route`, immediately before the SPA
    `Mount('/', ...)` in `create_agent_web_app` -- server.py). Reproduced
    here against the real app exactly as `test_unknown_client_route_still_
    falls_back_to_spa_shell` above does: this passes on the code as it
    stands, which means route registration order is NOT the cause of that
    live 404 -- `/` still resolves to `SPAStaticFiles`'s `html=True` index
    fallback, unaffected by the new `/health`/`/healthz`/`/health/ready`/
    `/api/healthz` routes registered just before the SPA mount. The live 404
    has a different cause (see the investigation report); this guard exists
    so a FUTURE regression in route ordering is caught immediately instead
    of requiring another live repro.
    """
    authed_client = authenticated_client_factory(app)

    response = authed_client.get('/')

    assert response.status_code == 200
    assert 'spa-shell-marker' in response.text
    content_type = response.headers.get('content-type', '')
    assert 'html' in content_type.lower()


def test_bare_root_unauthenticated_is_401_not_404(app):
    """`/` is not in `_PUBLIC_LIVENESS_PATHS` -- an unauthenticated request
    must be rejected with 401 by the identity boundary, never reach
    `SPAStaticFiles` at all, and never come back as the privacy-safe 404
    JSON shape (`{"detail":"Request failed"}`) that a genuine unmatched
    route produces. Distinguishes "no credential" from "route not found" for
    the same live symptom investigated above."""
    from fastapi.testclient import TestClient

    client = TestClient(app)
    response = client.get('/')

    assert response.status_code == 401
    assert response.json() != {'detail': 'Request failed'}
