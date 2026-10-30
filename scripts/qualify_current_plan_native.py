"""Opt-in current-plan qualification, never application code or an installer.

Set ARBORA_QUALIFICATION_SOURCE to the recorded Arbora source checkout,
EG_QUALIFICATION_FIXTURE to its recorded EG tests/conftest.py counterpart,
and EG_QUALIFICATION_SERVER to the recorded released native executable.
Run from this repository with that Arbora checkout, this repository's agent
package, and the released Python packages on PYTHONPATH. Missing inputs or
version/hash mismatches fail; they never skip and never imply acceptance.

Test-only Arbora identity fixtures and runtime internals compose the actual
WebUI host. Issuer/session facts are synthetic. EG ownership, storage, public
publication/read transport, canonical policy and read/write refusals are real.
No production identity, native-browser journey or installed-wheel claim follows.
"""

import asyncio
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import secrets
import socket
import subprocess
import tempfile
import time
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from epistemic_graph import EngineResponseError, EpistemicGraphClient
from epistemic_graph.client import SyncEpistemicGraphClient
from epistemic_graph.generated.coordination import (
    decode_publish_current_plan,
    send_publish_current_plan,
)


def required_path(name, *, directory=False):
    value = os.environ.get(name)
    path = Path(value).resolve() if value else None
    if path is None or not (path.is_dir() if directory else path.is_file()):
        raise SystemExit(f'Set {name} to the existing recorded qualification input')
    return path


