from __future__ import annotations

import json
from collections.abc import Generator
from typing import Any

import agent_webui.api_extensions as api_extensions
import pytest
from agent_webui.server import WebUIAuthorizationMiddleware
from pydantic import ValidationError


def _json(response: Any) -> Any:
    return json.loads(response.body)


@pytest.fixture
def dispatcher() -> Generator[list[tuple[str, dict[str, Any]]], None, None]:
    calls: list[tuple[str, dict[str, Any]]] = []

    def dispatch(tool_name: str, kwargs: dict[str, Any]) -> dict[str, Any]:
        calls.append((tool_name, kwargs))
        return {'status': 'success', 'tool': tool_name}

    api_extensions.set_atlas_source_dispatcher(dispatch)
    yield calls
    api_extensions.set_atlas_source_dispatcher(None)


@pytest.mark.asyncio
async def test_provider_route_uses_source_catalog(
    dispatcher: list[tuple[str, dict[str, Any]]],
) -> None:
    def catalog(tool_name: str, kwargs: dict[str, Any]) -> dict[str, Any]:
        dispatcher.append((tool_name, kwargs))
        return {'sources': {'available': True, 'items': ['postgres']}}

    api_extensions.set_atlas_source_dispatcher(catalog)
    response = await api_extensions.atlas_source_providers()

    assert response.status_code == 200
    assert dispatcher == [('graph_catalog', {'action': 'list'})]
    assert _json(response) == {'available': True, 'items': ['postgres']}


@pytest.mark.asyncio
async def test_ui_catalog_projects_only_the_canonical_sources_leg() -> None:
    def catalog(_tool_name: str, _kwargs: dict[str, Any]) -> dict[str, Any]:
        return {
            'graphs': {'available': True},
            'sources': {
                'available': True,
                'items': {
                    'schema_version': 'atlas-source-catalog.v1',
                    'sources': [
                        {
                            'provider': 'postgresql',
                            'label': 'PostgreSQL',
                            'availability': 'available',
                            'available': True,
                            'reason': 'registered connection is live',
                            'queryMode': 'sql',
                            'dialects': ['postgresql', 'sql'],
                            'capabilities': ['query', 'schema_discovery'],
                            'connectionNames': ['warehouse'],
                            'connectionProfileRef': 'secret://atlas/warehouse',
                        }
                    ],
                },
            },
        }

    api_extensions.set_atlas_source_dispatcher(catalog)
    try:
        response = await api_extensions.atlas_source_catalog()
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    assert response.status_code == 200
    body = _json(response)
    assert body['catalog_version'] == 'atlas-source-catalog.v1'
    assert body['providers'][0]['source_id'] == 'postgresql'
    assert body['providers'][0]['query_modes'] == ['sql', 'postgresql']
    assert (
        body['providers'][0]['connection']['profile_ref'] == 'secret://atlas/warehouse'
    )


@pytest.mark.asyncio
async def test_ui_catalog_translates_current_au_source_catalog_shape() -> None:
    def catalog(_tool_name: str, _kwargs: dict[str, Any]) -> dict[str, Any]:
        return {
            'sources': {
                'schema_version': 'atlas-source-catalog.v1',
                'sources': [
                    {
                        'provider': 'postgresql',
                        'label': 'PostgreSQL',
                        'kind': 'database',
                        'availability': 'available',
                        'available': True,
                        'reason': 'registered connection is live',
                        'query_mode': 'sql',
                        'dialects': ['postgresql', 'sql'],
                        'sync': {
                            'supported': False,
                            'entrypoint': 'source_sync',
                            'reason': 'source_sync adapter is not registered',
                        },
                        'capabilities': ['query', 'schema_discovery'],
                        'connection_names': ['warehouse'],
                        'connection_profile_ref': 'secret://atlas/warehouse',
                    }
                ],
                'query_surfaces': [],
                'source_connector_types': [],
            }
        }

    api_extensions.set_atlas_source_dispatcher(catalog)
    try:
        response = await api_extensions.atlas_source_catalog()
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    assert response.status_code == 200
    body = _json(response)
    assert body['catalog_version'] == 'atlas-source-catalog.v1'
    assert body['providers'][0]['source_id'] == 'postgresql'
    assert body['providers'][0]['availability']['state'] == 'available'
    assert (
        body['providers'][0]['connection']['profile_ref'] == 'secret://atlas/warehouse'
    )


