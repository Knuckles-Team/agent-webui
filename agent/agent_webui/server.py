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

__version__ = '0.1.21'


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

    from starlette.routing import Mount, Route as StarletteRoute

    # Merge pydantic-ai routes into our main app
    def add_pydantic_routes(routes, prefix=''):
        for route in routes:
            if isinstance(route, Mount):
                # Recurse into mounts
                add_pydantic_routes(route.app.routes, prefix + route.path)
            elif isinstance(route, StarletteRoute):
                full_path = prefix + route.path
                # Normalize the path (ensure it starts with / and has no double slashes)
                full_path = '/' + full_path.strip('/')

                if (
                    full_path.startswith('/api')
                    or full_path.startswith('/chat')
                    or full_path.startswith('/configure')
                    or (html_source and (full_path == '/' or full_path == '/{id}'))
                ):
                    app.add_route(full_path, route.endpoint, methods=route.methods)

    add_pydantic_routes(pydantic_app.routes)

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
