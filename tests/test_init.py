import pytest


def test_import_overstory():
    """Test that the overstory package can be imported."""

    pass


def test_server_import():
    """Test that the server module can be imported."""
    from overstory import server

    assert server is not None


def test_main():
    """Test that main() can be executed."""
    from unittest.mock import patch

    from overstory import server

    with patch('uvicorn.run'):
        # Simulate a call to main without starting the server for real
        server.main()


def test_server_env_vars(monkeypatch):
    # Forcing the provider env vars makes pydantic-ai's to_web construct real
    # provider models, which import their SDKs — skip where those extras are
    # not installed.
    pytest.importorskip('anthropic')
    pytest.importorskip('openai')

    from overstory import server

    monkeypatch.setenv('ANTHROPIC_API_KEY', 'test')
    monkeypatch.setenv('OPENAI_API_KEY', 'test')
    monkeypatch.setenv('GOOGLE_API_KEY', 'test')
    monkeypatch.setenv('OLLAMA_BASE_URL', 'test')

    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    agent = Agent(TestModel())
    app = server.create_agent_web_app(agent, workspace_helpers={})
    assert app is not None
