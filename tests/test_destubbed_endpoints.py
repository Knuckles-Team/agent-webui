"""Tests that de-stubbed endpoints return real-or-honest data.

These tests assert that the formerly-faked handlers no longer fabricate
records. The ecosystem dashboards now dispatch through the fleet's MCP servers
(``_call_mcp_tool``); a real call returns LIVE data and a failure surfaces an
honest error — never canned demo data such as the old ``ECO-101`` issues,
``Fedora`` torrents, or ``Antigravity-iModel`` runs.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import agent_webui.api_extensions as mod
import pytest
from agent_webui.api_extensions import router
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _stub_mcp(monkeypatch, mapping):
    """Patch ``_call_mcp_tool`` to return canned-per-(server,tool) results.

    ``mapping`` maps ``(server, tool)`` to either a value (returned) or an
    Exception instance (raised), letting us exercise both the live-data and
    honest-error branches without spawning real servers.
    """

    async def _fake(server, tool, arguments, *, timeout=30.0):
        key = (server, tool)
        if key not in mapping:
            raise AssertionError(f'unexpected MCP call: {key} {arguments}')
        result = mapping[key]
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(mod, '_call_mcp_tool', _fake)


# Substrings that must NEVER appear in any response: the old fabricated data.
FORBIDDEN_FAKES = [
    'ECO-101',
    'ECO-102',
    'ECO-103',
    'ECO-104',
    'Antigravity-iModel',
    'homelab-observability',
    'lifestyle-suite',
    'quant-memories',
    'Fedora-Workstation',
    'ArchLinux-Latest',
    'Federated Multi-Agent Reinforcement Learning',
    'dQw4w9WgXcQ',
    'Senior Creative Technologist',
    'agent-research-01',
    'agent-tui-helper',
    'Draft architectural ecosystem spec',
    'hourly-research-survey',
    'nightly-alpha-discovery',
    'Alert: LadybugDB Segment Fault Restored',
    'Desk Ambient Light',
]


# Each ecosystem path that dispatches to the fleet, with the (server, tool) it
# must call and a representative live payload to thread through.
ECOSYSTEM_LIVE = {
    '/ecosystem/portainer/stacks': (
        ('portainer-mcp', 'portainer_stack'),
        {'data': [{'Name': 'real-stack', 'Status': 1, 'Type': 2, 'EndpointId': 3}]},
        lambda d: (
            d['stacks'][0]['name'] == 'real-stack'
            and d['stacks'][0]['status'] == 'active'
        ),
    ),
    '/ecosystem/scholarx/papers': (
        ('scholarx-mcp', 'sx_storage'),
        {'papers': [{'id': 'arxiv:1', 'title': 'A Real Paper', 'exists': True}]},
        lambda d: (
            d['papers'][0]['title'] == 'A Real Paper'
            and d['papers'][0]['status'] == 'downloaded'
        ),
    ),
    '/ecosystem/searxng/search': (
        ('searxng-mcp', 'web_search'),
        {'results': [{'title': 'Live Hit', 'url': 'http://x', 'score': 1.0}]},
        lambda d: d['results'][0]['title'] == 'Live Hit',
    ),
    '/ecosystem/uptime/status': (
        ('uptime-kuma-mcp', 'uptime_kuma_monitors'),
        [{'id': 7, 'name': 'Gateway', 'url': 'http://g', 'active': True}],
        lambda d: (
            d['monitors'][0]['name'] == 'Gateway' and d['monitors'][0]['status'] == 'up'
        ),
    ),
    '/ecosystem/homeassistant/devices': (
        ('home-assistant-mcp', 'home_assistant_states'),
        [{'entity_id': 'light.x', 'state': 'on', 'attributes': {'friendly_name': 'X'}}],
        lambda d: d['devices'][0]['entity_id'] == 'light.x',
    ),
    '/ecosystem/qbittorrent/torrents': (
        ('qbittorrent-mcp', 'qbittorrent_torrents'),
        [{'name': 'real.iso', 'size': 10, 'progress': 0.5, 'state': 'downloading'}],
        lambda d: (
            d['torrents'][0]['name'] == 'real.iso'
            and d['torrents'][0]['progress'] == 50.0
        ),
    ),
    '/ecosystem/microsoft/emails': (
        ('microsoft-mcp', 'microsoft_mail'),
        {'value': [{'id': 'm1', 'subject': 'Real Subject', 'receivedDateTime': 't'}]},
        lambda d: d['emails'][0]['subject'] == 'Real Subject',
    ),
    '/ecosystem/datascience/training': (
        ('data-science-mcp', 'rank_models'),
        {'ranked_models': [{'model': 'rf', 'test_r2': 0.9}]},
        lambda d: d['models'][0]['model'] == 'rf',
    ),
}


@pytest.mark.parametrize('path', list(ECOSYSTEM_LIVE))
def test_ecosystem_endpoint_threads_live_data(client, monkeypatch, path):
    (server_tool, payload, check) = ECOSYSTEM_LIVE[path]
    _stub_mcp(monkeypatch, {server_tool: payload})
    resp = client.get(path)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data['status'] == 'success'
    assert data['source'] == 'live'
    assert check(data), f'{path} did not thread live data: {data}'
    for fake in FORBIDDEN_FAKES:
        assert fake not in resp.text, f'{path} leaks fabricated data: {fake}'


@pytest.mark.parametrize('path', list(ECOSYSTEM_LIVE))
def test_ecosystem_endpoint_honest_error_on_backend_failure(client, monkeypatch, path):
    (server_tool, _payload, _check) = ECOSYSTEM_LIVE[path]
    _stub_mcp(monkeypatch, {server_tool: RuntimeError('backend down')})
    resp = client.get(path)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # An unreachable backend yields an honest error, never canned data.
    assert data['status'] == 'error'
    assert data['source'] == 'unreachable'
    # ``_service_error`` deliberately reports only ``type(exc).__name__`` --
    # the exception *message* can carry upstream host names, URLs, credentials
    # or query text, so it never crosses the API boundary (the same redaction
    # the ``HTTPException`` subclass applies to ``detail``). The honest signal
    # is preserved: the client learns the read failed and why in kind, and
    # ``_log_failure`` keeps the full cause server-side.
    assert data['detail'] == 'RuntimeError'
    assert 'backend down' not in resp.text
    for fake in FORBIDDEN_FAKES:
        assert fake not in resp.text


def test_github_prs_dispatches_to_fleet_with_repo(client, monkeypatch):
    calls = {}

    async def _fake(server, tool, arguments, *, timeout=30.0):
        calls[(server, tool)] = arguments
        if tool == 'github_pulls':
            return {
                'data': [
                    {
                        'number': 5,
                        'title': 'real pr',
                        'user': {'login': 'me'},
                        'head': {'ref': 'feat'},
                        'state': 'open',
                    }
                ]
            }
        return {
            'data': {
                'workflow_runs': [
                    {
                        'id': 1,
                        'name': 'CI',
                        'status': 'completed',
                        'conclusion': 'success',
                    }
                ]
            }
        }

    monkeypatch.setattr(mod, '_call_mcp_tool', _fake)
    resp = client.get('/ecosystem/github/prs', params={'repo': 'octo/repo'})
    data = resp.json()
    assert data['status'] == 'success'
    assert data['prs'][0]['title'] == 'real pr'
    assert data['workflows'][0]['name'] == 'CI'
    # The owner/repo split must be passed through to the fleet tool.
    assert ('github-mcp', 'github_pulls') in calls
    assert '482' not in resp.text  # old fabricated PR number
    assert 'multi-mesh tunnel gateways' not in resp.text


def test_github_prs_needs_repo_input_not_fabricated(client, monkeypatch):
    monkeypatch.delenv('GITHUB_REPO', raising=False)

    async def _fake(*a, **k):  # must NOT be called
        raise AssertionError('should not dispatch without a repo')

    monkeypatch.setattr(mod, '_call_mcp_tool', _fake)
    resp = client.get('/ecosystem/github/prs')
    data = resp.json()
    assert data['status'] == 'needs_input'
    assert data['prs'] == []
    assert 'multi-mesh tunnel gateways' not in resp.text


def test_gitlab_mrs_uses_global_scope_endpoint(client, monkeypatch):
    seen = []

    async def _fake(server, tool, arguments, *, timeout=30.0):
        seen.append(arguments['endpoint'])
        if 'merge_requests' in arguments['endpoint']:
            return {
                'data': [
                    {
                        'iid': 4,
                        'project_id': 171,
                        'title': 'Real MR',
                        'author': {'username': 'ai'},
                        'target_branch': 'main',
                        'state': 'opened',
                    }
                ]
            }
        return {'data': [{'id': 9, 'ref': 'main', 'status': 'success'}]}

    monkeypatch.setattr(mod, '_call_mcp_tool', _fake)
    resp = client.get('/ecosystem/gitlab/mrs')
    data = resp.json()
    assert data['status'] == 'success'
    assert data['mrs'][0]['title'] == 'Real MR'
    assert data['pipelines'][0]['id'] == 9
    assert any('scope=all' in e for e in seen)
    assert '#104' not in resp.text
    assert '59124' not in resp.text  # old fabricated pipeline id


def test_atlassian_kanban_groups_issues_by_status(client, monkeypatch):
    _stub_mcp(
        monkeypatch,
        {
            ('atlassian-mcp', 'atlassian_jira_issue'): {
                'status_code': 200,
                'data': {
                    'issues': [
                        {
                            'key': 'OPS-1',
                            'fields': {'summary': 'do it', 'status': {'name': 'To Do'}},
                        },
                        {
                            'key': 'OPS-2',
                            'fields': {
                                'summary': 'doing',
                                'status': {'name': 'In Progress'},
                            },
                        },
                    ]
                },
            }
        },
    )
    resp = client.get('/ecosystem/atlassian/kanban')
    data = resp.json()
    assert data['status'] == 'success'
    titles = {c['title'] for c in data['columns']}
    assert {'To Do', 'In Progress'} <= titles
    assert 'ECO-101' not in resp.text


def test_atlassian_kanban_surfaces_http_error(client, monkeypatch):
    _stub_mcp(
        monkeypatch,
        {
            ('atlassian-mcp', 'atlassian_jira_issue'): {
                'status_code': 404,
                'data': {'content': 'Page Unavailable'},
            }
        },
    )
    resp = client.get('/ecosystem/atlassian/kanban')
    data = resp.json()
    assert data['status'] == 'error'
    assert data['source'] == 'unreachable'
    # A non-2xx from Jira is raised as ``RuntimeError(f'Jira returned HTTP
    # {status_code}')`` and reported through ``_service_error``, which
    # redacts to the exception type (see the honest-error test above). The
    # upstream status code is a property of a third-party service and stays
    # server-side; the client still learns the read failed honestly.
    assert data['detail'] == 'RuntimeError'
    assert data['columns'] == []
    assert 'ECO-101' not in resp.text


def test_mediadownloader_reports_no_backend(client):
    resp = client.get('/ecosystem/mediadownloader/downloads')
    data = resp.json()
    # No real queue backend exists -> honest capability_unavailable, not fakes.
    assert data['status'] == 'capability_unavailable'
    assert data['source'] == 'no_backend'
    assert data['queue'] == []
    assert 'dQw4w9WgXcQ' not in resp.text


def test_stirlingpdf_reports_no_backend(client):
    resp = client.get('/ecosystem/stirlingpdf/jobs')
    data = resp.json()
    assert data['status'] == 'capability_unavailable'
    assert data['source'] == 'no_backend'
    assert data['jobs'] == []
    assert 'pdf-91' not in resp.text


def test_call_mcp_tool_unknown_server_raises():
    """An unresolvable server refuses loudly; it never yields fake data.

    The WebUI no longer owns a fleet registry to consult -- ``_call_mcp_tool``
    delegates through the host's governed seam, which injects
    ``call_mcp_tool`` only after applying its own allowlist and actor policy.
    So "unknown server" is refused one layer out, and with no governed helper
    installed (as in this unit context) the call cannot proceed at all. Either
    way the contract under test is unchanged: it RAISES rather than returning
    a fabricated result.
    """
    import asyncio

    with pytest.raises(RuntimeError, match='Governed MCP delegation is not configured'):
        asyncio.run(mod._call_mcp_tool('definitely-not-a-server', 'x', {}))


def test_call_mcp_tool_rejects_malformed_server_name():
    """The in-repo refusal that survived the delegation refactor."""
    import asyncio

    with pytest.raises(ValueError, match='Invalid delegated server name'):
        asyncio.run(mod._call_mcp_tool('not a server!', 'x', {}))


# --- Non-ecosystem de-stubs (still valid) ----------------------------------


# A well-formed opaque repo reference (``repo:`` + 32 hex) that no real
# repository hashes to. Raw repository *names* and paths are no longer accepted
# across the API boundary -- ``trigger_workspace_bulk_actions`` takes only
# ``_opaque_reference`` handles -- so a syntactically valid handle is required
# to exercise anything past input validation.
_UNRESOLVABLE_REPO_REF = 'repo:' + '0' * 32


def test_bulk_actions_rejects_unknown_action(client):
    resp = client.post(
        '/repository-manager/bulk',
        json={'action': 'deploy-prod', 'targets': [_UNRESOLVABLE_REPO_REF]},
    )
    assert resp.status_code == 400
    # The rejection reason ("Unsupported bulk action 'deploy-prod'. Supported:
    # ['status']") is deliberately redacted at the boundary by the
    # ``HTTPException`` subclass -- echoing it would enumerate the dispatch
    # whitelist to an unauthenticated caller. The contract under test is that
    # a non-whitelisted action is REFUSED, which the 400 proves.
    assert resp.json() == {'detail': 'Invalid request'}
    assert 'deploy-prod' not in resp.text


def test_bulk_actions_rejects_raw_repository_names(client):
    """Repository names/paths never cross the API boundary (opaque refs only)."""
    resp = client.post(
        '/repository-manager/bulk',
        json={'action': 'status', 'targets': ['definitely-not-a-real-repo-xyz']},
    )
    assert resp.status_code == 400
    assert 'definitely-not-a-real-repo-xyz' not in resp.text


def test_bulk_actions_reports_missing_repo(client):
    resp = client.post(
        '/repository-manager/bulk',
        json={'action': 'status', 'targets': [_UNRESOLVABLE_REPO_REF]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'pipelines initialized' not in resp.text
    assert data['results'][0]['status'] == 'error'
    assert data['results'][0]['detail'] == 'repo not found'


def test_container_inventory_reports_unavailable_not_simulated(client):
    """No governed inventory adapter -> honest 501, never a simulated fleet.

    The WebUI intentionally has no direct Docker/Podman socket access any
    more; ``list_docker_containers`` delegates to a governed host adapter that
    owns daemon authorization, transport and audit policy. With no
    ``list_containers`` helper registered (as in this unit context) the honest
    answer is 501 "capability is not available" rather than the old
    socket-probe 503. The invariant this test exists for is unchanged: it
    reports unavailability instead of inventing containers.
    """
    resp = client.get('/container-manager/containers')
    assert resp.status_code == 501
    assert resp.json() == {'detail': 'Capability is not available'}
    assert 'agent-utilities-core' not in resp.text
    assert 'mealie-service' not in resp.text


def test_container_inventory_reports_503_when_adapter_fails(client, monkeypatch):
    """A registered-but-broken adapter degrades to 503, still without fakes."""

    def _broken_list_containers(**_kwargs):
        raise OSError('no docker socket')

    monkeypatch.setitem(
        mod.workspace_helpers, 'list_containers', _broken_list_containers
    )
    resp = client.get('/container-manager/containers')
    assert resp.status_code == 503
    assert resp.json() == {'detail': 'Service unavailable'}
    assert 'no docker socket' not in resp.text
    assert 'agent-utilities-core' not in resp.text
    assert 'mealie-service' not in resp.text


def test_repository_inventory_does_not_invent_standard_repos(
    client, monkeypatch, tmp_path
):
    monkeypatch.setattr(mod, 'get_workspace_dir', lambda: tmp_path)

    resp = client.get('/repository-manager/repos')

    assert resp.status_code == 200
    assert resp.json() == []
    assert 'agent-webui' not in resp.text
    assert 'epistemic-graph' not in resp.text


def test_voice_transcribe_honest_without_whisper(client):
    """No governed transcriber -> honest 501, never a fabricated transcript.

    Transcription no longer shells out to a local ``whisper`` binary (so
    ``api_extensions`` no longer imports ``shutil`` at all, which is why the
    old ``mod.shutil`` monkeypatch targets a dead symbol). One bounded upload
    is delegated to a governed transcription sandbox; with no
    ``transcribe_voice`` helper registered the endpoint refuses with 501
    instead of returning canned text.
    """
    resp = client.post(
        '/voice/transcribe',
        files={'file': ('clip.webm', b'fake-audio-bytes', 'audio/webm')},
    )
    assert resp.status_code == 501
    assert resp.json() == {'detail': 'Capability is not available'}
    assert 'docker containers' not in resp.text


def test_voice_transcribe_threads_governed_transcript(client, monkeypatch):
    """A registered transcriber's real text is threaded through verbatim."""

    def _transcriber(*, content, content_type):
        assert content == b'fake-audio-bytes'
        assert content_type == 'audio/webm'
        return {'text': '  real spoken words  '}

    monkeypatch.setitem(mod.workspace_helpers, 'transcribe_voice', _transcriber)
    resp = client.post(
        '/voice/transcribe',
        files={'file': ('clip.webm', b'fake-audio-bytes', 'audio/webm')},
    )
    assert resp.status_code == 200
    assert resp.json() == {'text': 'real spoken words'}
    assert 'docker containers' not in resp.text


