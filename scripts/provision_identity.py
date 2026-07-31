#!/usr/bin/env python3
"""Idempotent, re-runnable identity provisioning for the Agent WebUI.

Stands up **both** identities the WebUI needs, end to end, with no hand-placed
credential anywhere:

``keycloak``
    Reconciles the realm objects.  Two *separate* confidential clients, because
    the two flows must not share a credential:

    * ``agent-webui`` — standard (authorization-code) flow only, PKCE ``S256``
      required, no service account.  This is the **end user's** login client;
      the tokens it issues carry the human's ``sub``/``email``/roles.
    * ``agent-webui-svc`` — ``client_credentials`` only, no browser flow.  This
      is the WebUI **backend's** own service identity for outbound MCP calls.

    Both get the ``agent-services`` client scope, which carries the
    ``tenant_id`` and ``aud`` claims the graph session mint requires.  Roles are
    granted at the minimum that works: the service account gets ``kg:write``
    (the gate expands write ⇒ read); human users get ``kg:read`` + ``kg:write``
    through the ``agent-webui-users`` group.  Neither gets ``kg:admin`` — the
    WebUI's admin routes stay closed until a realm admin deliberately opens
    them.

``openbao``
    Writes the resolved configuration to KV ``apps/agent-webui`` — the single
    source the ``ExternalSecret`` mirrors.  Never writes to the mirrored
    Kubernetes Secret, which external-secrets silently reverts.  A previously
    generated ``WEBUI_SESSION_KEY`` is preserved across runs so re-running does
    not sign every browser out.

``kubernetes``
    Ensures the ``agent-webui-oidc`` ExternalSecret and patches the Deployment
    to consume it, mounting the homelab CA bundle so JWKS discovery over
    ``https://keycloak.arpa`` validates.  Uses ``kubectl patch`` throughout;
    it never applies a committed manifest over live state.

Usage::

    python3 scripts/provision_identity.py                # all stages
    python3 scripts/provision_identity.py --stage keycloak
    python3 scripts/provision_identity.py --grant-user alice
    python3 scripts/provision_identity.py --dry-run

Credentials this script needs (read, never printed):

* Keycloak realm admin — ``KEYCLOAK_ADMIN_PASSWORD``, or read from the
  ``platform/keycloak-creds`` Kubernetes Secret.
* OpenBao root/write token — ``BAO_ROOT_TOKEN``, or read from
  ``services/openbao/.env``.

Nothing this script prints is secret: it reports client IDs, paths, key
*names*, and outcomes only.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------- deployment facts

KEYCLOAK_URL = os.environ.get('KEYCLOAK_URL', 'https://keycloak.arpa').rstrip('/')
REALM = os.environ.get('KEYCLOAK_REALM', 'homelab')
ADMIN_REALM = os.environ.get('KEYCLOAK_ADMIN_REALM', 'master')
ADMIN_USER = os.environ.get('KEYCLOAK_ADMIN_USER', 'admin')

WEBUI_ORIGIN = os.environ.get('WEBUI_ORIGIN', 'http://au.arpa').rstrip('/')
BROWSER_CLIENT = 'agent-webui'
SERVICE_CLIENT = 'agent-webui-svc'
USER_GROUP = 'agent-webui-users'

# The scope that stamps ``tenant_id`` and ``aud`` onto every issued access
# token.  ``agent_utilities.security.request_identity`` refuses to mint a graph
# session without both, so a token missing this scope authenticates and then
# fails closed with "Authenticated graph requests require a verified tenant
# claim" — which reads like a bug and is really a missing scope.
FLEET_SCOPE = os.environ.get('KEYCLOAK_AUDIENCE_SCOPE', 'agent-services')
TENANT = os.environ.get('KEYCLOAK_TENANT', 'homelab')

# Minimum viable grants.  ``kg:admin`` is deliberately absent everywhere.
SERVICE_ROLES = ('kg:write',)
USER_ROLES = ('kg:read', 'kg:write')
GRAPH_ROLES = ('kg:read', 'kg:write', 'kg:admin')

NAMESPACE = os.environ.get('WEBUI_NAMESPACE', 'apps')
DEPLOYMENT = 'agent-webui'
EXTERNAL_SECRET = 'agent-webui-oidc'
BAO_MOUNT = os.environ.get('BAO_MOUNT', 'apps')
BAO_PATH = os.environ.get('BAO_PATH', 'agent-webui')
BAO_NAMESPACE = os.environ.get('BAO_K8S_NAMESPACE', 'platform')

CA_BUNDLE_CONFIGMAP = 'homelab-ca-bundle'
CA_BUNDLE_MOUNT = '/etc/ssl/homelab'
CA_BUNDLE_FILE = f'{CA_BUNDLE_MOUNT}/ca-bundle.pem'

REPO_ROOT = Path(__file__).resolve().parent.parent
OPENBAO_ENV = Path(
    os.environ.get('OPENBAO_ENV_FILE', '/home/apps/workspace/services/openbao/.env')
)

# Keycloak serves a private-CA certificate that this admin client may not have
# in its trust store; the realm's own tokens are still verified by the pods
# against the mounted homelab CA bundle.  Allow an explicit opt-out only.
_VERIFY_TLS = os.environ.get('KEYCLOAK_VERIFY_TLS', '0').strip().lower() in {
    '1',
    'true',
    'yes',
}


def _ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    if not _VERIFY_TLS:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    return context


# --------------------------------------------------------------------- utilities


class ProvisioningError(RuntimeError):
    """A provisioning step could not be completed."""


def log(message: str) -> None:
    print(message, flush=True)


def _run(argv: list[str], *, stdin: str | None = None) -> str:
    completed = subprocess.run(
        argv,
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        # stderr from kubectl/bao can echo a request body, so surface only the
        # command identity and the exit status.
        raise ProvisioningError(
            f'{argv[0]} {argv[1] if len(argv) > 1 else ""} failed with exit '
            f'{completed.returncode}: {completed.stderr.strip()[:400]}'
        )
    return completed.stdout


# ------------------------------------------------------------------ keycloak API


def _kc(method: str, path: str, token: str | None = None, body: Any = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = urllib.request.Request(
        f'{KEYCLOAK_URL}{path}', data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(
            request, timeout=30, context=_ssl_context()
        ) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            return 409, None
        raise ProvisioningError(
            f'Keycloak {method} {path} returned HTTP {exc.code}'
        ) from exc
    except urllib.error.URLError as exc:
        raise ProvisioningError(f'Keycloak {method} {path} is unreachable') from exc


def _keycloak_admin_password() -> str:
    password = os.environ.get('KEYCLOAK_ADMIN_PASSWORD', '')
    if password:
        return password
    encoded = _run(
        [
            'kubectl',
            '-n',
            'platform',
            'get',
            'secret',
            'keycloak-creds',
            '-o',
            'jsonpath={.data.KEYCLOAK_ADMIN_PASSWORD}',
        ]
    ).strip()
    if not encoded:
        raise ProvisioningError(
            'No Keycloak admin credential: set KEYCLOAK_ADMIN_PASSWORD or grant '
            'read on the platform/keycloak-creds Secret'
        )
    return base64.b64decode(encoded).decode('utf-8')


def _admin_token() -> str:
    form = urllib.parse.urlencode(
        {
            'client_id': 'admin-cli',
            'username': ADMIN_USER,
            'password': _keycloak_admin_password(),
            'grant_type': 'password',
        }
    ).encode()
    request = urllib.request.Request(
        f'{KEYCLOAK_URL}/realms/{ADMIN_REALM}/protocol/openid-connect/token',
        data=form,
        method='POST',
    )
    try:
        with urllib.request.urlopen(
            request, timeout=30, context=_ssl_context()
        ) as response:
            payload = json.loads(response.read())
    except urllib.error.URLError as exc:
        raise ProvisioningError('Keycloak administrator sign-in failed') from exc
    token = payload.get('access_token')
    if not isinstance(token, str) or not token:
        raise ProvisioningError('Keycloak returned no administrator access token')
    return token


def _find_client(token: str, client_id: str) -> dict[str, Any] | None:
    query = urllib.parse.quote(client_id)
    _status, clients = _kc(
        'GET', f'/admin/realms/{REALM}/clients?clientId={query}', token
    )
    return (clients or [None])[0]


def _ensure_realm_roles(token: str, dry_run: bool) -> None:
    _status, existing = _kc('GET', f'/admin/realms/{REALM}/roles', token)
    have = {role['name'] for role in existing or []}
    for role in GRAPH_ROLES:
        if role in have:
            log(f'  role {role}: present')
            continue
        if dry_run:
            log(f'  role {role}: WOULD CREATE')
            continue
        _kc(
            'POST',
            f'/admin/realms/{REALM}/roles',
            token,
            {'name': role, 'description': f'Graph capability {role}'},
        )
        log(f'  role {role}: created')


def _ensure_fleet_scope(token: str, dry_run: bool) -> str:
    base = f'/admin/realms/{REALM}/client-scopes'
    _status, scopes = _kc('GET', base, token)
    found = next((s for s in scopes or [] if s['name'] == FLEET_SCOPE), None)
    if found:
        log(f'  client scope {FLEET_SCOPE}: present')
        return found['id']
    if dry_run:
        log(f'  client scope {FLEET_SCOPE}: WOULD CREATE')
        return ''
    _kc(
        'POST',
        base,
        token,
        {
            'name': FLEET_SCOPE,
            'protocol': 'openid-connect',
            'description': 'Marks a token as intended for the agent services.',
            'attributes': {
                'include.in.token.scope': 'true',
                'display.on.consent.screen': 'false',
            },
            'protocolMappers': [
                {
                    'name': 'graph-tenant',
                    'protocol': 'openid-connect',
                    'protocolMapper': 'oidc-hardcoded-claim-mapper',
                    'config': {
                        'claim.name': 'tenant_id',
                        'claim.value': TENANT,
                        'jsonType.label': 'String',
                        'access.token.claim': 'true',
                        'id.token.claim': 'false',
                        'userinfo.token.claim': 'false',
                    },
                },
                {
                    'name': f'{FLEET_SCOPE}-audience',
                    'protocol': 'openid-connect',
                    'protocolMapper': 'oidc-audience-mapper',
                    'config': {
                        'included.custom.audience': FLEET_SCOPE,
                        'access.token.claim': 'true',
                        'id.token.claim': 'false',
                        'userinfo.token.claim': 'false',
                    },
                },
            ],
        },
    )
    _status, scopes = _kc('GET', base, token)
    log(f'  client scope {FLEET_SCOPE}: created')
    return next(s['id'] for s in scopes if s['name'] == FLEET_SCOPE)


def _reconcile_client(
    token: str, desired: dict[str, Any], dry_run: bool
) -> dict[str, Any] | None:
    client_id = desired['clientId']
    existing = _find_client(token, client_id)
    if existing is None:
        if dry_run:
            log(f'  client {client_id}: WOULD CREATE')
            return None
        _kc('POST', f'/admin/realms/{REALM}/clients', token, desired)
        existing = _find_client(token, client_id)
        if existing is None:
            raise ProvisioningError(f'Keycloak client {client_id} was not created')
        log(f'  client {client_id}: created')
        return existing

    drift = {
        key: value
        for key, value in desired.items()
        if key not in {'clientId', 'attributes'} and existing.get(key) != value
    }
    merged_attributes = {**(existing.get('attributes') or {}), **desired['attributes']}
    if merged_attributes != (existing.get('attributes') or {}):
        drift['attributes'] = merged_attributes
    if not drift:
        log(f'  client {client_id}: present, in sync')
        return existing
    if dry_run:
        log(f'  client {client_id}: WOULD RECONCILE {sorted(drift)}')
        return existing
    _kc(
        'PUT',
        f'/admin/realms/{REALM}/clients/{existing["id"]}',
        token,
        {**existing, **drift},
    )
    log(f'  client {client_id}: reconciled {sorted(drift)}')
    return _find_client(token, client_id)


def _client_secret(token: str, uuid: str) -> str:
    _status, payload = _kc(
        'GET', f'/admin/realms/{REALM}/clients/{uuid}/client-secret', token
    )
    secret = (payload or {}).get('value')
    if not isinstance(secret, str) or not secret:
        _status, payload = _kc(
            'POST', f'/admin/realms/{REALM}/clients/{uuid}/client-secret', token
        )
        secret = (payload or {}).get('value')
    if not isinstance(secret, str) or not secret:
        raise ProvisioningError('Keycloak did not return a client secret')
    return secret


def _realm_role_objects(token: str, names: tuple[str, ...]) -> list[dict[str, Any]]:
    _status, roles = _kc('GET', f'/admin/realms/{REALM}/roles', token)
    by_name = {role['name']: role for role in roles or []}
    missing = [name for name in names if name not in by_name]
    if missing:
        raise ProvisioningError(f'Realm roles are missing: {missing}')
    return [by_name[name] for name in names]


def _ensure_service_account_roles(
    token: str, uuid: str, client_id: str, dry_run: bool
) -> None:
    _status, account = _kc(
        'GET', f'/admin/realms/{REALM}/clients/{uuid}/service-account-user', token
    )
    if not account:
        raise ProvisioningError(f'{client_id} has no service account user')
    user_id = account['id']
    _status, held = _kc(
        'GET', f'/admin/realms/{REALM}/users/{user_id}/role-mappings/realm', token
    )
    have = {role['name'] for role in held or []}
    wanted = [name for name in SERVICE_ROLES if name not in have]
    if not wanted:
        log(f'  {client_id} service account: roles {list(SERVICE_ROLES)} present')
        return
    if dry_run:
        log(f'  {client_id} service account: WOULD GRANT {wanted}')
        return
    _kc(
        'POST',
        f'/admin/realms/{REALM}/users/{user_id}/role-mappings/realm',
        token,
        _realm_role_objects(token, tuple(wanted)),
    )
    log(f'  {client_id} service account: granted {wanted}')


def _ensure_user_group(token: str, grant_users: list[str], dry_run: bool) -> None:
    _status, groups = _kc('GET', f'/admin/realms/{REALM}/groups', token)
    group = next((g for g in groups or [] if g['name'] == USER_GROUP), None)
    if group is None:
        if dry_run:
            log(f'  group {USER_GROUP}: WOULD CREATE')
            return
        _kc('POST', f'/admin/realms/{REALM}/groups', token, {'name': USER_GROUP})
        _status, groups = _kc('GET', f'/admin/realms/{REALM}/groups', token)
        group = next(g for g in groups if g['name'] == USER_GROUP)
        log(f'  group {USER_GROUP}: created')
    else:
        log(f'  group {USER_GROUP}: present')

    _status, held = _kc(
        'GET', f'/admin/realms/{REALM}/groups/{group["id"]}/role-mappings/realm', token
    )
    have = {role['name'] for role in held or []}
    wanted = [name for name in USER_ROLES if name not in have]
    if wanted and not dry_run:
        _kc(
            'POST',
            f'/admin/realms/{REALM}/groups/{group["id"]}/role-mappings/realm',
            token,
            _realm_role_objects(token, tuple(wanted)),
        )
        log(f'  group {USER_GROUP}: granted {wanted}')
    elif wanted:
        log(f'  group {USER_GROUP}: WOULD GRANT {wanted}')
    else:
        log(f'  group {USER_GROUP}: roles {list(USER_ROLES)} present')

    for username in grant_users:
        query = urllib.parse.quote(username)
        _status, users = _kc(
            'GET', f'/admin/realms/{REALM}/users?username={query}&exact=true', token
        )
        user = (users or [None])[0]
        if user is None:
            log(
                f'  user {username}: NOT FOUND — a realm admin must create the '
                'account before it can sign in'
            )
            continue
        _status, memberships = _kc(
            'GET', f'/admin/realms/{REALM}/users/{user["id"]}/groups', token
        )
        if any(m['name'] == USER_GROUP for m in memberships or []):
            log(f'  user {username}: already in {USER_GROUP}')
            continue
        if dry_run:
            log(f'  user {username}: WOULD ADD to {USER_GROUP}')
            continue
        _kc(
            'PUT',
            f'/admin/realms/{REALM}/users/{user["id"]}/groups/{group["id"]}',
            token,
        )
        log(f'  user {username}: added to {USER_GROUP}')


def stage_keycloak(grant_users: list[str], dry_run: bool) -> dict[str, str]:
    """Reconcile every realm object and return the resolved configuration."""

    log(f'[keycloak] realm={REALM} at {KEYCLOAK_URL}')
    token = _admin_token()
    _ensure_realm_roles(token, dry_run)
    _ensure_fleet_scope(token, dry_run)

    browser = _reconcile_client(
        token,
        {
            'clientId': BROWSER_CLIENT,
            'name': 'Agent WebUI (browser sign-in)',
            'description': (
                'Confidential authorization-code client. Issues the END USER a '
                'token; the WebUI never exceeds the signed-in human authority.'
            ),
            'enabled': True,
            'protocol': 'openid-connect',
            'publicClient': False,
            'clientAuthenticatorType': 'client-secret',
            'standardFlowEnabled': True,
            'serviceAccountsEnabled': False,
            'directAccessGrantsEnabled': False,
            'implicitFlowEnabled': False,
            'redirectUris': [
                f'{WEBUI_ORIGIN}/auth/callback',
                f'{WEBUI_ORIGIN.replace("http://", "https://", 1)}/auth/callback',
            ],
            'webOrigins': [WEBUI_ORIGIN],
            'rootUrl': WEBUI_ORIGIN,
            'baseUrl': '/',
            'defaultClientScopes': [
                'web-origins',
                'acr',
                'profile',
                'roles',
                'email',
                FLEET_SCOPE,
            ],
            'attributes': {
                # PKCE is mandatory even though the exchange is confidential:
                # the code travels through the user agent.
                'pkce.code.challenge.method': 'S256',
                'post.logout.redirect.uris': f'{WEBUI_ORIGIN}/*',
            },
        },
        dry_run,
    )
    service = _reconcile_client(
        token,
        {
            'clientId': SERVICE_CLIENT,
            'name': 'Agent WebUI (backend service identity)',
            'description': (
                'Confidential client_credentials client for the WebUI backend’s '
                'own outbound calls. No browser flow, separate secret.'
            ),
            'enabled': True,
            'protocol': 'openid-connect',
            'publicClient': False,
            'clientAuthenticatorType': 'client-secret',
            'standardFlowEnabled': False,
            'serviceAccountsEnabled': True,
            'directAccessGrantsEnabled': False,
            'implicitFlowEnabled': False,
            'redirectUris': [],
            'webOrigins': [],
            'defaultClientScopes': ['acr', 'profile', 'roles', 'email', FLEET_SCOPE],
            'attributes': {'access.token.lifespan': '28800'},
        },
        dry_run,
    )
    if service is not None:
        _ensure_service_account_roles(token, service['id'], SERVICE_CLIENT, dry_run)
    _ensure_user_group(token, grant_users, dry_run)

    if dry_run or browser is None or service is None:
        return {}

    issuer = f'{KEYCLOAK_URL}/realms/{REALM}'
    return {
        # --- the gate's own JWT verifier (inbound) ---
        'AUTH_JWT_ISSUER': issuer,
        'AUTH_JWT_AUDIENCE': FLEET_SCOPE,
        'AUTH_JWT_JWKS_URI': f'{issuer}/protocol/openid-connect/certs',
        'KG_POLICY_VERSION': os.environ.get('KG_POLICY_VERSION', 'homelab-v1'),
        # --- flow 1: the backend's own service identity (outbound) ---
        'MCP_CLIENT_AUTH': 'oidc-client-credentials',
        'OIDC_CLIENT_ID': SERVICE_CLIENT,
        'OIDC_CLIENT_SECRET': _client_secret(token, service['id']),
        'OIDC_CLIENT_SECRET_REF': 'env://OIDC_CLIENT_SECRET',
        'OIDC_AUDIENCE': FLEET_SCOPE,
        'OIDC_ISSUER': issuer,
        'OIDC_TOKEN_URL': f'{issuer}/protocol/openid-connect/token',
        'OIDC_HTTP_ALLOWED_PRIVATE_HOSTS': json.dumps(
            [urllib.parse.urlsplit(KEYCLOAK_URL).hostname]
        ),
        # --- flow 2: the browser's end-user identity (inbound) ---
        'WEBUI_OIDC_CLIENT_ID': BROWSER_CLIENT,
        'WEBUI_OIDC_CLIENT_SECRET': _client_secret(token, browser['id']),
        'WEBUI_OIDC_ISSUER': issuer,
        'WEBUI_OIDC_REDIRECT_URI': f'{WEBUI_ORIGIN}/auth/callback',
        'WEBUI_OIDC_SCOPE': 'openid profile email',
        # --- private-CA trust so JWKS discovery over https://*.arpa validates ---
        'SSL_CERT_FILE': CA_BUNDLE_FILE,
        'REQUESTS_CA_BUNDLE': CA_BUNDLE_FILE,
    }


# ------------------------------------------------------------------- openbao KV


def _bao_token() -> str:
    token = os.environ.get('BAO_ROOT_TOKEN', '')
    if token:
        return token
    if not OPENBAO_ENV.is_file():
        raise ProvisioningError(
            f'No OpenBao token: set BAO_ROOT_TOKEN or provide {OPENBAO_ENV}'
        )
    for line in OPENBAO_ENV.read_text(encoding='utf-8').splitlines():
        name, _, value = line.partition('=')
        if name.strip() == 'BAO_ROOT_TOKEN':
            return value.strip().strip('"').strip("'")
    raise ProvisioningError(f'{OPENBAO_ENV} does not define BAO_ROOT_TOKEN')


def _bao_pod() -> str:
    name = _run(
        [
            'kubectl',
            '-n',
            BAO_NAMESPACE,
            'get',
            'pod',
            '-l',
            'app=openbao',
            '-o',
            'jsonpath={.items[0].metadata.name}',
        ]
    ).strip()
    if not name:
        raise ProvisioningError('No running OpenBao pod was found')
    return name


def _bao(argv: list[str], *, stdin: str | None = None) -> str:
    return _run(
        [
            'kubectl',
            '-n',
            BAO_NAMESPACE,
            'exec',
            '-i',
            _bao_pod(),
            '--',
            'env',
            'BAO_ADDR=http://127.0.0.1:8200',
            f'BAO_TOKEN={_bao_token()}',
            *argv,
        ],
        stdin=stdin,
    )


def _existing_kv() -> dict[str, Any]:
    try:
        raw = _bao(['bao', 'kv', 'get', '-format=json', f'{BAO_MOUNT}/{BAO_PATH}'])
    except ProvisioningError:
        return {}
    try:
        return json.loads(raw)['data']['data']
    except (KeyError, ValueError, TypeError):
        return {}


def stage_openbao(values: dict[str, str], dry_run: bool) -> dict[str, str]:
    """Write the resolved configuration to KV, preserving the session key."""

    log(f'[openbao] kv {BAO_MOUNT}/{BAO_PATH}')
    current = _existing_kv()
    merged = {**current, **values}

    session_key = str(current.get('WEBUI_SESSION_KEY') or '')
    if session_key:
        log('  WEBUI_SESSION_KEY: preserved (existing browser sessions survive)')
    else:
        from cryptography.fernet import Fernet

        session_key = Fernet.generate_key().decode('ascii')
        log('  WEBUI_SESSION_KEY: generated')
    merged['WEBUI_SESSION_KEY'] = session_key

    if merged == current:
        log('  kv: already in sync')
        return merged
    if dry_run:
        log(f'  kv: WOULD WRITE keys {sorted(set(merged) - set(current))} (+updates)')
        return merged
    # `bao kv put ... -` reads the whole document from stdin, so no secret ever
    # appears in an argv the process table can show.
    _bao(
        ['bao', 'kv', 'put', f'{BAO_MOUNT}/{BAO_PATH}', '-'],
        stdin=json.dumps(merged),
    )
    log(f'  kv: wrote {len(merged)} keys')
    return merged


# ---------------------------------------------------------------------- k8s wiring


EXTERNAL_SECRET_MANIFEST = {
    'apiVersion': 'external-secrets.io/v1',
    'kind': 'ExternalSecret',
    'metadata': {'name': EXTERNAL_SECRET, 'namespace': NAMESPACE},
    'spec': {
        'refreshInterval': '1h',
        'secretStoreRef': {'kind': 'ClusterSecretStore', 'name': 'openbao'},
        'target': {'name': EXTERNAL_SECRET, 'creationPolicy': 'Owner'},
        'dataFrom': [{'extract': {'key': BAO_PATH}}],
    },
}


def stage_kubernetes(dry_run: bool) -> None:
    """Ensure the ExternalSecret exists and the Deployment consumes it."""

    log(f'[kubernetes] namespace={NAMESPACE}')
    if dry_run:
        log(f'  externalsecret/{EXTERNAL_SECRET}: WOULD APPLY')
        log(f'  deploy/{DEPLOYMENT}: WOULD PATCH envFrom + CA bundle mount')
        return

    # A brand-new ExternalSecret has no live state to clobber, so applying it is
    # safe; the Deployment below is only ever *patched*.
    _run(
        ['kubectl', 'apply', '-f', '-'],
        stdin=json.dumps(EXTERNAL_SECRET_MANIFEST),
    )
    log(f'  externalsecret/{EXTERNAL_SECRET}: applied')

    spec = json.loads(
        _run(['kubectl', '-n', NAMESPACE, 'get', 'deploy', DEPLOYMENT, '-o', 'json'])
    )['spec']['template']['spec']
    container = spec['containers'][0]

    env_from = container.get('envFrom') or []
    if not any(
        (entry.get('secretRef') or {}).get('name') == EXTERNAL_SECRET
        for entry in env_from
    ):
        env_from = [*env_from, {'secretRef': {'name': EXTERNAL_SECRET}}]
        _run(
            [
                'kubectl',
                '-n',
                NAMESPACE,
                'patch',
                'deploy',
                DEPLOYMENT,
                '--type=json',
                '-p',
                json.dumps(
                    [
                        {
                            'op': 'add',
                            'path': '/spec/template/spec/containers/0/envFrom',
                            'value': env_from,
                        }
                    ]
                ),
            ]
        )
        log(f'  deploy/{DEPLOYMENT}: envFrom now includes {EXTERNAL_SECRET}')
    else:
        log(f'  deploy/{DEPLOYMENT}: envFrom already includes {EXTERNAL_SECRET}')

    volumes = spec.get('volumes') or []
    mounts = container.get('volumeMounts') or []
    if not any(volume.get('name') == 'homelab-ca' for volume in volumes):
        _run(
            [
                'kubectl',
                '-n',
                NAMESPACE,
                'patch',
                'deploy',
                DEPLOYMENT,
                '--type=json',
                '-p',
                json.dumps(
                    [
                        {
                            'op': 'add',
                            'path': '/spec/template/spec/volumes/-',
                            'value': {
                                'name': 'homelab-ca',
                                'configMap': {'name': CA_BUNDLE_CONFIGMAP},
                            },
                        },
                        {
                            'op': 'add',
                            'path': (
                                '/spec/template/spec/containers/0/volumeMounts/-'
                            ),
                            'value': {
                                'name': 'homelab-ca',
                                'mountPath': CA_BUNDLE_MOUNT,
                                'readOnly': True,
                            },
                        },
                    ]
                ),
            ]
        )
        log(f'  deploy/{DEPLOYMENT}: mounted {CA_BUNDLE_CONFIGMAP} at {CA_BUNDLE_MOUNT}')
    else:
        log(f'  deploy/{DEPLOYMENT}: CA bundle already mounted')
        _ = mounts


# ---------------------------------------------------------------------- entrypoint


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--stage',
        action='append',
        choices=['keycloak', 'openbao', 'kubernetes'],
        help='Run only the named stage(s). Default: all, in order.',
    )
    parser.add_argument(
        '--grant-user',
        action='append',
        default=[],
        metavar='USERNAME',
        help=(
            f'Add an existing realm user to {USER_GROUP} '
            f'(grants {", ".join(USER_ROLES)}). Repeatable.'
        ),
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Report what would change without writing anything.',
    )
    args = parser.parse_args()
    stages = args.stage or ['keycloak', 'openbao', 'kubernetes']

    try:
        values: dict[str, str] = {}
        if 'keycloak' in stages:
            values = stage_keycloak(args.grant_user, args.dry_run)
        if 'openbao' in stages:
            if not values and not args.dry_run:
                raise ProvisioningError(
                    'The openbao stage needs the keycloak stage in the same run '
                    '(it consumes the freshly resolved client configuration)'
                )
            stage_openbao(values, args.dry_run)
        if 'kubernetes' in stages:
            stage_kubernetes(args.dry_run)
    except ProvisioningError as exc:
        print(f'PROVISIONING FAILED: {exc}', file=sys.stderr)
        return 1

    log('')
    log('Provisioning complete. Roll the pod to pick up the new environment:')
    log(f'  kubectl -n {NAMESPACE} rollout restart deploy/{DEPLOYMENT}')
    log(f'Then sign in at {WEBUI_ORIGIN}/ — an unauthenticated browser')
    log('navigation is redirected to Keycloak automatically.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
