#!/usr/bin/python
"""
Agent WebUI Server Core.

This module provides the factory function for creating the Agent Web
Dashboard application. It integrates Pydantic-AI's built-in web features
with enhanced workspace management, real-time observability via Logfire,
and a high-performance React-based frontend.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Any

import logfire
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic_ai import Agent
from starlette import exceptions as _errors
from starlette.routing import Mount
from starlette.routing import Route as StarletteRoute

from .api_extensions import router as enhanced_router
from .api_extensions import set_workspace_helpers

logger = logging.getLogger(__name__)

logfire.configure(send_to_logfire='if-token-present')
logfire.instrument_pydantic_ai()

__version__ = '0.1.37'

print(f'Agent WebUI v{__version__}', file=sys.stderr)


def create_agent_web_app(
    agent: Agent,
    workspace_helpers: dict[str, Any],
    models: dict[str, str] | None = None,
    builtin_tools: list[Any] | None = None,
    html_source: str | Path | None = None,
) -> FastAPI:
    """Create the agent-web FastAPI application.

    Integrates Pydantic-AI's internal web UI with custom extensions for
    workspace awareness, dynamic model selection, and high-fidelity
    observability.

    Args:
        agent: The Pydantic-AI Agent instance to serve.
        workspace_helpers: Metadata and tools for workspace situational awareness.
        models: Optional explicit mapping of provider:model_id to display names.
        builtin_tools: Optional list of tools to inject into the web interface.
        html_source: Path to custom HTML to serve as the dashboard root.

    Returns:
        A fully configured FastAPI application instance.
    """

    set_workspace_helpers(workspace_helpers)

    # Detect available providers based on environment variables
    default_models = {}
    if os.getenv('ANTHROPIC_API_KEY'):
        default_models['Claude Sonnet 3.5'] = 'anthropic:claude-3-5-sonnet-latest'
    if os.getenv('OPENAI_API_KEY'):
        default_models['GPT 4o'] = 'openai:gpt-4o'
    if os.getenv('GOOGLE_API_KEY'):
        default_models['Gemini 2.0 Pro'] = 'google-gla:gemini-2.0-pro'

    # Support for local induction via Ollama/OpenWebUI patterns
    if os.getenv('OLLAMA_BASE_URL') or os.getenv('OLLAMA_HOST'):
        default_models['Qwen 3 Coder'] = 'ollama:qwen3-coder'

    if not default_models:
        default_models['Test Model (Markdown Only)'] = 'test'

    app = FastAPI(title='Agent Web Dashboard')

    # Mount the enhanced API extensions (ACP/A2A/Management)
    app.include_router(enhanced_router, prefix='/api/enhanced')

    # Delegate to Pydantic-AI's native web wrapper for base functionality
    pydantic_app = agent.to_web(
        models=models or default_models,
        builtin_tools=builtin_tools,
        html_source=html_source,
    )

    def add_pydantic_routes(routes, prefix=''):
        """Recursively discover and mount Pydantic-AI internal routes.

        Args:
            routes: List of routes to process.
            prefix: URL prefix for the current route layer.
        """
        for route in routes:
            if isinstance(route, Mount):
                add_pydantic_routes(route.app.routes, prefix + route.path)
            elif isinstance(route, StarletteRoute):
                full_path = prefix + route.path
                full_path = '/' + full_path.strip('/')

                # Only bridge routes that match the dashboard's functional scope
                if (
                    full_path.startswith('/api')
                    or full_path.startswith('/chat')
                    or full_path.startswith('/configure')
                    or (html_source and (full_path == '/' or full_path == '/{id}'))
                ):
                    app.add_route(full_path, route.endpoint, methods=route.methods)

    add_pydantic_routes(pydantic_app.routes)

    dist_path = Path(__file__).parent / 'dist'

    class SPAStaticFiles(StaticFiles):
        """Custom StaticFiles implementation to support Single Page Application (SPA).

        Intercepts 404s for client-side routing, falling back to index.html
        unless the request targets a known API endpoint or specific file.
        """

        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except _errors.HTTPException as ex:
                if (
                    ex.status_code == 404
                    and not any(
                        path.startswith(p)
                        for p in ['api', 'chat', 'configure', 'mcp', 'a2a', 'ag-ui']
                    )
                    and '.' not in path
                ):
                    return await super().get_response('index.html', scope)
                raise ex

    # Fallback to serving the built React dashboard if no custom source provided
    if not html_source:
        if dist_path.exists():
            app.mount(
                '/',
                SPAStaticFiles(directory=str(dist_path), html=True),
                name='dashboard',
            )
        else:
            logger.warning(
                f'Static assets not found at {dist_path}. '
                'Dashboard UI will not be served.'
            )

    logfire.instrument_starlette(app)
    return app


def main() -> None:
    """Application entry point for CLI usage and ecosystem validation."""
    import argparse

    import uvicorn
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='0.0.0.0')  # nosec B104
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--web', action='store_true')
    args, _ = parser.parse_known_args()

    agent = Agent(TestModel())
    app = create_agent_web_app(agent, workspace_helpers={})

    print('Application startup complete', file=sys.stderr)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == '__main__':
    main()
