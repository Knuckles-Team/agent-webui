"""Regression guard: a dist directory without ``index.html`` must be loud.

THE LIVE DEFECT THIS ENCODES
-----------------------------
A signed-in owner landed on ``{"detail": "Request failed"}`` at the
deployment's dashboard root. The real response was a plain
**404 "Not Found"**:
``agent_webui/dist/`` on the production mount held all 512 files of a
complete frontend build EXCEPT ``index.html``. ``create_agent_web_app``
gated the SPA mount on ``dist_path.exists()`` -- a bare DIRECTORY check --
so the partial build mounted silently. Hashed assets and favicons served
200 while ``/`` and every client-side route fell through
``SPAStaticFiles``' ``index.html`` fallback to a 404 that
``_privacy_safe_http_error`` then masked, destroying the one word
("Not Found") that would have named the cause.

WHY THESE TESTS ARE SHAPED THIS WAY
------------------------------------
The prior investigation "proved" the route worked using a harness that
materialized its own ``dist/index.html`` (see
``tests/test_health_liveness_endpoint.py::webui_dist_present``). That
fixture is correct for what it tests, but it MANUFACTURES the very
condition production was missing -- so it can never observe this bug.
``test_built_dashboard_dist_has_an_entrypoint`` therefore asserts the
PRODUCTION condition against the real, unfixtured package directory, and
``test_dist_without_index_html_is_logged_loudly`` asserts that when the
condition IS violated the server says so at ERROR instead of degrading
into a masked 404.
"""

from __future__ import annotations

import contextlib
import logging
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration


def _dist_dir() -> Path:
    """The exact directory ``create_agent_web_app`` serves the dashboard from.

    Mirrors ``dist_path = Path(__file__).parent / 'dist'`` in
    ``agent_webui/server.py``. Resolved from the imported package, not from
    this file, so it follows the same import the server does -- including
    production, where the package is a live NFS mount rather than the
    packaged wheel.
    """
    import agent_webui

    return Path(agent_webui.__file__).parent / 'dist'


def test_built_dashboard_dist_has_an_entrypoint():
    """If the frontend has been built at all, it MUST have an entrypoint.

    No ``dist`` directory is an honest, loudly-warned "dashboard not built"
    state and is skipped: a source-only checkout (this repo gitignores the
    Vite output) legitimately has none. A dist directory that exists but
    lacks ``index.html`` is the production failure -- an interrupted or
    partial build, since ``index.html`` is the LAST file Vite writes -- and
    is never acceptable. This assertion FAILS against the state the live
    deployment was in.
    """
    dist_dir = _dist_dir()
    if not dist_dir.is_dir():
        pytest.skip('frontend not built in this checkout (no dist directory)')

    index_path = dist_dir / 'index.html'
    assert index_path.is_file(), (
        'the dashboard dist directory exists but has no index.html -- this is '
        'a partial/interrupted frontend build. Every SPA route, including "/", '
        'will return a 404 that the privacy handler masks as '
        '{"detail": "Request failed"}. Re-run the frontend build.'
    )


@pytest.fixture
def dist_dir_override(tmp_path, monkeypatch):
    """Point the server's ``dist_path`` at a controlled directory.

    ``create_agent_web_app`` computes ``Path(__file__).parent / 'dist'`` from
    ``agent_webui/server.py``'s OWN module global, so this patches that
    global -- patching ``agent_webui.__file__`` looks right and does nothing.
    Returns a callable that materializes the dist state under test; without
    it the result would depend on whether the checkout happens to have a
    build, which is exactly the checkout-dependence that let this bug ship.
    """
    from agent_webui import server as server_module

    pkg_dir = tmp_path / 'agent_webui'
    pkg_dir.mkdir()
    monkeypatch.setattr(server_module, '__file__', str(pkg_dir / 'server.py'))
    return pkg_dir / 'dist'


def _build_app():
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    return create_agent_web_app(Agent(TestModel()), {'get_path': lambda x: x})


@contextlib.contextmanager
def _captured_records(level):
    """Capture ``agent_webui`` log records for the block.

    Not ``caplog``: ``configure_structured_logging`` (observability.py) sets
    ``propagate = False`` on this package's logger so its curated JSON lines
    are not re-emitted by root handlers, and pytest's ``caplog`` handler
    lives on the root logger -- it therefore sees NOTHING from these call
    sites and a broken assertion would look like a passing one.
    """
    package_logger = logging.getLogger('agent_webui')
    records: list[logging.LogRecord] = []

    class _Collect(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = _Collect(level=level)
    previous_level = package_logger.level
    package_logger.addHandler(handler)
    package_logger.setLevel(min(level, previous_level or level))
    try:
        yield records
    finally:
        package_logger.removeHandler(handler)
        package_logger.setLevel(previous_level)


def test_dist_without_index_html_is_logged_loudly(dist_dir_override):
    """A partial build must be reported at ERROR, not silently mounted.

    Materializes a dist directory holding a hashed asset but no
    ``index.html`` -- exactly production's state -- and asserts the app build
    emits an ERROR naming the missing entrypoint. Before the fix the mount
    happened with no log line at all, so the only symptom anywhere was a
    masked 404.
    """
    (dist_dir_override / 'assets').mkdir(parents=True)
    (dist_dir_override / 'assets' / 'index-deadbeef.js').write_text('/* built */')

    with _captured_records(logging.ERROR) as records:
        _build_app()

    assert any(
        record.levelno >= logging.ERROR and 'index.html' in record.getMessage()
        for record in records
    ), (
        'a dist directory with no index.html was accepted without an ERROR -- '
        'the partial-build state that produced the live masked 404 is silent '
        'again'
    )


def test_masked_http_error_logs_the_real_status_and_detail(
    dist_dir_override, authenticated_client_factory
):
    """``_privacy_safe_http_error`` must not DESTROY the cause it masks.

    The client-facing detail stays masked (a deliberate privacy control);
    the server-side log must carry the real status and the real detail, so a
    user-reported "Request failed" is one log read away from its cause.

    ``dist_dir_override`` materializes no dist directory, so an unknown
    client route 404s through the router instead of being answered by the
    SPA fallback -- the same masked 404 the owner received, reached through
    the real identity/authorization middleware stack with a real credential.
    """
    app = _build_app()
    client = authenticated_client_factory(app)

    with _captured_records(logging.WARNING) as records:
        response = client.get('/definitely-not-a-route')

    assert response.status_code == 404
    assert response.json() == {'detail': 'Request failed'}, (
        'the client-facing masking must stay exactly as it was'
    )
    messages = [record.getMessage() for record in records]
    assert any(
        'status=404' in message and 'Not Found' in message for message in messages
    ), (
        'the masked 404 did not log its real status and detail server-side; '
        f'records were {messages!r}'
    )
