# syntax=docker/dockerfile:1
# agent-webui runtime image: the Vite/React frontend + the FastAPI/Pydantic-AI
# backend (agent/agent_webui), from THIS source tree -- not a published PyPI
# release, so a build always carries whatever is on the branch being built,
# including same-day frontend/backend commits. (D-WUI-30: no Dockerfile existed
# anywhere in this repo's git history; the live `knucklessg1/agent-webui:latest`
# was a one-off manual build/push with no reproducible path back to source.)
#
# Three stages, right-sized (build in a builder, ship only the installed
# package + runtime deps -- no node_modules/toolchain in the final image):
#
#   1. frontend-build (node) -- `pnpm install --frozen-lockfile` + `pnpm build`
#      (tsc -b && vite build) emits the SPA into agent/agent_webui/dist/, the
#      exact path vite.config.ts's `build.outDir` and this package's
#      `[tool.setuptools.package-data]` (`agent_webui = ["dist/**", ...]`) agree
#      on -- the wheel built in stage 2 bundles the built SPA as package data.
#   2. wheel-build (python + uv) -- `uv build --wheel` over the source tree
#      (setuptools backend; `[tool.uv.sources] agent-utilities = {workspace =
#      true}` is a uv-resolver-only declaration that plain `uv build` never
#      reads, so this stage needs no ecosystem workspace root -- sidesteps
#      D-FE-7, which is specifically about `uv run`/`uv sync` workspace
#      discovery from a worktree).
#   3. runtime (python, final) -- installs the built wheel PLUS agent-utilities
#      explicitly. agent_webui/api_extensions.py imports
#      `agent_utilities.knowledge_graph.core.engine.IntelligenceGraphEngine`,
#      `agent_utilities.sdd.SDDManager`, etc. at module load -- a real runtime
#      dependency -- even though pyproject.toml declares agent-utilities only
#      under the `test` extra (`agent-utilities[agent,graph]`); installed here
#      with that same extra combination since it's the one this package is
#      actually validated against. (joserfc/JWT verification is base-dependency
#      in current agent-utilities -- no separate `[auth]` needed; see
#      agent-utilities pyproject.toml CONCEPT:AU-OS.config.secrets-authentication.)
#
# Runtime wiring: uvicorn binds loopback:8000 (agent_webui.server's own default
# absent --host/HOST) and `socat` forwards :80 -> :8000, reproducing the
# mechanism the live deployment's own manifest documents
# (inventory/k8s-migration/cutover/apptier/agent-webui.yaml: "the pod
# entrypoint runs `python -m agent_webui.server` (behind a socat :80->:8000
# shim)") so this image is a drop-in replacement for
# `knucklessg1/agent-webui:latest` -- same exposed port, no manifest change
# required for a `:latest` swap + rollout.
#
#   docker build -f docker/Dockerfile -t agent-webui:local .
#   docker run --rm -p 8080:80 agent-webui:local
#   curl http://localhost:8080/health

FROM node:22-slim AS frontend-build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts components.json index.html ./
COPY public ./public
COPY src ./src
RUN pnpm build

FROM python:3.14-slim AS wheel-build
COPY --from=ghcr.io/astral-sh/uv:0.11.7@sha256:240fb85ab0f263ef12f492d8476aa3a2e4e1e333f7d67fbdd923d00a506a516a /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_SYSTEM_PYTHON=1 \
    UV_HTTP_TIMEOUT=3600
WORKDIR /app
COPY pyproject.toml README.md ./
COPY agent ./agent
COPY --from=frontend-build /app/agent/agent_webui/dist ./agent/agent_webui/dist
RUN uv build --wheel --out-dir /dist

FROM python:3.14-slim AS runtime
# socat provides the :80 -> :8000 privileged-port shim (see header); the image
# otherwise ships no build toolchain, no node_modules, no source tree.
RUN apt-get update \
    && apt-get install -y --no-install-recommends socat \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.7@sha256:240fb85ab0f263ef12f492d8476aa3a2e4e1e333f7d67fbdd923d00a506a516a /uv /uvx /bin/
ENV UV_SYSTEM_PYTHON=1 \
    UV_HTTP_TIMEOUT=3600 \
    PYTHONUNBUFFERED=1
COPY --from=wheel-build /dist/*.whl /tmp/
RUN uv pip install --system --no-cache "agent-utilities[agent,graph]>=2.0.0" /tmp/*.whl \
    && rm -f /tmp/*.whl
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1
CMD ["sh", "-c", "socat TCP-LISTEN:80,fork,reuseaddr TCP:127.0.0.1:8000 & exec python -m agent_webui.server --port 8000"]
