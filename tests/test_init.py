import pytest

def test_import_agent_webui():
    """Test that the agent_webui package can be imported."""
    import agent_webui
    pass

def test_server_import():
    """Test that the server module can be imported."""
    from agent_webui import server
    assert server is not None
