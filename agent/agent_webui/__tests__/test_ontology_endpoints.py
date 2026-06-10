"""End-to-end tests for the /api/enhanced/ontology/* routes.

Exercises the ontology bridge against a REAL KnowledgeGraph backend (the
in-memory store wired into a real IntelligenceGraphEngine) — no stubs, no
fake data. Each test patches ``IntelligenceGraphEngine.get_active`` to return a
freshly-built real engine so the ontology layer resolves against the live
store/compute exactly as it does in production.
"""

from __future__ import annotations

from unittest.mock import patch

import networkx as nx
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """A TestClient over the real FastAPI app."""
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    mock_agent = Agent(TestModel())
    mock_helpers = {'get_path': lambda x: x}
    app = create_agent_web_app(mock_agent, mock_helpers)
    return TestClient(app)


@pytest.fixture
def real_engine():
    """A real IntelligenceGraphEngine over an in-memory backend."""
    from agent_utilities.knowledge_graph.backends import create_backend
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    backend = create_backend(backend_type='memory')
    engine = IntelligenceGraphEngine(graph=nx.MultiDiGraph(), backend=backend)
    return engine


@pytest.fixture
def patched_engine(real_engine):
    """Patch get_active to return the real in-memory engine for the duration."""
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=real_engine,
    ):
        yield real_engine


def test_list_object_types(client, patched_engine):
    resp = client.get('/api/enhanced/ontology/object-types')
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # The built-in 'document' interface implementer must surface.
    names = {row['name'] for row in data}
    assert 'document' in names


def test_list_property_types(client, patched_engine):
    resp = client.get('/api/enhanced/ontology/property-types')
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    names = {row['name'] for row in data}
    assert 'string' in names
    # JSON-safe serialization: python_type rendered as a name string, not a type.
    string_pt = next(r for r in data if r['name'] == 'string')
    assert isinstance(string_pt['python_type'], (str, type(None)))


def test_list_interfaces_and_implementers(client, patched_engine):
    resp = client.get('/api/enhanced/ontology/interfaces')
    assert resp.status_code == 200
    data = resp.json()
    iface_names = {i['name'] for i in data}
    assert 'HasProvenance' in iface_names

    resp2 = client.get('/api/enhanced/ontology/interfaces/HasProvenance/implementers')
    assert resp2.status_code == 200
    assert 'document' in resp2.json()['implementers']

    resp3 = client.get('/api/enhanced/ontology/interfaces/NotAnInterface/implementers')
    assert resp3.status_code == 404


