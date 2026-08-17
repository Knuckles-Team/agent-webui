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
# published. So a plain `pip install agent-utilities[...]` cannot produce a
# working image today.
#
# The fix mirrors agent-utilities' OWN Dockerfile's `agent-local` target
# (docker/Dockerfile in that repo): resolve agent-utilities' exact-version
# closure from source instead of the public index, via ONE extra BUILD CONTEXT
# (`docker buildx build` / modern `docker build` both support
# `--build-context NAME=PATH`):
#
#   --build-context au-src=../agent-utilities        # sibling repo checkout/worktree
#
# `au-src` is built into a wheel here (pure-Python + this repo's own
# `build_backend.py`; no Rust toolchain needed -- the compiled engine ships
# separately as `epistemic-graph`, installed from PyPI like any other
# dependency, pulled in via agent-utilities' opt-in `graphos` extra (GOC-73
# moved it off the hard base dependency it used to be -- see BUG-258/BUG-262
# below), so `uv pip install "...[graphos]"` resolves it transitively from
# the default index with no extra plumbing here.
# (2026-08-10: previously a SECOND build context, `wheelhouse`, supplied a
# pre-built `epistemic_graph-*.whl` because PyPI's newest epistemic-graph
# release was below agent-utilities' floor -- see CI's release.yml
# `publish-docker` job for the gate that now fails this build with one clear
# line naming the missing version instead of silently trying, and failing
# deep inside a pip resolver, when that floor still isn't published.) Once
# agent-utilities 2.x is published to PyPI too, DELETE the `au-wheel-build`
# stage and its build-context and go back to a plain
# `"agent-utilities[agent-headless,graph,graphos,metrics]>=2.0.0"` in the
# runtime `uv pip install` (D-WD-6: `agent-headless` self-references the
# `mcp` extra, required -- without it, fastmcp is absent and
# register_graph_routes()'s canonical /api/graph|sessions|goals|tools mount
# fails at startup with ModuleNotFoundError, degrading those routes to 404
# for the life of the pod; `agent-headless` ALSO supplies
# `pydantic-ai-harness`, required by `agent_utilities.capabilities.
# content_guardrails` -- see the runtime install step below).
#
# ── 2026-08-17: the `wheelhouse` build-context is BACK, TEMPORARILY, for
# epistemic-graph only ── BUG-258/BUG-262 (below) added the `graphos` extra,
# which requires `epistemic-graph[full]>=2.23.2,<3.0.0` (see agent-utilities'
# own pyproject.toml comment on that floor). Verified empirically the same day:
# PyPI's newest published `epistemic-graph` is still 2.23.0 -- the floor is
# UNSATISFIABLE from the index alone (`uv pip install` fails inside the
# resolver naming exactly this, not a vague error). epistemic-graph's own repo
# has released source up to 2.26.1 (tagged, changelogged) but its PyPI publish
# pipeline hasn't kept pace -- a gap in THAT project's release plumbing, not
# this one, and not something this Dockerfile can fix. Rather than block
# BUG-258/BUG-262 on an unrelated repo's publish backlog, this build accepts a
# pre-built `epistemic_graph-*.whl` (>=2.23.2,<3.0.0) via a THIRD local build
# context, `eg-wheelhouse` (see docker/build_and_push.sh's `EG_WHEELHOUSE_PATH`).
# DELETE this context and the `--find-links /tmp/eg-wheelhouse` below the
# moment PyPI's `epistemic-graph` catches up to agent-utilities' declared
# floor -- this is explicitly the same kind of workaround removed 2026-08-10
# above, reintroduced only because history repeated for a different package.
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
#   4. runtime (python, final) -- installs both built wheels; epistemic-graph
#      (pulled in via agent-utilities' opt-in `graphos` extra) and everything
#      else (fastapi, pydantic-ai, etc.) resolve from the default PyPI index
#      normally, no local wheelhouse involved.
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
#     --build-arg BUILD_SHA="$(git rev-parse --short HEAD)" \
#     --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
#     -t agent-webui:local .
#   docker run --rm -p 8080:80 agent-webui:local
#   curl http://localhost:8080/health
#   curl http://localhost:8080/build-info.txt   # confirms which commit is SERVED, not just built
#
# (the `docker build`/`docker run` pair above is an OPTIONAL manual path for a dev
# host that happens to have its own local docker daemon -- most hosts in this
# workspace don't; see docker/build_and_push.sh for the standardized path below,
# which needs no local daemon at all.)
#
# ── ONE standardized way to build+push+deploy this image (2026-08-07 consolidation,
#    migrated 2026-08-17 off r820's docker daemon onto cluster-native BuildKit) ──
# Don't hand-roll a `docker build`/`buildctl build` invocation or a kubectl recipe --
# use `docker/build_and_push.sh`, the single command that builds against the shared
# `buildkitd` Deployment running inside the k8s cluster (see
# services/buildkit-service/), verifies the served bundle carries today's commit
# right after it's pushed, pushes by digest, and (unless `--build-only` is passed)
# deploys + verifies the rollout. See that
# script's own header and README.md's "Build & Deploy" section for the full contract.