@pytest.mark.asyncio
async def test_ui_connection_connect_forwards_only_profile_reference() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    def configure(tool_name: str, kwargs: dict[str, Any]) -> dict[str, Any]:
        calls.append((tool_name, kwargs))
        return {'status': 'success', 'action': 'add_connection', 'persisted': True}

    api_extensions.set_atlas_source_dispatcher(configure)
    request = api_extensions.AtlasConnectSourceRequest(
        source_id='source:postgres',
        connection_profile_ref='secret://atlas/postgres',
    )
    try:
        response = await api_extensions.atlas_source_connection_connect(
            'source:postgres', request
        )
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    assert response.status_code == 200
    assert _json(response)['connection']['state'] == 'checking'
    declaration = json.loads(calls[0][1]['config_value'])
    assert declaration == {
        'backend': 'postgres',
        'source_alias': 'postgres',
        'connection_profile_ref': 'secret://atlas/postgres',
        'role': 'read',
        'require_approval': True,
    }
    assert calls[0][1]['config_key'] == 'postgres'
    assert all(
        field not in declaration
        for field in ('endpoint', 'dsn', 'username', 'password', 'variables')
    )


@pytest.mark.asyncio
async def test_ui_connection_status_projects_readiness_without_connector_details() -> (
    None
):
    def doctor(_tool_name: str, kwargs: dict[str, Any]) -> dict[str, Any]:
        assert kwargs['config_key'] == 'postgres'
        return {
            'status': 'ready',
            'ready': True,
            'backend': 'postgresql',
            'endpoint': 'postgres://secret@example.invalid/db',
        }

    api_extensions.set_atlas_source_dispatcher(doctor)
    try:
        response = await api_extensions.atlas_source_connection_status_ui(
            'source:postgres'
        )
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    assert response.status_code == 200
    body = _json(response)
    assert body['state'] == 'connected'
    assert 'endpoint' not in response.body.decode()


@pytest.mark.asyncio
async def test_connection_create_sends_only_reference_declaration(
    dispatcher: list[tuple[str, dict[str, Any]]],
) -> None:
    request = api_extensions.AtlasConnectionCreate(
        name='warehouse',
        backend='postgres',
        source_alias='warehouse',
        connection_profile_ref='secret://atlas/warehouse/connection',
        auth_profile_ref='vault://atlas/warehouse/auth',
        tls_profile_ref='env://ATLAS_TLS_PROFILE',
        variables_ref='secret://atlas/warehouse/variables',
    )

    response = await api_extensions.atlas_source_connection_create(request)

    assert response.status_code == 200
    tool_name, kwargs = dispatcher[0]
    assert tool_name == 'graph_configure'
    assert kwargs['action'] == 'add_connection'
    assert kwargs['config_key'] == 'warehouse'
    declaration = json.loads(kwargs['config_value'])
    assert declaration['connection_profile_ref'].startswith('secret://')
    assert declaration['auth_profile_ref'].startswith('vault://')
    assert 'name' not in declaration
    assert all(
        field not in declaration
        for field in ('endpoint', 'dsn', 'username', 'password', 'variables')
    )


def test_connection_model_rejects_raw_endpoint_and_extra_secret_fields() -> None:
    with pytest.raises(ValidationError):
        api_extensions.AtlasConnectionCreate.model_validate(
            {
                'name': 'warehouse',
                'backend': 'postgres',
                'endpoint': 'postgres://alice:secret@example.invalid/db',
            }
        )

    with pytest.raises(ValidationError):
        api_extensions.AtlasConnectionCreate.model_validate(
            {
                'name': 'warehouse',
                'backend': 'postgres',
                'connection_profile_ref': 'postgres://alice:secret@example.invalid/db',
            }
        )

    with pytest.raises(ValidationError):
        api_extensions.AtlasSourceSync.model_validate(
            {
                'source': 'warehouse',
                'ids': ['postgres://alice:secret@example.invalid/db'],
            }
        )


