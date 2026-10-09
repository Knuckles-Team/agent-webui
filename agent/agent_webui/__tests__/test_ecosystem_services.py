from __future__ import annotations

"""``GET /api/enhanced/ecosystem/services`` must report exactly what the live
scan finds -- never more, never less.

This is the sole live-parity authority ``src/lib/integrations-catalog.ts``
composes against (see that module's docstring): "a package this endpoint
does not report is never listed, and every package it DOES report gets an
item, full stop." A prior version of this handler violated that guarantee
from the fabrication direction -- after the real directory scan, it
unconditionally appended eight hardcoded package names ("Guarantee standard
services for validation / UI fallback") whenever they were not already
present, regardless of whether they were actually installed. That is the
mirror image of BUG-018, which silently DROPPED unknown live packages
instead of fabricating known ones.

Known-bad-input proof: a packages root containing only two real
sub-directories, neither of which is one of the eight previously-hardcoded
names, must report exactly those two -- none of the eight fabricated names,
and no crash.
"""


from agent_webui.server import create_agent_web_app

_FORMERLY_HARDCODED_NAMES = frozenset(
    {
        'tunnel-manager',
        'systems-manager',
        'container-manager-mcp',
        'repository-manager',
        'audio-transcriber',
        'wger-agent',
        'mealie-mcp',
        'langfuse-agent',
    }
)


def test_reports_only_real_directories_never_the_formerly_hardcoded_fallback(
    tmp_path,
    monkeypatch,
    mock_agent,
    mock_workspace_helpers,
    authenticated_client_factory,
):
    packages_root = tmp_path / 'agent-packages'
    agents_dir = packages_root / 'agents'
    agents_dir.mkdir(parents=True)
    (agents_dir / 'genuinely-installed-one').mkdir()
    (agents_dir / 'genuinely-installed-two').mkdir()
    # Not a directory -- must be skipped, not reported as a package.
    (agents_dir / 'not-a-package.txt').write_text('irrelevant')

    monkeypatch.setenv('AGENT_PACKAGES_ROOT', str(packages_root))

    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    client = authenticated_client_factory(app, raise_server_exceptions=False)

    response = client.get('/api/enhanced/ecosystem/services')

    assert response.status_code == 200, response.text
    reported = set(response.json())
    assert reported == {'genuinely-installed-one', 'genuinely-installed-two'}
    fabricated = reported & _FORMERLY_HARDCODED_NAMES
    assert fabricated == set(), (
        f'Reported package(s) not present on disk -- fabricated fallback reintroduced: {fabricated}'
    )


def test_a_missing_packages_root_is_reported_as_unavailable_not_as_zero_packages(
    tmp_path,
    monkeypatch,
    mock_agent,
    mock_workspace_helpers,
    authenticated_client_factory,
):
    """An empty successful response (`[]`) means "the scan ran and found
    nothing" -- it must not also mean "the scan could not run at all".
    A nonexistent packages root is a configuration failure and must be
    reported as one (503), not silently collapsed into the same shape as a
    genuinely empty catalog."""
    missing_root = tmp_path / 'does-not-exist'
    monkeypatch.setenv('AGENT_PACKAGES_ROOT', str(missing_root))

    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    client = authenticated_client_factory(app, raise_server_exceptions=False)

    response = client.get('/api/enhanced/ecosystem/services')

    assert response.status_code == 503, response.text