FROM node:22-slim AS frontend-build
# BUILD_SHA/BUILD_TIME (passed via `--build-arg`, see docker/build_and_push.sh) get
# baked into a `build-info.txt` static asset alongside the compiled SPA. This exists
# specifically to close trap #3 from the 2026-08-07 build-standardization incident:
# the served frontend `dist/` can go stale independently of the backend (the backend
# is live-NFS-mounted; the frontend bundle is baked into the image at build time
# only). `agent_webui.server` mounts `dist/` at the app root via `SPAStaticFiles`, so
# this file is reachable at `/build-info.txt` on every running deployment -- both the
# build script (grepping it out of the freshly built image BEFORE push) and a human
# (`curl https://au.arpa/build-info.txt`) can verify which commit is actually being
# served, not just which commit was last built.
ARG BUILD_SHA=unknown
ARG BUILD_TIME=unknown
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts components.json index.html ./
COPY public ./public
COPY src ./src
# `pnpm build` runs `node scripts/no_fabrication_gate.mjs` before tsc/vite
# (package.json's `build` script) -- added by the no-fabrication gate
# (BUG-008) after this stage's COPY list was last set, so the file was never
# copied into the builder and every image build failed with MODULE_NOT_FOUND
# before reaching any agent-utilities/epistemic-graph stage.
COPY scripts/no_fabrication_gate.mjs ./scripts/no_fabrication_gate.mjs
RUN pnpm build \
    && printf 'sha=%s\nbuilt_at=%s\n' "${BUILD_SHA}" "${BUILD_TIME}" > agent/agent_webui/dist/build-info.txt

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
# the compiled engine is the separate epistemic-graph wheel, resolved from
# PyPI in the runtime stage below like any other dependency). Remove this
# stage once agent-utilities 2.x is published to PyPI.
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
ARG BUILD_SHA=unknown
ARG BUILD_TIME=unknown
LABEL org.opencontainers.image.revision="${BUILD_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}" \
      org.opencontainers.image.source="https://github.com/Knuckles-Team/agent-webui"
RUN apt-get update \
    && apt-get install -y --no-install-recommends socat \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.7@sha256:240fb85ab0f263ef12f492d8476aa3a2e4e1e333f7d67fbdd923d00a506a516a /uv /uvx /bin/
ENV UV_SYSTEM_PYTHON=1 \
    UV_HTTP_TIMEOUT=3600 \
    PYTHONUNBUFFERED=1
