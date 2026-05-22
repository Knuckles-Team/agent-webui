import pytest


def test_import_agent_webui():
    """Test that the agent_webui package can be imported."""
    import agent_webui

    pass


def test_server_import():
    """Test that the server module can be imported."""
    from agent_webui import server

    assert server is not None


def test_main():
    """Test that main() can be executed."""
    from agent_webui import server
    from unittest.mock import patch

    with patch('uvicorn.run'):
        # Simulate a call to main without starting the server for real
        server.main()


def test_server_env_vars(monkeypatch):
    from agent_webui import server

    monkeypatch.setenv('ANTHROPIC_API_KEY', 'test')
    monkeypatch.setenv('OPENAI_API_KEY', 'test')
    monkeypatch.setenv('GOOGLE_API_KEY', 'test')
    monkeypatch.setenv('OLLAMA_BASE_URL', 'test')

    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    agent = Agent(TestModel())
    app = server.create_agent_web_app(agent, workspace_helpers={})
    assert app is not None
