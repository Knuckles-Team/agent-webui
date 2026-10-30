import hashlib
import json
import os
import threading
import time
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import uvicorn
from overstory.host import config
from overstory.server import create_agent_web_app
from arbora.fleet.catalog_reader import (
    CatalogComponent,
    CatalogServer,
    ComponentContent,
    ComponentRecord,
    FleetCatalog,
    ReadContext,
    ReadReceipt,
    ServerRegistration,
)
from arbora.gateway.enhanced_catalog_api import (
    EnhancedCatalogAuthority,
    configure_enhanced_catalog,
)
from arbora.webui_host.webui_co_service import compose_web_application
from authlib.jose import JsonWebKey, jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

OUTPUT_DIR = Path(os.environ['OPERATE_QUALIFICATION_DIR'])

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
jwk = JsonWebKey.import_key(
    key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ),
    {'kid': 'synthetic-catalog'},
)
public = jwk.as_dict(is_private=False)


class Jwks(BaseHTTPRequestHandler):
    def do_GET(self):
        data = json.dumps({'keys': [public]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(data)


issuer = ThreadingHTTPServer(('127.0.0.1', 0), Jwks)
threading.Thread(target=issuer.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{issuer.server_port}'
config.auth_jwt_jwks_uri = url + '/jwks'
config.auth_jwt_issuer = url
config.auth_jwt_audience = 'operate-catalog-synthetic'
config.kg_policy_version = 'synthetic-v1'
token = jwt.encode(
    {'alg': 'RS256', 'kid': 'synthetic-catalog'},
    {
        'iss': url,
        'aud': config.auth_jwt_audience,
        'sub': 'catalog-reader',
        'tenant': 'synthetic',
        'scope': 'kg:read',
        'iat': int(time.time()),
        'exp': int(time.time()) + 1800,
    },
    jwk,
).decode()
(OUTPUT_DIR / 'operate-readiness-served-token').write_text(token)
context = ReadContext(
    tenant_id='synthetic',
    principal_id='catalog-reader',
    agent_id='synthetic',
    audience='arbora',
    policy_version='synthetic-v1',
)


def server(name, live):
    digest = 'sha256:' + hashlib.sha256(name.encode()).hexdigest()
    component = ComponentRecord(
        component_id='component:' + name,
        kind='mcp_server',
        server_name=name,
        upstream_name=name,
        summary='Synthetic catalog server',
        tenant_id='synthetic',
        entry_revision=1,
        definition_digest=digest,
        content_digest=digest,
        lifecycle='published',
        provenance_server=None,
    )
    content = ComponentContent(
        component_id=component.component_id,
        entry_revision=1,
        definition_digest=digest,
        content_digest=digest,
        media_type='application/json',
        body=b'{}',
        receipt=ReadReceipt(
            context=context, source='AgentComponent.Content', graph='synthetic'
        ),
    )
    registration = (
        ServerRegistration(
            server_id='srv:' + name,
            name=name,
            url='https://synthetic.invalid/mcp',
            resources=(),
            registered_at_ms=1,
            last_heartbeat_ms=2,
            lease_expires_at_ms=9999999999999,
        )
        if live
        else None
    )
    provided = tuple(
        CatalogComponent(
            entry=replace(
                component,
                component_id=kind + ':' + name,
                kind=kind,
                upstream_name='shared-name',
                summary='Synthetic ' + kind + ' definition',
            ),
            content=content,
        )
        for kind in ('tool', 'skill')
    )
    return CatalogServer(
        registration=registration,
        component=component,
        content=content,
        provides=provided,
    )


class Fleet:
    async def read(self, *, kinds):
        assert kinds == ('mcp_server', 'tool', 'skill')
        if (OUTPUT_DIR / 'operate-catalog-refuse').exists():
            raise RuntimeError('synthetic unavailable authority')
        return FleetCatalog(
            context=context,
            servers=(
                server('catalog-registered', True),
                server('catalog-unregistered', False),
            ),
        )


class Workflows:
    async def list_current_workflows(self):
        return ()


class Agents:
    async def list_authorized_agents(self):
        return ()


configure_enhanced_catalog(
    EnhancedCatalogAuthority(fleet=Fleet(), workflows=Workflows(), agents=Agents())
)
from arbora.core.settings import runtime_config
from arbora.gateway.ports import configure_gateway_application

for name in (
    'auth_jwt_jwks_uri',
    'auth_jwt_issuer',
    'auth_jwt_audience',
    'kg_policy_version',
):
    setattr(runtime_config, name, getattr(config, name))


class Application:
    lifecycle: list[str] = []

    async def execute_tool(self, tool, **kwargs):
        raise RuntimeError('No synthetic tool authority')

    def engine(self):
        raise RuntimeError('No synthetic engine authority')

    def ensure_tools_registered(self):
        self.lifecycle.append('ensure_tools_registered')

    def mount_rest_routes(self, app, *, prefix):
        self.lifecycle.append('mount_rest_routes:' + prefix)

    def remote_oauth_grant_bindings(self, actor):
        return ()


configure_gateway_application(Application())
from arbora.observability.readiness import check, register_probe

register_probe('engine', lambda: check('ready', source='synthetic engine authority'))


def dependency_probe():
    if (OUTPUT_DIR / 'operate-readiness-recovered').exists():
        return check('ready', detail={'pending': 0}, source='synthetic probe')
    return check(
        'degraded',
        reason='Synthetic backlog',
        detail={'pending': 3, 'evidence': ['synthetic durable receipt']},
    )


register_probe('synthetic_dependency', dependency_probe)
from starlette.responses import JSONResponse


class SyntheticBrowserSession:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http' and scope['path'] == '/auth/session':
            # Synthetic browser identity only. Catalog and SPA traffic remain real HTTP.
            await JSONResponse(
                {
                    'authenticated': True,
                    'subject': 'catalog-reader',
                    'tenant': 'synthetic',
                    'webui_role': 'reader',
                    'roles': ['kg:read'],
                }
            )(scope, receive, send)
            return
        await self.app(scope, receive, send)


def session_boundary(app):
    app.add_middleware(SyntheticBrowserSession)


app = create_agent_web_app(
    Agent(TestModel()),
    workspace_helpers={},
    listener_host='127.0.0.1',
    application_composer=compose_web_application,
    session_boundary=session_boundary,
)
print(
    'Catalog route count:',
    sum(getattr(r, 'path', None) == '/api/enhanced/tools' for r in app.routes),
    flush=True,
)
uvicorn.run(app, host='127.0.0.1', port=18766, access_log=False)