COPY --from=wheel-build /dist/*.whl /tmp/agent-webui/
COPY --from=au-wheel-build /dist-au/*.whl /tmp/wheelhouse/
# TEMPORARY (see header): a pre-built epistemic-graph wheel satisfying the
# graphos extra's floor, fed via --find-links below alongside the au wheel.
COPY --from=eg-wheelhouse . /tmp/eg-wheelhouse/
# D-W5WR-1: naming the requirement as a bare "agent-utilities[graph,mcp]"
# string let `uv pip install` resolve it against the DEFAULT PyPI index
# (agent-utilities==1.26.4) instead of the locally-built wheel this stage
# just placed in /tmp/wheelhouse -- --find-links makes a local wheel an
# ADDITIONAL candidate, it does not make uv prefer it over the index, and
# PyPI's 1.26.4 satisfies the unpinned "agent-utilities[graph,mcp]"
# requirement just fine even though it predates `agent_utilities.security.
# persistence_privacy` (an ImportError agent_webui hits at module load).
#
# `[graph,mcp]` -> `[agent-headless,graph,mcp,metrics]` -> settled on
# `[agent-headless,graph,metrics]` (GOC-73 verification pass): `[graph,mcp]`
# alone is missing `pydantic-ai-harness` -- `agent_utilities.server` ->
# `.app` -> `agent_utilities.agent.factory` ->
# `agent_utilities.capabilities.content_guardrails` imports
# `pydantic_ai_harness` unconditionally at module load, so an image built
# with only `[graph,mcp,metrics]` crashes on startup with
# `ModuleNotFoundError: No module named 'pydantic_ai_harness'` -- caught by
# actually running a locally built image, not just building it.
# `agent-headless` (agent-utilities' purpose-built "agent-runtime's
# skill/runtime stack minus the frontend component libs" extra) already
# self-references `mcp`, provides `pydantic-ai-harness`, and -- unlike
# `agent-runtime` -- pulls neither `ag-ui` (agent-webui, this repo, would
# depend on itself) nor `terminal` (agent-terminal-ui).
# Verified: all ~50 `agent_utilities` submodules this repo imports resolve
# cleanly under `[agent-headless,graph,metrics]` with epistemic-graph
# absent, and a container built from this exact install line starts and
# serves `/health`. Keep this extras list in sync with the `test` extra in
# ../pyproject.toml and the `--extras` flag in
# ../.github/workflows/release.yml's PyPI-resolvability gate.
# Referencing the wheel FILE directly (with the extras bracket appended to
# the path, PEP 508's local-file-with-extras form) removes the ambiguity:
# there is exactly one candidate for agent-utilities itself, and it is the
# one this Dockerfile just built from source.
#
# BUG-258/BUG-262 (2026-08-17): `graphos` ADDED to the extras list below --
# "imports cleanly with epistemic-graph absent" (verified above) is a claim
# about MODULE LOAD, not about this app's own KG/MCP routes working at
# request time. GOC-73 moved `epistemic-graph` from agent-utilities' hard
# base dependency to the opt-in `graphos` extra; before that this repo's
# runtime install got the engine CLIENT for free as a transitive base dep
# and never had to name it, so the omission was invisible until GOC-73
# shipped. This app's `/graph/*` routes and MCP-servers inventory panel
# resolve the engine at CALL time via `GraphComputeEngine`, which needs
# `epistemic_graph.client` importable to reach `GRAPH_SERVICE_ENDPOINTS` --
# confirmed live: a pod built without `graphos` logs "engine surface
# discovery: 'epistemic_graph' client unavailable ... ModuleNotFoundError"
# on every request that needs it, while `graph-os` (a separately, correctly
# packaged process) reaches the identical engine fine. `graphos` pulls the
# published `epistemic-graph[full]` wheel from the default PyPI index like
# any other dependency -- it is NOT in /tmp/wheelhouse; CI's release.yml
# `publish-docker` job verifies beforehand that a satisfying release exists
# there (see that workflow for why).
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
# LANE F: `metrics` (prometheus-client — one light pure-Python wheel, no
# native/heavy deps) turns the `GatewayMetricsMiddleware` this image already
# mounts (register_graph_routes, server.py) from a graceful no-op into real
# per-route request-count/duration series on GET /metrics, reusing the
# EXISTING gateway metrics stack instead of standing up a bespoke store.
RUN AU_WHEEL="$(ls /tmp/wheelhouse/agent_utilities-*.whl)" \
    && printf '%s\n' \
        'fastmcp-slim[client,server]>=4.0.0b1' \
        'nltk>=3.10.0' \
        > /tmp/au-overrides.txt \
    && uv pip install --system --no-cache \
        --find-links /tmp/wheelhouse --find-links /tmp/eg-wheelhouse \
        --overrides /tmp/au-overrides.txt \
        "${AU_WHEEL}[agent-headless,graph,graphos,metrics]" /tmp/agent-webui/*.whl \
    && rm -rf /tmp/agent-webui /tmp/wheelhouse /tmp/eg-wheelhouse /tmp/au-overrides.txt
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1
CMD ["sh", "-c", "socat TCP-LISTEN:80,fork,reuseaddr TCP:127.0.0.1:8000 & exec python -m agent_webui.server --port 8000"]
