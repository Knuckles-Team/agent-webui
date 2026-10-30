"""Test configuration and fixtures for overstory backend tests."""

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# Create test directory structure
TEST_DIR = Path(__file__).parent
FIXTURES_DIR = TEST_DIR / 'fixtures'


@pytest.fixture
def temp_db():
    """Create a temporary database for testing."""
    db_dir = tempfile.mkdtemp()
    db_path = os.path.join(db_dir, 'test.db')
    yield db_path
    shutil.rmtree(db_dir)


@pytest.fixture
def mock_agent():
    """Mock Pydantic AI agent for testing."""
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    return Agent(TestModel())


@pytest.fixture
def mock_workspace_helpers():
    """Mock workspace helpers for testing."""
    return {
        'workspace_path': '/test/workspace',
        'workspace_name': 'test_workspace',
        'tools': [],
        'metadata': {},
    }


@pytest.fixture
def served_identity_config(monkeypatch):
    """Configure the served identity boundary the way a deployment does."""
    from overstory.host import config

    # The complete verifier itself is configured by ``_complete_jwt_verifier``
    # (autouse) for every test.
    monkeypatch.setattr(config, 'kg_policy_version', 'test-1', raising=False)
    return config


@pytest.fixture(autouse=True)
def _complete_jwt_verifier(monkeypatch):
    """Every WebUI listener requires an identity verifier.

    There is no unauthenticated loopback path any more, so every app a test
    builds is configured the way a deployment is: a complete JWT verifier
    (JWKS URI, issuer, audience). A test that exercises the refusal of an
    unconfigured verifier clears these fields itself.
    """
    from overstory.host import config

    monkeypatch.setattr(
        config,
        'auth_jwt_jwks_uri',
        'https://idp.test/.well-known/jwks.json',
        raising=False,
    )
    monkeypatch.setattr(config, 'auth_jwt_issuer', 'https://idp.test/', raising=False)
    monkeypatch.setattr(config, 'auth_jwt_audience', 'overstory-test', raising=False)


@pytest.fixture(autouse=True)
def _reset_settings():
    """Drop process overrides of the WebUI settings after each test."""
    from overstory.host import config

    yield
    config.reset()


def authenticated_asgi_app(
    app,
    *,
    scope: str = 'kg:read kg:write kg:admin',
    sub: str = 'test-suite',
    tenant: str = 'test-tenant',
):
    """Wrap ``app`` so every HTTP request carries host-verified claims.

    The claims land on ``scope['state']['user_claims']``: the leg an outer
    authentication boundary uses to hand over an already-verified credential.
    Every later check (actor projection, grant, route scopes) runs for real.
    """

    async def with_identity(asgi_scope, receive, send):
        if asgi_scope.get('type') == 'http':
            asgi_scope = dict(asgi_scope)
            state = dict(asgi_scope.get('state') or {})
            state['user_claims'] = {
                'auth_type': 'jwt',
                'sub': sub,
                'tenant_id': tenant,
                'scope': scope,
            }
            asgi_scope['state'] = state
        await app(asgi_scope, receive, send)

    return with_identity


@pytest.fixture
def authenticated_client_factory(served_identity_config):
    """Factory for a ``TestClient`` carrying a verified, real credential.

    Built on :func:`authenticated_asgi_app` + :func:`served_identity_config`
    -- see both for why this drives the real identity/authorization
    middleware stack rather than replacing it.
    """
    # Depended on for its side effect (configuring `config` before any
    # request is made), not its return value -- referenced here so it
    # is not flagged as an unused fixture parameter.
    _ = served_identity_config

    def _make(app, *, scope: str = 'kg:read kg:write kg:admin', **kwargs):
        from fastapi.testclient import TestClient

        return TestClient(authenticated_asgi_app(app, scope=scope), **kwargs)

    return _make