# --- Slash commands: real-or-honest, never canned --------------------------


def _patch_engine(monkeypatch, engine):
    monkeypatch.setattr(
        'agent_utilities.knowledge_graph.core.engine.'
        'IntelligenceGraphEngine.get_active',
        lambda: engine,
    )


def test_slash_graph_impact_uses_engine(client, monkeypatch):
    engine = MagicMock()
    engine.graph.nodes = []
    engine.query_impact.return_value = [
        {'id': 'mod.foo', 'severity': 'high'},
        {'id': 'mod.bar'},
    ]
    _patch_engine(monkeypatch, engine)
    resp = client.post('/commands/execute', json={'command': '/graph impact mysym'})
    body = resp.json()['response_markdown']
    engine.query_impact.assert_called_once_with('mysym')
    assert '2 item(s) affected' in body
    assert 'mod.foo' in body
    assert '100% Secure' not in body


def test_slash_kb_list_honest_empty(client, monkeypatch):
    engine = MagicMock()
    _patch_engine(monkeypatch, engine)
    monkeypatch.setattr(
        'agent_webui.api_extensions.KBIngestionEngine',
        lambda *a, **k: MagicMock(list_knowledge_bases=lambda: []),
    )
    resp = client.post('/commands/execute', json={'command': '/kb list'})
    body = resp.json()['response_markdown']
    assert 'No knowledge bases found' in body
    assert 'mcp-servers-index' not in body