@pytest.mark.asyncio
async def test_mapping_approval_forwards_digest_bound_proposal_version(
    dispatcher: list[tuple[str, dict[str, Any]]],
) -> None:
    request = api_extensions.AtlasMappingApproval(
        proposal_id='proposal-1',
        proposal_version=7,
        schema_digest='sha256:' + 'a' * 64,
        mapping_digest='sha256:' + 'b' * 64,
    )

    response = await api_extensions.atlas_source_connection_mapping_approve(
        'warehouse', request
    )

    assert response.status_code == 200
    assert dispatcher[0] == (
        'graph_configure',
        {
            'action': 'approve_connection_mapping',
            'config_key': 'warehouse',
            'config_value': json.dumps(
                {
                    'proposal_id': 'proposal-1',
                    'schema_digest': 'sha256:' + 'a' * 64,
                    'mapping_digest': 'sha256:' + 'b' * 64,
                    'proposal_version': 7,
                },
                separators=(',', ':'),
            ),
        },
    )


@pytest.mark.asyncio
async def test_mapping_status_uses_the_canonical_no_payload_contract(
    dispatcher: list[tuple[str, dict[str, Any]]],
) -> None:
    response = await api_extensions.atlas_source_connection_mapping('warehouse')

    assert response.status_code == 200
    assert dispatcher[0] == (
        'graph_configure',
        {
            'action': 'connection_mapping_status',
            'config_key': 'warehouse',
            'config_value': '',
        },
    )


@pytest.mark.asyncio
async def test_sync_route_uses_canonical_source_sync(
    dispatcher: list[tuple[str, dict[str, Any]]],
) -> None:
    request = api_extensions.AtlasSyncRequest(
        source='warehouse',
        mode='delta',
        ids=['record-1', 'record-2'],
        connection='default',
        graph='tenant-a',
    )

    response = await api_extensions.atlas_source_sync(request)

    assert response.status_code == 200
    assert dispatcher == [
        (
            'source_sync',
            {
                'source': 'warehouse',
                'mode': 'delta',
                'ids_json': '["record-1","record-2"]',
                'connection': 'default',
                'graph': 'tenant-a',
            },
        )
    ]


@pytest.mark.asyncio
async def test_sync_preview_uses_non_executable_source_catalog_action(
    dispatcher: list[tuple[str, dict[str, Any]]],
) -> None:
    request = api_extensions.AtlasSyncPreview(source='warehouse', mode='full')

    response = await api_extensions.atlas_source_sync_preview(request)

    assert response.status_code == 501
    assert dispatcher == [
        (
            'graph_catalog',
            {
                'action': 'preview_sync',
                'source': 'warehouse',
                'mode': 'full',
                'ids_json': '[]',
                'connection': '',
                'graph': '',
            },
        )
    ]


@pytest.mark.asyncio
async def test_nested_unavailable_error_is_a_truthful_501_without_backend_detail() -> (
    None
):
    def unavailable(_tool_name: str, _kwargs: dict[str, Any]) -> dict[str, Any]:
        return {
            'envelope': {
                'result': {'status': 'error', 'error': 'active engine required'}
            }
        }

    api_extensions.set_atlas_source_dispatcher(unavailable)
    try:
        response = await api_extensions.atlas_source_providers()
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    assert response.status_code == 501
    body = _json(response)
    assert body == {
        'status': 'error',
        'error': {
            'code': 'capability_unavailable',
            'operation': 'providers',
            'message': 'Atlas source capability is unavailable.',
        },
    }
    assert 'active engine required' not in response.body.decode()


@pytest.mark.asyncio
async def test_cancel_is_unavailable_when_source_drain_has_no_cancel_action() -> None:
    def no_cancel(_tool_name: str, _kwargs: dict[str, Any]) -> dict[str, Any]:
        raise AssertionError(
            'unsupported source_drain cancellation must not be dispatched'
        )

    api_extensions.set_atlas_source_dispatcher(no_cancel)
    try:
        response = await api_extensions.atlas_source_run_cancel('run-1')
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    assert response.status_code == 501
    assert _json(response)['error']['code'] == 'capability_unavailable'


