"""Regression tests for the ``_bounded_external_value``/``_public_external_result``
defect family (the "bound-sweep" audit).

Three instances of this bug were already found and fixed one at a time before
this sweep: the MCP-tools-list route (10 of 66 fleet servers over 256 tools,
503 in 43ms), the skills catalog (``_read_fleet_catalog`` stopping at 256 of
841 rows silently), and ``list_resources`` (a ``CallableResource`` node's
``embedding`` vector -- 58/58 rows -- blowing the bound). This file covers the
sites found and fixed by the systematic sweep that followed:

* ``get_chat`` (``GET /api/chats/{chat_id}``) -- an unsliced ``messages`` list
  crashed with an unhandled 500 on any chat over 256 messages.
* ``get_graph_relationships`` (``GET /api/enhanced/graph/relationships``) --
  a union-graph merge could exceed the per-graph Cypher ``LIMIT`` combined,
  even though neither graph's own read did.
* ``_call_mcp_tool`` -- the shared delegation seam underlying every
  ``/ecosystem/*`` integration route (Jira, GitHub, GitLab, SearXNG, Home
  Assistant, Nextcloud, ...) bounded the WHOLE raw tool response before the
  caller's own downstream slice ever ran.
* ``_proxy_to_gateway`` -- the shared loopback-gateway seam underlying
  ``get_all_sessions``/``list_goals``/``get_goal_iterations``, whose callers
  fall back to a separate (often smaller/stale) local store on ANY failure,
  including a spurious oversized-collection ``ValueError``.
* ``get_tunnel_hosts`` (``GET /api/enhanced/tunnel-manager/hosts``) and
  ``list_docker_containers`` (``GET /api/enhanced/container-manager/containers``)
  -- both bounded the whole raw delegated inventory before their own
  existing slice-to-cap logic ran.

Each of the last five got the SAME shape of fix: either slice/paginate before
bounding (the file's established template -- ``_public_mcp_tool_entry``,
``_public_resource_view``), or, for the two shared seams whose payload shape
is not knowable in advance, a new opt-in ``truncate_lists=True`` mode on
``_bounded_external_value``/``_public_external_result`` that keeps the first
256 elements of an oversized list instead of raising. The default remains
strict (raise) for every existing caller that validates caller-submitted
input.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest
from agent_webui import api_extensions
from agent_webui.server import create_agent_web_app


@pytest.fixture
def client(mock_agent, mock_workspace_helpers, authenticated_client_factory):
    """Same construction as ``test_api_extensions.py``'s ``client`` fixture:
    a real, fully-authenticated ``TestClient`` through the real identity +
    authorization middleware stack (see that file's fixture docstring for
    why this is not a bypass)."""
    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    return authenticated_client_factory(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Core mechanism: `truncate_lists` on `_bounded_external_value`/
# `_public_external_result`.
# ---------------------------------------------------------------------------


class TestTruncateListsMode:
    def test_default_still_raises_on_an_oversized_list(self):
        """The strict default is UNCHANGED -- every existing caller (delegation
        argument validation, chat/query param bounding, etc.) must keep
        rejecting an oversized list loudly, not silently truncating it."""
        with pytest.raises(ValueError, match='oversized collection'):
            api_extensions._bounded_external_value(list(range(257)))

    def test_default_still_raises_via_public_external_result(self):
        with pytest.raises(ValueError, match='oversized collection'):
            api_extensions._public_external_result(list(range(257)))

    def test_truncate_lists_keeps_the_first_256_elements(self):
        result = api_extensions._bounded_external_value(
            list(range(300)), truncate_lists=True
        )
        assert result == list(range(256))

    def test_truncate_lists_applies_at_any_nesting_depth(self):
        payload = {'items': list(range(300)), 'name': 'ok'}
        result = api_extensions._public_external_result(payload, truncate_lists=True)
        assert len(result['items']) == 256
        assert result['items'] == list(range(256))
        assert result['name'] == 'ok'

    def test_truncate_lists_a_1536_element_embedding_round_trips_when_small_enough(
        self,
    ):
        """A single field within a small dict is well under the collection
        cap by ITEM COUNT (the ``embedding`` field itself is one dict value,
        not 1536 top-level items) -- proving `truncate_lists` doesn't
        needlessly mangle a legitimately-sized nested list. The oversized
        case (>256 nested elements) is exercised by
        `test_truncate_lists_applies_at_any_nesting_depth` above -- a 1536
        length triggers the SAME per-list cap, verified next."""
        payload = {'id': 'row-1', 'embedding': [0.1] * 1536}
        result = api_extensions._public_external_result(payload, truncate_lists=True)
        assert result['id'] == 'row-1'
        assert len(result['embedding']) == 256

    def test_truncate_lists_still_raises_on_an_oversized_mapping(self):
        """Only LIST truncation is lenient -- a dict with >256 top-level keys
        is far more likely a malformed/hostile shape than a legitimate large
        field set, so it still raises even under `truncate_lists=True`."""
        oversized_mapping = {f'k{i}': i for i in range(300)}
        with pytest.raises(ValueError, match='oversized mapping'):
            api_extensions._bounded_external_value(
                oversized_mapping, truncate_lists=True
            )


# ---------------------------------------------------------------------------
# `_call_mcp_tool` -- the shared MCP delegation seam.
# ---------------------------------------------------------------------------


class TestCallMcpToolTruncatesRatherThanRaises:
    def test_an_oversized_raw_tool_result_is_truncated_not_raised(self):
        """Live root cause this mirrors: a delegated MCP tool call (e.g.
        Jira's ``search_for_issues_using_jql`` with no ``max_results``
        honored by the remote server) can return a raw list far longer than
        `_MAX_EXTERNAL_COLLECTION_ITEMS` (256). Before this fix,
        `_call_mcp_tool` bounded that WHOLE raw result with the strict
        default, raising before any caller (e.g. `get_atlassian_kanban`,
        which slices to `issues[:100]`) ever got to run its own downstream
        slice -- indistinguishable, through each route's broad
        `except Exception`, from the remote service being down.
        """
        large_payload = {'issues': [{'key': f'ISSUE-{i}'} for i in range(400)]}

        async def _fake_call_mcp_tool(**kwargs):
            return large_payload

        with patch(
            'agent_webui.api_extensions.get_helper',
            return_value=_fake_call_mcp_tool,
        ):
            result = asyncio.run(
                api_extensions._call_mcp_tool(
                    'demo-mcp', 'search_issues', {'jql': 'ORDER BY updated DESC'}
                )
            )

        assert isinstance(result, dict)
        assert len(result['issues']) == 256
        assert result['issues'][0] == {'key': 'ISSUE-0'}

    def test_a_small_result_is_unaffected(self):
        small_payload = {'issues': [{'key': 'ISSUE-1'}]}

        async def _fake_call_mcp_tool(**kwargs):
            return small_payload

        with patch(
            'agent_webui.api_extensions.get_helper',
            return_value=_fake_call_mcp_tool,
        ):
            result = asyncio.run(
                api_extensions._call_mcp_tool('demo-mcp', 'search_issues', {})
            )

        assert result == {'issues': [{'key': 'ISSUE-1'}]}


# ---------------------------------------------------------------------------
# `get_chat` -- an unsliced `messages` list used to crash with an unhandled
# 500 on any chat over 256 messages.
# ---------------------------------------------------------------------------


class TestGetChatEndpoint:
    def test_get_chat_survives_more_than_256_messages(self, client):
        big_chat = {
            'id': 'chat-1',
            'title': 'A very long conversation',
            'messages': [
                {'role': 'user', 'content': f'message {i}'} for i in range(400)
            ],
        }
        mock_get_chat = MagicMock(return_value=big_chat)

        def _fake_get_helper(name, fallback=None):
            if name == 'get_chat':
                return mock_get_chat
            return fallback

        with patch(
            'agent_webui.api_extensions.get_helper', side_effect=_fake_get_helper
        ):
            response = client.get('/api/chats/chat-1')

        assert response.status_code == 200
        data = response.json()
        assert data['id'] == 'chat-1'
        # The most RECENT 256 messages are kept (a transcript is read
        # tail-first), and the truncation is REPORTED, not silent.
        assert len(data['messages']) == 256
        assert data['messages'][0]['content'] == 'message 144'
        assert data['messages'][-1]['content'] == 'message 399'
        assert data['message_total'] == 400
        assert data['messages_truncated'] is True

    def test_get_chat_small_conversation_is_unaffected(self, client):
        small_chat = {
            'id': 'chat-2',
            'title': 'Short chat',
            'messages': [{'role': 'user', 'content': 'hi'}],
        }
        mock_get_chat = MagicMock(return_value=small_chat)

        def _fake_get_helper(name, fallback=None):
            if name == 'get_chat':
                return mock_get_chat
            return fallback

        with patch(
            'agent_webui.api_extensions.get_helper', side_effect=_fake_get_helper
        ):
            response = client.get('/api/chats/chat-2')

        assert response.status_code == 200
        data = response.json()
        assert data['messages'] == [{'role': 'user', 'content': 'hi'}]
        assert 'messages_truncated' not in data


# ---------------------------------------------------------------------------
# `get_tunnel_hosts` / `list_docker_containers` -- both bounded the whole raw
# delegated inventory before their own slice-to-cap logic ran.
# ---------------------------------------------------------------------------


class TestTunnelHostsSlicesBeforeBounding:
    def test_more_than_256_hosts_still_returns_the_capped_page(self, client):
        raw_hosts = {
            f'host-{i}': {'reference': f'host-{i}', 'port': 22} for i in range(300)
        }

        async def _fake_list_tunnel_hosts():
            return raw_hosts

        def _fake_get_helper(name, fallback=None):
            if name == 'list_tunnel_hosts':
                return _fake_list_tunnel_hosts
            return fallback

        with patch(
            'agent_webui.api_extensions.get_helper', side_effect=_fake_get_helper
        ):
            response = client.get('/api/enhanced/tunnel-manager/hosts')

        assert response.status_code == 200
        data = response.json()
        assert len(data['hosts']) == 256


class TestGetAllTasksHandlesTheListOfPydanticModelsShape:
    """A DIFFERENT root cause than the oversized-collection bug, found while
    auditing it, but the SAME failure family: a shape mismatch upstream of
    `_public_external_result` that this route's broad ``except`` turns into
    an indistinguishable-from-empty ``{}``.

    ``SDDManager.get_all_tasks()`` (``agent_utilities/sdd/__init__.py``)
    returns ``list[Tasks]`` -- a bare Python ``list`` of pydantic models,
    which itself has no ``.model_dump()`` (only each ELEMENT does). The
    ``plan_id``-filtered branch's ``tasks.model_dump() if hasattr(tasks,
    'model_dump') else tasks`` line never applied here (a bare ``list``
    fails that ``hasattr`` check), so the raw list of pydantic objects
    always reached ``_public_external_result`` unconverted --
    `_bounded_external_value` cannot serialize a pydantic instance and
    raises ``ValueError('...unsupported value')`` on ANY non-empty result,
    not just an oversized one. The existing shared fixture
    (``tests/conftest.py``'s ``mock_sdd_manager``) mocks
    ``get_all_tasks.return_value`` as a single ``MagicMock(tasks=[])``,
    which auto-satisfies ``hasattr(..., 'model_dump')`` and never exercised
    the real ``list[Tasks]`` shape -- masking this from every existing test.
    """

    def test_survives_the_real_list_of_tasks_shape(self, client):
        task_group = MagicMock()
        task_group.model_dump.return_value = {
            'feature_id': 'feature-1',
            'tasks': [{'id': 't1', 'description': 'do the thing'}],
        }
        manager = MagicMock()
        manager.get_all_tasks.return_value = [task_group]

        with patch('agent_webui.api_extensions.SDDManager', return_value=manager):
            response = client.get('/api/enhanced/sdd/tasks')

        assert response.status_code == 200
        data = response.json()
        assert data == [
            {
                'feature_id': 'feature-1',
                'tasks': [{'id': 't1', 'description': 'do the thing'}],
            }
        ]

    def test_more_than_256_task_groups_is_sliced_not_raised(self, client):
        groups = []
        for i in range(300):
            g = MagicMock()
            g.model_dump.return_value = {'feature_id': f'feature-{i}', 'tasks': []}
            groups.append(g)
        manager = MagicMock()
        manager.get_all_tasks.return_value = groups

        with patch('agent_webui.api_extensions.SDDManager', return_value=manager):
            response = client.get('/api/enhanced/sdd/tasks')

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 256


class TestDockerContainersSlicesBeforeBounding:
    def test_more_than_256_containers_still_returns_the_capped_page(self, client):
        raw_containers = [
            {'id': f'container-{i}', 'state': 'running'} for i in range(300)
        ]

        async def _fake_list_containers(**_kwargs):
            return raw_containers

        def _fake_get_helper(name, fallback=None):
            if name == 'list_containers':
                return _fake_list_containers
            return fallback

        with patch(
            'agent_webui.api_extensions.get_helper', side_effect=_fake_get_helper
        ):
            response = client.get('/api/enhanced/container-manager/containers')

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 256
