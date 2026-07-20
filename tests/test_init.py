import pytest

# The backend imports the development line of agent-utilities (its released
# PyPI build does not yet ship knowledge_graph.core). In a hermetic
# environment resolved purely from uv.lock (the pre-commit pytest hook), the
# server modules therefore cannot import; skip rather than fail there. The
# real backend suite runs with the dev agent-utilities on PYTHONPATH.
pytest.importorskip(
    'agent_utilities.knowledge_graph.core',
    reason='backend requires the development agent-utilities (knowledge_graph.core)',
)


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
    # Forcing the provider env vars makes pydantic-ai's to_web construct real
    # provider models, which import their SDKs — skip where those extras are
    # not installed.
    pytest.importorskip('anthropic')
    pytest.importorskip('openai')

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
