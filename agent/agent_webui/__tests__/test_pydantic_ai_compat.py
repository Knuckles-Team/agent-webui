"""Pydantic AI WebUI contract compatibility tests."""

from unittest.mock import MagicMock

import pytest
from agent_webui.server import create_agent_web_app
from starlette.applications import Starlette


def test_to_web_uses_the_current_pydantic_ai_contract() -> None:
    """The wrapper must not pass the removed ``builtin_tools`` keyword."""

    agent = MagicMock()
    agent.to_web.return_value = Starlette()

    create_agent_web_app(
        agent,
        workspace_helpers={},
        models={'Test': 'test'},
        builtin_tools=[],
    )

    agent.to_web.assert_called_once_with(
        models={'Test': 'test'},
        html_source=None,
    )


def test_nonempty_legacy_builtin_tools_fail_closed() -> None:
    """Legacy tool injection must not disappear silently during the upgrade."""

    agent = MagicMock()
    agent.to_web.return_value = Starlette()

    with pytest.raises(ValueError, match='NativeTool capabilities'):
        create_agent_web_app(
            agent,
            workspace_helpers={},
            models={'Test': 'test'},
            builtin_tools=[object()],
        )

    agent.to_web.assert_not_called()


def test_google_model_uses_the_current_provider_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pydantic AI 2.x names the Google GenAI provider ``google``."""

    monkeypatch.setenv('GOOGLE_API_KEY', 'test-key')
    agent = MagicMock()
    agent.to_web.return_value = Starlette()

    create_agent_web_app(agent, workspace_helpers={})

    assert agent.to_web.call_args.kwargs['models']['Gemini 2.0 Pro'] == (
        'google:gemini-2.0-pro'
    )
