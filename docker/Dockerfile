# syntax=docker/dockerfile:1
# agent-webui runtime image: the Vite/React frontend + the FastAPI/Pydantic-AI
# backend (agent/agent_webui), from THIS source tree -- not a published PyPI
# release, so a build always carries whatever is on the branch being built,
# including same-day frontend/backend commits. (D-WUI-30: no Dockerfile existed
# anywhere in this repo's git history; the live `knucklessg1/agent-webui:latest`
# was a one-off manual build/push with no reproducible path back to source.)
#
# ── Why agent-utilities is ALSO built from source here (not `pip install
# agent-utilities`) ──────────────────────────────────────────────────────────
# agent_webui/api_extensions.py imports agent_utilities.security.persistence_privacy,
# .knowledge_graph.core.engine.IntelligenceGraphEngine, .sdd.SDDManager, etc. at
# module load -- a real runtime dependency, even though pyproject.toml declares
# agent-utilities only under the `test` extra. Verified empirically (2026-08-06):
# PyPI's newest published agent-utilities is 1.26.4, which is MISSING
# `agent_utilities.security.persistence_privacy` outright (ImportError at
# startup) -- the 2.x line this app's main branch requires has never been
# published. Likewise agent-utilities' own floor of `epistemic-graph[full]>=
# 2.23.2` is ahead of PyPI's newest epistemic-graph (2.23.0). So a plain `pip
# install agent-utilities[...]` cannot produce a working image today.
#
# The fix mirrors agent-utilities' OWN Dockerfile's `agent-local` target
# (docker/Dockerfile in that repo): resolve the exact-version closure from a
# local wheelhouse via `--find-links` instead of the public index. Two extra
# BUILD CONTEXTS supply it (`docker buildx build` / modern `docker build` both
# support `--build-context NAME=PATH`):
#
#   --build-context au-src=../agent-utilities        # sibling repo checkout/worktree
#   --build-context wheelhouse=../../.dev-wheelhouse  # pre-built epistemic-graph wheel
#
# `au-src` is built into a wheel here (pure-Python + this repo's own
# `build_backend.py`; no Rust toolchain needed -- the compiled engine ships
# separately as `epistemic-graph`). `wheelhouse` supplies a pre-built
# `epistemic_graph-2.23.2-*.whl` (the Rust engine; rebuilding it from source is
# a many-minute cargo/maturin build, out of scope for this image) so neither
# wheel needs network access to an index that doesn't have them yet. Once
# agent-utilities 2.x is published to PyPI with a matching epistemic-graph
# floor, DELETE the `au-wheel-build` stage and its build-context and go back to
# a plain `"agent-utilities[graph,mcp]>=2.0.0"` in the runtime `uv pip install`
# (D-WD-6: the `mcp` extra is required too -- without it, fastmcp is absent
# and register_graph_routes()'s canonical /api/graph|sessions|goals|tools
# mount fails at startup with ModuleNotFoundError, degrading those routes to
# 404 for the life of the pod).
#
# Stages (build in a builder, ship only the installed package + runtime deps
# in the final image -- no node_modules/cargo/toolchain/source tree):
#   1. frontend-build (node)   -- pnpm install --frozen-lockfile && pnpm build
#      (tsc -b && vite build) emits the SPA into agent/agent_webui/dist/, the
#      path vite.config.ts's `build.outDir` and this package's
#      `[tool.setuptools.package-data]` (`agent_webui = ["dist/**", ...]`)
#      agree on -- the wheel built in stage 2 bundles the built SPA as
#      package data.
#   2. wheel-build (python+uv) -- `uv build --wheel` over the source tree.
#      `[tool.uv.sources] agent-utilities = {workspace = true}` is a
#      uv-resolver-only declaration that plain `uv build` never reads, so this
#      stage needs no ecosystem workspace root -- sidesteps D-FE-7 (which is
#      specifically about `uv run`/`uv sync` workspace discovery).
#   3. au-wheel-build (python+uv) -- same mechanism, over the `au-src` context.
#   4. runtime (python, final) -- installs both built wheels plus
#      epistemic-graph from the `wheelhouse` context via `--find-links`;
#      everything else (fastapi, pydantic-ai, etc.) still resolves from PyPI
#      normally.
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
#   docker build -f docker/Dockerfile \
#     --build-context au-src=../agent-utilities \
#     --build-context wheelhouse=../../.dev-wheelhouse \
#     -t agent-webui:local .
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

