from __future__ import annotations as _annotations
import os
from pathlib import Path
from typing import Any, Dict

import logfire
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic_ai import Agent

from .api_extensions import router as enhanced_router, set_workspace_helpers

# Configure logfire
logfire.configure(send_to_logfire='if-token-present')
logfire.instrument_pydantic_ai()

__version__ = "0.1.2"

def create_agent_web_app(
    agent: Agent,
    workspace_helpers: Dict[str, Any],
    models: Dict[str, str] | None = None,
    builtin_tools: list[Any] | None = None,
    html_source: str | Path | None = None,
) -> FastAPI:
    """
    Creates the agent-web FastAPI application, integrating Pydantic-AI's
    built-in web UI with enhanced features for workspace management.
    """
    # Set helpers for the enhanced API
    set_workspace_helpers(workspace_helpers)

    # Filter models based on available API keys
    default_models = {}
    if os.getenv('ANTHROPIC_API_KEY'):
        default_models['Claude Sonnet 3.5'] = 'anthropic:claude-3-5-sonnet-latest'
    if os.getenv('OPENAI_API_KEY'):
        default_models['GPT 4o'] = 'openai:gpt-4o'
    if os.getenv('GOOGLE_API_KEY'):
        default_models['Gemini 2.0 Pro'] = 'google-gla:gemini-2.0-pro'

    # Check for Ollama / Local models
    # We'll include Qwen 3 Coder if Ollama is configured
    if os.getenv('OLLAMA_BASE_URL') or os.getenv('OLLAMA_HOST'):
        default_models['Qwen 3 Coder'] = 'ollama:qwen3-coder'

    if not default_models:
        default_models['Test Model (Markdown Only)'] = 'test'

    # Create the main FastAPI app
    app = FastAPI(title='Agent Web Dashboard')

    # Include the enhanced API routes
    app.include_router(enhanced_router)

    # Use Pydantic-AI's to_web to get their Starlette app
    pydantic_app = agent.to_web(
        models=models or default_models,
        builtin_tools=builtin_tools,
        html_source=html_source,
    )

    # Merge pydantic-ai routes into our main app
    for route in pydantic_app.routes:
        if hasattr(route, 'path'):
            # Core API routes
            if (
                route.path.startswith('/chat')
                or route.path.startswith('/configure')
                or route.path.startswith('/api')
            ):
                app.routes.append(route)
            # If html_source is provided, we also want Pydantic AI's UI routes (/ and /{id})
            elif html_source and (route.path == '/' or route.path == '/{id}'):
                app.routes.append(route)

    dist_path = Path(__file__).parent / 'dist'

    # Custom StaticFiles to handle SPA routing (fallback to index.html)
    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except _errors.HTTPException as ex:
                if (
                    ex.status_code == 404
                    and not any(
                        path.startswith(p) for p in ['api', 'chat', 'configure']
                    )
                    and '.' not in path
                ):
                    return await super().get_response('index.html', scope)
                raise ex

    from starlette import exceptions as _errors

    # Mount our built React app (only if no custom html_source is provided)
    if not html_source:
        if dist_path.exists():
            app.mount(
                '/',
                SPAStaticFiles(directory=str(dist_path), html=True),
                name='dashboard',
            )
        else:
            print(
                f'Warning: Static assets not found at {dist_path}. Dashboard UI will not be served.'
            )

    logfire.instrument_starlette(app)
    return app


# For standalone testing
if __name__ == '__main__':
    from .agent import agent as test_agent

    dummy_helpers = {
        'agent_name': 'Test Agent',
        'agent_description': 'A standalone test agent',
        'agent_emoji': '🧪',
        'get_workspace_path': lambda x: Path('/tmp') / x,
        'load_workspace_file': lambda x: f'Content of {x}',
        'write_md_file': lambda x, y: print(f'Writing {y} to {x}'),
        'list_workspace_files': lambda: ['IDENTITY.md', 'USER.md'],
        'list_skills': lambda: [],
        'get_cron_calendar': lambda: [],
        'get_agent_icon_path': lambda: None,
    }
    app = create_agent_web_app(test_agent, dummy_helpers)
    import uvicorn

    uvicorn.run(app, host='0.0.0.0', port=8000)