def file_digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def git_value(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


ARBORA_SOURCE = required_path('ARBORA_QUALIFICATION_SOURCE', directory=True)
EG_TEST = required_path('EG_QUALIFICATION_FIXTURE')
BINARY = required_path('EG_QUALIFICATION_SERVER')
EXPECTED_BINARY = 'c33b7ab5835e775eacb43dcea2039a3efce26c7c4b1b5193da4d0bca8956d606'
EXPECTED_FIXTURE = '83300cdba77977cec16841f944cb65831200d966d51df2ed59c2832283ad335d'
EXPECTED_ARBORA = 'b2ef346f8f16973ca4437cbd83fae2d38d7ec24d'
EXPECTED_IDENTITY_FIXTURES = '84546035e6efca8802d473741df7c519cebd8246'
for path, digest in ((BINARY, EXPECTED_BINARY), (EG_TEST, EXPECTED_FIXTURE)):
    if file_digest(path) != digest:
        raise SystemExit('Qualification input SHA-256 mismatch')
for package, version in (
    ('epistemic-graph', '2.27.6'),
    ('agent-connector-sdk', '0.5.4'),
):
    if importlib.metadata.version(package) != version:
        raise SystemExit(f'Qualification requires {package} {version}')
if (
    git_value(ARBORA_SOURCE, 'rev-parse', 'HEAD:arbora') != EXPECTED_ARBORA
    or git_value(ARBORA_SOURCE, 'rev-parse', 'HEAD:tests/identity')
    != EXPECTED_IDENTITY_FIXTURES
    or git_value(
        ARBORA_SOURCE, 'status', '--porcelain', '--', 'arbora', 'tests/identity'
    )
):
    raise SystemExit(
        'Arbora qualification source/fixture tree differs from the receipt'
    )
arbora = importlib.import_module('arbora')

if not Path(arbora.__file__).resolve().is_relative_to(ARBORA_SOURCE):
    raise SystemExit('PYTHONPATH does not select the declared Arbora source overlay')
print(
    'QUALIFICATION_SOURCE',
    json.dumps(
        {
            'arbora_head': git_value(ARBORA_SOURCE, 'rev-parse', 'HEAD'),
            'arbora_code_tree': EXPECTED_ARBORA,
            'identity_fixture_tree': EXPECTED_IDENTITY_FIXTURES,
            'engine_binary_sha256': EXPECTED_BINARY,
            'eg_fixture_sha256': EXPECTED_FIXTURE,
        }
    ),
    flush=True,
)
spec = importlib.util.spec_from_file_location('eg_current_plan_fixture', EG_TEST)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
READER_SCOPES = ['kg:read', 'work:read']
# The public WorkItems client negotiates capabilities through Health, a control op.
# This authority belongs only to the disposable seeding context, never the reader.
SEED_SCOPES = ['service:control', 'work:submit', 'work:claim', 'work:write']


async def exercise(tcp, secret):
    from overstory import host, oidc_session
    from overstory.server import create_agent_web_app
    from arbora.api.http.browser_app import (
        create_browser_api_application,
        create_webui_session_boundary,
    )
    from arbora.api.invoke import invoke
    from arbora.api.invoke.bootstrap import (
        build_invoke_services,
        deny_subject_access,
        dispatch_eg_method,
        verify_current_from_session,
    )
    from arbora.api.invoke.executor import BoundOperationRuntime
    from arbora.api.invoke.plan import EgPlanStore
    from arbora.api.ops.runs import operations
    from arbora.api.policy.eunomia import PolicyGate
    from arbora.api.registry import Registry
    from arbora.identity.admission import BrowserAdmission
    from arbora.identity.engine import Resolution
    from arbora.identity.issuer import LocalIssuer
    from arbora.mcp_server.current_plan_reader import NativeCurrentPlanReader
    from arbora.webui_host.session_boundary import identity_factory_kwargs
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel
    from tests.identity import test_console_admission as admission_fixture
    from tests.identity.test_console_admission import CallerFixture, OwnersFixture
    from tests.identity.test_engine_resolution import resolution_value
    from tests.identity.test_modes_and_browser import ORIGIN, request_scope

    owner = fixture.TEST_AGENT_ID
    tenant = fixture.TEST_TENANT
    seed = await EpistemicGraphClient.connect(
        tcp_addr=tcp,
        auth_secret=secret,
        verified_context=fixture.request_context(scopes=SEED_SCOPES),
    )
    reader = await EpistemicGraphClient.connect(
        tcp_addr=tcp,
        auth_secret=secret,
        verified_context=fixture.request_context(scopes=READER_SCOPES),
    )
    try:
        run_id = 'plan-qualification-' + secrets.token_hex(6)
        now = int(time.time() * 1000)
        context = dict(
            schema_version='2',
            request_id=run_id,
            trace_id=run_id,
            subject_id=owner,
            tenant_id=tenant,
            agent_id=owner,
            scopes=SEED_SCOPES,
            audience=fixture.TEST_AUDIENCE,
            authentication_method='local_process',
            policy_version=fixture.TEST_POLICY_VERSION,
            graph='__commons__',
            placement_epoch=None,
            issued_at_ms=now,
            expires_at_ms=now + 60_000,
        )
        admitted = await seed.work_items.submit(
            dict(
                run_id=run_id,
                schema_version='1',
                context=context,
                work_item_id=None,
                idempotency_key=run_id + ':submit',
                command_digest=hashlib.sha256(
                    b'current-plan-qualification'
                ).hexdigest(),
                kind='current-plan-qualification',
                priority=0,
                depends_on=[],
                input_ref=run_id,
                policy_digest='synthetic-policy',
                catalog_digest='synthetic-catalog',
                model_digest='no-model',
                max_attempts=1,
                deadline_unix=None,
                metadata={},
                provenance_refs=[],
                max_tenant_in_flight=4096,
            )
        )
        claim = await seed.work_items.claim(
            dict(
                schema_version='1',
                tenant_ref=tenant,
                work_item_id=admitted['work_item_id'],
                queue_ref=None,
                resource_class=None,
                fairness_group=None,
                worker_ref=run_id,
                now_ms=now,
                lease_ms=60_000,
                max_tenant_in_flight=4096,
            ),
            idempotency_key=run_id + ':claim',
        )
        assert claim['claimed'] is True, claim
        publication = dict(
            tenant=tenant,
            worker_id=run_id,
            lease_epoch=claim['lease_epoch'],
            fencing_token=claim['fencing_token'],
            idempotency_key=run_id + ':plan:0',
            snapshot=dict(
                run_id=run_id,
                revision=0,
                observed_at_ms=now,
                expires_at_ms=now + 30_000,
                items=[],
                task_plan=None,
            ),
        )
        receipt = decode_publish_current_plan(
            await send_publish_current_plan(
                seed,
                {'request': publication},
                '__commons__',
                idempotency_key=publication['idempotency_key'],
            )
        )
        assert receipt.run_id == run_id
        actual_reader_scopes = list(reader._effective_verified_context()['scopes'])
        assert actual_reader_scopes == READER_SCOPES
        with pytest.raises(EngineResponseError, match='service:control'):
            await reader.health()
        with pytest.raises(EngineResponseError, match='work:write'):
            await send_publish_current_plan(
                reader,
                {'request': publication},
                '__commons__',
                idempotency_key=publication['idempotency_key'],
            )
        print(
            'NATIVE_READER_REFUSALS_OK',
            json.dumps(
                {
                    'actual_reader_scopes': actual_reader_scopes,
                    'control_denied': True,
                    'publication_denied': True,
                }
            ),
            flush=True,
        )
        print(
            'NATIVE_SEED_OK',
            json.dumps(
                {'run_id': run_id, 'revision': receipt.revision, 'scopes': SEED_SCOPES}
            ),
            flush=True,
        )

        backend = OwnersFixture()
        raw = resolution_value()
        raw.update(
            principal_id=owner, kind='service', scopes=READER_SCOPES, roles=['reader']
        )
        raw['request_context'] = fixture.request_context(
            roles=['reader'], scopes=READER_SCOPES
        )
        backend.resolution = Resolution.parse(raw)
        backend.state = replace(backend.state, resolution=backend.resolution)
        session = CallerFixture(backend.resolution)
        session.graph = '__commons__'

        class FixtureIssuer(LocalIssuer):
            def __init__(self):
                pass

            async def issue(self, credential):
                return 'fixture-local-token'

        async def resolve(token):
            assert token == 'fixture-local-token'
            return session

        admission = BrowserAdmission(
            FixtureIssuer(), backend.producer(), resolve, trusted_origin=ORIGIN
        )

        async def native_client(tenant_value):
            assert tenant_value == tenant
            return reader

        async def no_service(*args, **kwargs):
            raise AssertionError('A read must never acquire service/write authority')

        runtime = BoundOperationRuntime(
            caller_client=native_client,
            verify_current=verify_current_from_session,
            service_client=no_service,
            service_claims=no_service,
            check_access=deny_subject_access,
            eg_dispatch=dispatch_eg_method,
            service_scopes=frozenset(),
            service_principal='unused-fixture-service',
            bindings={'current_plan_reader': NativeCurrentPlanReader()},
        )
        registry = Registry(
            tuple(op for op in operations() if op.id == 'runs.current_plan')
        )
        services = build_invoke_services(
            registry=registry,
            runtime=runtime,
            plans=EgPlanStore(reader, lease_kind='console-plan'),
            policy_gate=PolicyGate.from_config(SimpleNamespace(), 'local'),
            audit_client_factory=native_client,
        )

        async def visibility(*args):
            return True

        async def no_auth_action(scope, receive, send):
            raise AssertionError('No login or account mutation requested')

        api = create_browser_api_application(
            admission=admission, services=services, visibility=visibility, invoke=invoke
        )
        boundary = create_webui_session_boundary(
            admission=admission, auth_app=no_auth_action, operations=api
        )
        with pytest.MonkeyPatch.context() as patch:
            # Match the reused synthetic issuer fixture to the native fixture deployment.
            # The real claims_for deployment and authority binding checks remain active.
            patch.setattr(
                admission_fixture,
                'SETTINGS',
                replace(
                    admission_fixture.SETTINGS,
                    tenant=tenant,
                    audience=fixture.TEST_AUDIENCE,
                ),
            )
            for field in ('auth_jwt_jwks_uri', 'auth_jwt_issuer', 'auth_jwt_audience'):
                patch.setattr(host.config, field, None, raising=False)
            patch.setattr(
                host.config, 'allowed_hosts', 'console.invalid', raising=False
            )
            patch.setattr(host.config, 'gateway_rate_limit', 0)
            patch.setattr(host.config, 'gateway_rate_burst', 0)
            patch.setattr(oidc_session, 'load_settings', lambda: None)
            app = create_agent_web_app(
                Agent(TestModel()),
                {'get_path': lambda value: value},
                listener_host='127.0.0.1',
                **identity_factory_kwargs('eg', boundary, factory=create_agent_web_app),
            )

            async def request(run, *, csrf=True):
                path = '/api/v1/ops/runs.current_plan'
                scope = request_scope()
                scope.update(
                    path=path,
                    raw_path=path.encode(),
                    root_path='',
                    scheme='https',
                    http_version='1.1',
                    server=('console.invalid', 443),
                    client=('127.0.0.1', 12345),
                )
                scope['headers'].append((b'content-type', b'application/json'))
                if not csrf:
                    scope['headers'] = [
                        (k, v) for k, v in scope['headers'] if k != b'x-csrf-token'
                    ]
                messages = []

                async def receive():
                    return {
                        'type': 'http.request',
                        'body': json.dumps({'run_id': run}).encode(),
                        'more_body': False,
                    }

                async def send(message):
                    messages.append(message)

                await app(scope, receive, send)
                status = next(
                    m['status'] for m in messages if m['type'] == 'http.response.start'
                )
                body = json.loads(
                    b''.join(
                        m.get('body', b'')
                        for m in messages
                        if m['type'] == 'http.response.body'
                    )
                )
                return status, body

            status, empty = await request(run_id)
            assert status == 200 and empty['ok'] is True, (status, empty)
            assert empty['result']['value']['snapshot']['items'] == [], empty
            assert empty['result']['value']['availability'] == 'available'
            publication['idempotency_key'] = run_id + ':plan:1'
            publication['snapshot']['revision'] = 1
            publication['snapshot']['items'] = [
                {'text': 'Native first', 'status': 'done'},
                {'text': 'Native second', 'status': 'in_progress'},
                {'text': 'Native third', 'status': 'pending'},
            ]
            decode_publish_current_plan(
                await send_publish_current_plan(
                    seed,
                    {'request': publication},
                    '__commons__',
                    idempotency_key=publication['idempotency_key'],
                )
            )
            status, body = await request(run_id)
            assert status == 200 and body['ok'] is True, (status, body)
            value = body['result']['value']
            assert value['snapshot']['items'] == publication['snapshot']['items']
            assert 'task_plan' not in value['snapshot']
            assert (await request('missing-run'))[1]['result']['value'] == {
                'availability': 'unavailable',
                'snapshot': None,
            }
            assert (await request(run_id, csrf=False))[0] == 401
            print(
                'NATIVE_HOST_READ_OK',
                json.dumps(
                    {
                        'reader_scopes': READER_SCOPES,
                        'result': value,
                        'empty_available': True,
                        'missing_unavailable': True,
                        'csrf_refused': True,
                        'identity_fixture': 'synthetic qualified browser authority',
                        'producer': 'released EG2.27.6 public WorkItem lease and current-plan operations',
                    }
                ),
                flush=True,
            )
    finally:
        await reader.close()
        await seed.close()


with tempfile.TemporaryDirectory(prefix='current-plan-native-') as temp:
    root = Path(temp)
    secret = secrets.token_urlsafe(32)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    env = {'PATH': os.environ['PATH'], 'HOME': temp, 'LANG': 'C.UTF-8'}
    env.update(
        fixture.strict_server_env(
            str(root / 'security'), auth_secret=secret, persist_dir=str(root / 'data')
        )
    )
    env['EPISTEMIC_GRAPH_ENCRYPTION_KEY'] = secrets.token_hex(32)
    with (root / 'server.log').open('w') as log:
        process = subprocess.Popen(
            [
                BINARY,
                '--auth-mode',
                'authenticated',
                '--tcp-only',
                '--tcp-addr',
                f'127.0.0.1:{port}',
                '--persist-dir',
                str(root / 'data'),
            ],
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                assert process.poll() is None, 'Native server exited during startup'
                with socket.socket() as probe:
                    if probe.connect_ex(('127.0.0.1', port)) == 0:
                        break
                time.sleep(0.05)
            else:
                raise AssertionError('native startup deadline')
            bootstrap = SyncEpistemicGraphClient.connect(
                tcp_addr=f'127.0.0.1:{port}',
                auth_secret=secret,
                verified_context=fixture.bootstrap_context(),
            )
            try:
                bootstrap.consensus.bootstrap_system_identity(
                    agent_id=fixture.TEST_AGENT_ID,
                    signer_id=fixture.TEST_AGENT_ID,
                    signer_key=fixture.TEST_SIGNER_KEY,
                )
            finally:
                bootstrap.close()
            asyncio.run(exercise(f'127.0.0.1:{port}', secret))
        finally:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