# See header: builds agent-utilities from its own source tree (no Rust needed --
# the compiled engine is the separate epistemic-graph wheel supplied by the
# `wheelhouse` build context below). Remove this stage once agent-utilities 2.x
# is published to PyPI.
FROM python:3.14-slim AS au-wheel-build
COPY --from=ghcr.io/astral-sh/uv:0.11.7@sha256:240fb85ab0f263ef12f492d8476aa3a2e4e1e333f7d67fbdd923d00a506a516a /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_SYSTEM_PYTHON=1 \
    UV_HTTP_TIMEOUT=3600
WORKDIR /au
COPY --from=au-src . .
RUN uv build --wheel --out-dir /dist-au

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
COPY --from=wheel-build /dist/*.whl /tmp/agent-webui/
COPY --from=au-wheel-build /dist-au/*.whl /tmp/wheelhouse/
COPY --from=wheelhouse epistemic_graph-*.whl /tmp/wheelhouse/
# D-W5WR-1: naming the requirement as a bare "agent-utilities[graph,mcp]"
# string let `uv pip install` resolve it against the DEFAULT PyPI index
# (agent-utilities==1.26.4) instead of the locally-built wheel this stage
# just placed in /tmp/wheelhouse -- --find-links makes a local wheel an
# ADDITIONAL candidate, it does not make uv prefer it over the index, and
# PyPI's 1.26.4 satisfies the unpinned "agent-utilities[graph,mcp]"
# requirement just fine even though it predates `agent_utilities.security.
# persistence_privacy` (an ImportError agent_webui hits at module load).
# Referencing the wheel FILE directly (with the extras bracket appended to
# the path, PEP 508's local-file-with-extras form) removes the ambiguity:
# there is exactly one candidate for agent-utilities itself, and it is the
# one this Dockerfile just built from source.
#
# D-W5WR-2: pinning the real 2.x wheel then surfaced a SECOND, independent
# gap -- its `[mcp]` extra declares `fastmcp>=4.0.0b1` (CONCEPT:AU-ECO.mcp.
# protocol-compat-bridge), which conflicts with `pydantic-ai-slim[mcp]`'s
# own `fastmcp-slim[client]<4` cap. agent-utilities' OWN pyproject.toml
# already carries the tested fix for exactly this
# (`[tool.uv] override-dependencies`, see that file's comment for the full
# empirical justification -- a live fastmcp-4 MCP round-trip verified under
# this override), but `[tool.uv]` resolver settings are project-local: they
# apply when uv resolves agent-utilities' OWN environment (`uv sync`/`uv
# lock`), not when a downstream Dockerfile `uv pip install`s the built
# wheel into an unrelated image. Reproducing the identical override via
# `--overrides` (uv's flag for the same mechanism from outside the project)
# carries the fix across that boundary without inventing a new resolution.
RUN AU_WHEEL="$(ls /tmp/wheelhouse/agent_utilities-*.whl)" \
    && printf '%s\n' \
        'fastmcp-slim[client,server]>=4.0.0b1' \
        'nltk>=3.10.0' \
        > /tmp/au-overrides.txt \
    && uv pip install --system --no-cache --find-links /tmp/wheelhouse \
        --overrides /tmp/au-overrides.txt \
        "${AU_WHEEL}[graph,mcp]" /tmp/agent-webui/*.whl \
    && rm -rf /tmp/agent-webui /tmp/wheelhouse /tmp/au-overrides.txt
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1
CMD ["sh", "-c", "socat TCP-LISTEN:80,fork,reuseaddr TCP:127.0.0.1:8000 & exec python -m agent_webui.server --port 8000"]
