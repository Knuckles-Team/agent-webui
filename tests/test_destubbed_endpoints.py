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

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import agent_webui.api_extensions as mod
from agent_webui.api_extensions import router


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
    assert 'backend down' in data['detail']
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
    assert '404' in data['detail']
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
    import asyncio

    with pytest.raises(RuntimeError, match='not found in the fleet registry'):
        asyncio.run(mod._call_mcp_tool('definitely-not-a-server', 'x', {}))


# --- Non-ecosystem de-stubs (still valid) ----------------------------------


def test_bulk_actions_rejects_unknown_action(client):
    resp = client.post(
        '/repository-manager/bulk',
        json={'action': 'deploy-prod', 'targets': ['agent-webui']},
    )
    assert resp.status_code == 400
    assert 'Unsupported bulk action' in resp.text


def test_bulk_actions_reports_missing_repo(client):
    resp = client.post(
        '/repository-manager/bulk',
        json={'action': 'status', 'targets': ['definitely-not-a-real-repo-xyz']},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'pipelines initialized' not in resp.text
    assert data['results'][0]['status'] == 'error'
    assert data['results'][0]['detail'] == 'repo not found'


def test_container_action_reports_failure_not_simulated(client, monkeypatch):
    import socket as _socket

    def _bad_connect(self, *_a, **_k):
        raise OSError('no docker socket')

    monkeypatch.setattr(_socket.socket, 'connect', _bad_connect)
    resp = client.post(
        '/container-manager/containers/abc123/action', json={'action': 'restart'}
    )
    assert resp.status_code == 502
    assert 'Simulated' not in resp.text
    assert 'unreachable' in resp.text.lower()


def test_voice_transcribe_honest_without_whisper(client, monkeypatch):
    import shutil as _shutil

    monkeypatch.setattr(mod.shutil, 'which', lambda _name: None, raising=False)
    monkeypatch.setattr(_shutil, 'which', lambda _name: None)
    resp = client.post(
        '/voice/transcribe',
        files={'file': ('clip.webm', b'fake-audio-bytes', 'audio/webm')},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data['text'] == ''
    assert 'not configured' in data['error']
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
        lambda *a, **k: MagicMock(list_bases=lambda: []),
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
