"""The optional local port never widens default or ordinary admission."""

import pytest
from agent_webui.local_browser_boundary import validate_local_browser_boundary
from test_identity_boundary import _build, _no_verifier

pytestmark = pytest.mark.spec('WEBUI-IDENTITY-R003.1.1')


@pytest.mark.parametrize(
    'value', [object(), lambda app: None, {'identity_mode': 'none'}]
)
def test_factory_refuses_non_owner_local_boundary(monkeypatch, value):
    _no_verifier(monkeypatch)
    with pytest.raises(RuntimeError, match='Canonical local browser boundary'):
        _build(auth_mode='none', local_browser_boundary=value)


def test_absent_boundary_does_not_import_optional_contract(monkeypatch):
    import builtins

    original = builtins.__import__

    def checked_import(name, *args, **kwargs):
        if name == 'arbora.client.browser_boundary':
            raise AssertionError('absent boundary must not import optional contract')
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', checked_import)
    validate_local_browser_boundary(None, 'none')
    _no_verifier(monkeypatch)
    _build(auth_mode='none')


def test_factory_preserves_existing_positional_arguments(monkeypatch):
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    _no_verifier(monkeypatch)
    app = create_agent_web_app(
        Agent(TestModel()),
        {'get_path': lambda value: value},
        None,
        None,
        None,
        '127.0.0.1',
        None,
        None,
        None,
        None,
        'none',
        frozenset(),
    )
    assert app.state.security_contract['auth_mode'] == 'none'