@pytest.mark.asyncio
async def test_aggregate_is_unavailable_when_source_drain_has_no_aggregate_action() -> (
    None
):
    def no_aggregate(_tool_name: str, _kwargs: dict[str, Any]) -> dict[str, Any]:
        raise AssertionError(
            'unsupported source_drain aggregation must not be dispatched'
        )

    api_extensions.set_atlas_source_dispatcher(no_aggregate)
    try:
        response = await api_extensions.atlas_source_sync_runs('postgres')
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    assert response.status_code == 501
    assert _json(response)['error']['code'] == 'capability_unavailable'


@pytest.mark.asyncio
async def test_sync_cancel_is_unavailable_without_a_canonical_cancel_action() -> None:
    def no_cancel(_tool_name: str, _kwargs: dict[str, Any]) -> dict[str, Any]:
        raise AssertionError(
            'unsupported source_drain cancellation must not be dispatched'
        )

    api_extensions.set_atlas_source_dispatcher(no_cancel)
    request = api_extensions.AtlasCancelSyncRequest(run_id='run-1')
    try:
        response = await api_extensions.atlas_source_sync_cancel('run-1', request)
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    assert response.status_code == 501
    assert _json(response)['error']['code'] == 'capability_unavailable'


@pytest.mark.asyncio
async def test_result_projection_drops_connection_material_but_keeps_refs_and_presence() -> (
    None
):
    def result(_tool_name: str, _kwargs: dict[str, Any]) -> dict[str, Any]:
        return {
            'connection': {
                'name': 'warehouse',
                'endpoint': 'postgres://alice:secret@example.invalid/db',
                'username': 'alice',
                'auth_profile_ref': 'secret://atlas/warehouse/auth',
            },
            'credentials': {
                'configured': True,
                'password': 'secret',
                'metadata': {
                    'configured': True,
                    'endpoint': 'postgres://nested-secret@example.invalid/db',
                    'token': 'nested-secret',
                },
            },
        }

    api_extensions.set_atlas_source_dispatcher(result)
    try:
        response = await api_extensions.atlas_source_connections()
    finally:
        api_extensions.set_atlas_source_dispatcher(None)

    body = _json(response)
    assert body['connection'] == {
        'name': 'warehouse',
        'auth_profile_ref': 'secret://atlas/warehouse/auth',
    }
    assert body['credentials'] == {
        'configured': True,
        'metadata': {'configured': True},
    }
    assert 'endpoint' not in response.body.decode()
    assert 'alice' not in response.body.decode()
    assert 'nested-secret' not in response.body.decode()


def test_atlas_authorization_classification_keeps_reads_and_previews_read_only() -> (
    None
):
    scope = WebUIAuthorizationMiddleware._required_scope
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/providers',
            method='GET',
        )
        == 'kg:read'
    )
    assert (
        scope(scope_type='http', path='/api/enhanced/atlas/sources', method='GET')
        == 'kg:read'
    )
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/source:postgres/connection',
            method='POST',
        )
        == 'kg:admin'
    )
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/connections',
            method='GET',
        )
        == 'kg:read'
    )
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/connections',
            method='POST',
        )
        == 'kg:admin'
    )
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/connections/pg/discover',
            method='POST',
        )
        == 'kg:read'
    )
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/connections/pg/nested/discover',
            method='POST',
        )
        == 'kg:admin'
    )
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/sync/preview',
            method='POST',
        )
        == 'kg:read'
    )
    assert (
        scope(scope_type='http', path='/api/enhanced/atlas/sync/preview', method='POST')
        == 'kg:read'
    )
    assert (
        scope(scope_type='http', path='/api/enhanced/atlas/sync/runs', method='POST')
        == 'kg:admin'
    )
    assert (
        scope(scope_type='http', path='/api/enhanced/atlas/sync/runs', method='GET')
        == 'kg:read'
    )
    assert (
        scope(scope_type='http', path='/api/enhanced/atlas/sources/sync', method='POST')
        == 'kg:admin'
    )
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/runs/run-1',
            method='GET',
        )
        == 'kg:read'
    )
    assert (
        scope(
            scope_type='http',
            path='/api/enhanced/atlas/sources/runs/run-1/cancel',
            method='POST',
        )
        == 'kg:admin'
    )