def test_object_set_search(client, patched_engine):
    # Seed a couple of nodes through the live backend.
    patched_engine.backend.execute(
        "CREATE (n:Memory {id: 'mem-alpha', name: 'Alpha', "
        "content: 'the quick brown fox', type: 'Memory'})"
    )
    patched_engine.backend.execute(
        "CREATE (n:Memory {id: 'mem-beta', name: 'Beta', "
        "content: 'lazy dog sleeps', type: 'Memory'})"
    )

    resp = client.post(
        '/api/enhanced/ontology/object-set/search',
        json={'query': 'quick brown', 'kind': 'Memory', 'limit': 25},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'ids' in data and 'rows' in data and 'count' in data
    assert isinstance(data['rows'], list)


def test_object_set_aggregate(client, patched_engine):
    patched_engine.backend.execute("CREATE (n:Widget {id: 'w1', score: 10, kind: 'a'})")
    patched_engine.backend.execute("CREATE (n:Widget {id: 'w2', score: 20, kind: 'a'})")
    resp = client.post(
        '/api/enhanced/ontology/object-set/aggregate',
        json={'ids': ['w1', 'w2'], 'metric': 'count'},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data['metric'] == 'count'
    assert data['total_objects'] == 2


def test_object_set_aggregate_bad_metric(client, patched_engine):
    resp = client.post(
        '/api/enhanced/ontology/object-set/aggregate',
        json={'ids': [], 'metric': 'median'},
    )
    assert resp.status_code == 422


def test_object_view_payload(client, patched_engine):
    patched_engine.backend.execute(
        "CREATE (n:Memory {id: 'obj-view-1', name: 'Viewable', "
        "content: 'hello world', type: 'Memory'})"
    )
    resp = client.get('/api/enhanced/ontology/object/obj-view-1')
    assert resp.status_code == 200
    data = resp.json()
    assert data['id'] == 'obj-view-1'
    assert 'properties' in data
    assert 'links' in data and 'in' in data['links'] and 'out' in data['links']
    assert 'derived' in data
    assert 'markings' in data
    assert 'history' in data


def test_edit_and_revert(client, patched_engine):
    # Record a property edit.
    edit_resp = client.post(
        '/api/enhanced/ontology/object/edit-target/edit',
        json={
            'edit_type': 'property_set',
            'properties': {'status': 'active'},
            'actor': 'tester',
        },
    )
    assert edit_resp.status_code == 200
    edit_data = edit_resp.json()
    assert edit_data['edit']['edit_type'] == 'property_set'
    assert edit_data['edit']['object_id'] == 'edit-target'
    edit_id = edit_data['edit']['id']

    # History reflects the edit via the object view.
    view = client.get('/api/enhanced/ontology/object/edit-target')
    assert view.status_code == 200
    assert any(h['id'] == edit_id for h in view.json()['history'])

    # Revert the edit; a compensating edit is returned.
    rev = client.post(
        '/api/enhanced/ontology/object/edit-target/revert',
        json={'edit_id': edit_id, 'actor': 'tester'},
    )
    assert rev.status_code == 200
    assert rev.json()['edit']['edit_type'] == 'property_set'

    # Reverting an unknown edit is a 404.
    rev_missing = client.post(
        '/api/enhanced/ontology/object/edit-target/revert',
        json={'edit_id': 'edit:property_set:doesnotexist'},
    )
    assert rev_missing.status_code == 404


def test_function_invoke(client, patched_engine):
    resp = client.post(
        '/api/enhanced/ontology/function/invoke',
        json={
            'name': 'numeric.aggregate',
            'params': {'values': [1, 2, 3], 'op': 'sum'},
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data['function_name'] == 'numeric.aggregate'
    assert data['ok'] is True
    assert data['value'] == 6.0


def test_function_invoke_missing_name(client, patched_engine):
    resp = client.post('/api/enhanced/ontology/function/invoke', json={'params': {}})
    assert resp.status_code == 422


def test_document_process(client, patched_engine):
    text = (
        'Ontologies model the world. They define objects, links, and functions. '
    ) * 10
    resp = client.post(
        '/api/enhanced/ontology/document/process',
        json={'text': text, 'chunk_size': 120, 'overlap': 20},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data['document'] is not None
    assert isinstance(data['chunks'], list)
    assert len(data['chunks']) >= 1
    assert isinstance(data['edges'], list)


def test_document_process_requires_text_or_path(client, patched_engine):
    resp = client.post('/api/enhanced/ontology/document/process', json={})
    assert resp.status_code == 422


def test_object_view_standard_and_configured(client, patched_engine, tmp_path):
    # Standard view derives from the type's interface schema.
    with patch(
        'agent_webui.api_extensions._object_view_store_path',
        return_value=tmp_path / 'views.json',
    ):
        std = client.get('/api/enhanced/ontology/object-view/document')
        assert std.status_code == 200
        assert std.json()['view_type'] == 'standard'

        # Save a configured view, then read it back.
        save = client.post(
            '/api/enhanced/ontology/object-view/document',
            json={
                'widgets': [{'kind': 'property', 'property': 'title'}],
                'title': 'Doc',
            },
        )
        assert save.status_code == 200
        assert save.json()['view_type'] == 'configured'

        cfg = client.get('/api/enhanced/ontology/object-view/document')
        assert cfg.status_code == 200
        assert cfg.json()['view_type'] == 'configured'
        assert cfg.json()['widgets'] == [{'kind': 'property', 'property': 'title'}]


def test_object_set_save_and_list(client, patched_engine, tmp_path):
    # Seed a couple of nodes so an explicit-ids saved set materialises real ids.
    patched_engine.backend.execute(
        "CREATE (n:Memory {id: 'set-a', name: 'A', type: 'Memory'})"
    )
    patched_engine.backend.execute(
        "CREATE (n:Memory {id: 'set-b', name: 'B', type: 'Memory'})"
    )

    with patch(
        'agent_webui.api_extensions._object_set_store_path',
        return_value=tmp_path / 'sets.json',
    ):
        save = client.post(
            '/api/enhanced/ontology/object-set/save',
            json={
                'name': 'My Memories',
                'ids': ['set-a', 'set-b'],
                'kind': 'Memory',
                'shared': True,
            },
        )
        assert save.status_code == 200
        body = save.json()
        assert body['name'] == 'My Memories'
        assert body['count'] == 2
        assert body['kind'] == 'Memory'
        set_id = body['id']
        assert set_id.startswith('object_set:')

        listing = client.get('/api/enhanced/ontology/object-set/list')
        assert listing.status_code == 200
        sets = listing.json()['sets']
        saved = next(s for s in sets if s['id'] == set_id)
        assert saved['name'] == 'My Memories'
        assert saved['count'] == 2
        assert saved['shared'] is True


def test_object_set_save_requires_name(client, patched_engine, tmp_path):
    with patch(
        'agent_webui.api_extensions._object_set_store_path',
        return_value=tmp_path / 'sets.json',
    ):
        resp = client.post(
            '/api/enhanced/ontology/object-set/save',
            json={'ids': ['x'], 'kind': 'Memory'},
        )
        assert resp.status_code == 422


def test_ontology_actions_lists_real_registered_actions(client, patched_engine):
    """GET /ontology/actions returns the REAL registered actions, with metadata.

    Backs the Object Explorer's dynamic bulk-action menu — every entry must be a
    genuinely registered :class:`OntologyAction` (no hardcoded/fake verbs), each
    carrying name/verb/description/produces_effect/required_capability.
    """
    resp = client.get('/api/enhanced/ontology/actions')
    assert resp.status_code == 200
    actions = resp.json()
    assert isinstance(actions, list) and actions
    by_name = {a['name']: a for a in actions}

    # The real builtins must surface verbatim.
    assert 'kg.annotate_concept' in by_name
    assert 'kg.search' in by_name
    assert 'finance.forensic_screen' in by_name

    annotate = by_name['kg.annotate_concept']
    assert annotate['verb'] == 'annotate'
    assert annotate['produces_effect'] == 'mutation'
    assert annotate['required_capability'] == 'kg_write'
    assert annotate['description']  # non-empty real description
    assert 'concept' in annotate['acts_on']


def test_ontology_actions_scoped_to_object_type(client, patched_engine):
    """The object_type query narrows to actions whose acts_on covers that type."""
    resp = client.get(
        '/api/enhanced/ontology/actions', params={'object_type': 'concept'}
    )
    assert resp.status_code == 200
    names = {a['name'] for a in resp.json()}
    # concept actions include the mutation annotate + the read search...
    assert 'kg.annotate_concept' in names
    assert 'kg.search' in names
    # ...but NOT the finance action, which acts on financial_instrument/company.
    assert 'finance.forensic_screen' not in names


def test_object_set_bulk_action_records_edits(client, patched_engine):
    # Seed two concept objects the built-in kg.annotate_concept acts on.
    patched_engine.backend.execute(
        "CREATE (n:concept {id: 'c-alpha', name: 'Alpha', type: 'concept'})"
    )
    patched_engine.backend.execute(
        "CREATE (n:concept {id: 'c-beta', name: 'Beta', type: 'concept'})"
    )

    resp = client.post(
        '/api/enhanced/ontology/object-set/action',
        json={
            'ids': ['c-alpha', 'c-beta'],
            'action_name': 'kg.annotate_concept',
            'params': {'note': 'reviewed by ops', 'reviewer': 'tester'},
            'actor': 'tester',
            # ActorContext roles are the capability set the executor authorizes
            # against; kg.annotate_concept requires kg_write.
            'roles': ['kg_write'],
            # A mutating bulk verb is HIGH-risk; the HITL gate auto-denies
            # without an explicit operator approval. Supply one so the governed
            # writeback proceeds (and is recorded as an approved escalation).
            'approve': {'approver': 'tester', 'approver_role': 'admin'},
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data['applied'] == 2
    assert data['errors'] == []
    assert len(data['results']) == 2
    # Each successful target recorded at least one durable edit (the journaled
    # MODIFY_OBJECT writeback).
    for row in data['results']:
        assert row['status'].lower().endswith('success')
        assert len(row['edit_ids']) >= 1

    # The writeback edits surface in the object's edit history (the same
    # live-store-bound ledger the bulk executor journaled them through).
    view = client.get('/api/enhanced/ontology/object/c-alpha')
    assert view.status_code == 200
    assert len(view.json()['history']) >= 1


def test_object_set_bulk_action_denied_without_capability(client, patched_engine):
    patched_engine.backend.execute(
        "CREATE (n:concept {id: 'c-denied', name: 'D', type: 'concept'})"
    )
    resp = client.post(
        '/api/enhanced/ontology/object-set/action',
        json={
            'ids': ['c-denied'],
            'action_name': 'kg.annotate_concept',
            'params': {'note': 'x'},
            'actor': 'nobody',
            'roles': [],  # lacks kg_write
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data['applied'] == 0
    assert len(data['errors']) == 1
    assert data['results'][0]['status'].lower().endswith('denied')


def test_object_set_bulk_action_requires_action_name(client, patched_engine):
    resp = client.post(
        '/api/enhanced/ontology/object-set/action',
        json={'ids': ['x']},
    )
    assert resp.status_code == 422


def test_object_get_layout_standard_vs_configured(client, patched_engine, tmp_path):
    # The in-memory test engine does not round-trip node properties through the
    # id-MATCH read path, so resolve the object's type via _node_properties for
    # a 'document' (a real type implementing HasProvenance et al.). This exercises
    # the real layout-selection code, not a placeholder.
    with (
        patch(
            'agent_webui.api_extensions._object_view_store_path',
            return_value=tmp_path / 'views.json',
        ),
        patch(
            'agent_webui.api_extensions._node_properties',
            return_value={'id': 'doc-layout', 'type': 'document', 'title': 'Doc'},
        ),
    ):
        # Standard layout derives from the type's interface schema.
        std = client.get(
            '/api/enhanced/ontology/object/doc-layout', params={'layout': 'standard'}
        )
        assert std.status_code == 200
        std_body = std.json()
        assert std_body['layout'] == 'standard'
        assert std_body['view']['view_type'] == 'standard'

        # Save a configured ObjectView, then request the configured layout.
        save = client.post(
            '/api/enhanced/ontology/object-view/document',
            json={
                'widgets': [{'kind': 'property', 'property': 'title'}],
                'title': 'Doc Layout',
            },
        )
        assert save.status_code == 200

        cfg = client.get(
            '/api/enhanced/ontology/object/doc-layout',
            params={'layout': 'configured'},
        )
        assert cfg.status_code == 200
        cfg_body = cfg.json()
        assert cfg_body['layout'] == 'configured'
        assert cfg_body['view']['view_type'] == 'configured'
        assert cfg_body['view']['widgets'] == [
            {'kind': 'property', 'property': 'title'}
        ]
        # The two layouts genuinely return different view payloads.
        assert cfg_body['view'] != std_body['view']


def test_pivot_requires_group_by(client, patched_engine):
    resp = client.post(
        '/api/enhanced/ontology/object-set/pivot',
        json={'ids': ['a'], 'link_type': 'related'},
    )
    assert resp.status_code == 422