def test_slash_sdd_specs_honest_empty(client, monkeypatch):
    monkeypatch.setattr(
        'agent_webui.api_extensions.SDDManager',
        lambda *a, **k: MagicMock(list_specs=lambda: []),
    )
    resp = client.post('/commands/execute', json={'command': '/sdd specs'})
    body = resp.json()['response_markdown']
    assert 'No specifications found' in body
    assert 'ORCH-1.25' not in body


def test_slash_cron_calendar_honest_empty(client, monkeypatch):
    import sys
    import types

    fake_sched: Any = types.ModuleType('agent_utilities.core.scheduler')
    fake_sched.get_cron_tasks = lambda: MagicMock(tasks=[])
    fake_sched.get_cron_logs = lambda: MagicMock(entries=[])
    monkeypatch.setitem(sys.modules, 'agent_utilities.core.scheduler', fake_sched)
    resp = client.post('/commands/execute', json={'command': '/cron calendar'})
    body = resp.json()['response_markdown']
    assert 'No scheduled background tasks' in body
    assert 'hourly-research-survey' not in body


def test_slash_resources_list_honest_empty(client, monkeypatch):
    engine = MagicMock()
    engine.backend.execute.return_value = []
    _patch_engine(monkeypatch, engine)
    resp = client.post('/commands/execute', json={'command': '/resources list'})
    body = resp.json()['response_markdown']
    assert 'No active subagents' in body
    assert 'agent-research-01' not in body
