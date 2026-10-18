# agent-webui container image.
#
# Every Python dependency installs from PyPI: the runtime stage installs the
# agent-webui wheel built here, and its declared dependencies
# (agent-utilities>=3.0.0,<4.0.0, agent-connector-sdk>=0.2.0,<1.0.0 and, through
# the SDK, the published epistemic-graph engine wheels) resolve from the index.
# No source build contexts are needed.
#
# Stages:
#   1. frontend-build (node) -- builds the Vite bundle and stamps build-info.txt.
#   2. wheel-build (python+uv) -- builds the agent-webui wheel with that bundle.
#   3. runtime -- installs the wheel and its PyPI dependencies.
#
# Manual build:
#   docker build -f docker/Dockerfile --target runtime \
#     --build-arg BUILD_SHA="$(git rev-parse --short HEAD)" \
#     --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
#     -t agent-webui:local .
#   docker run --rm -p 8080:80 agent-webui:local
#   curl http://localhost:8080/health
#   curl http://localhost:8080/build-info.txt   # confirms which commit is SERVED
#
# ── ONE standardized way to build+push+deploy this image (2026-08-07 consolidation,
#    2026-08-17: build backend made pluggable -- docker daemon OR cluster-native
#    BuildKit, auto-detected, since r820's docker daemon is no longer live) ──
# Don't hand-roll a `docker build`/`buildctl build` invocation or a kubectl recipe --
# use `docker/build_and_push.sh`, the single command that auto-detects a reachable
# docker daemon or falls back to the shared `buildkitd` Deployment running inside
# the k8s cluster (see services/buildkit-service/), verifies the served bundle
# carries today's commit, pushes by digest, and (unless `--build-only` is passed)
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

FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS wheel-build
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

FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS runtime
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
RUN uv pip install --system --no-cache /tmp/agent-webui/*.whl \
    && rm -rf /tmp/agent-webui
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1
CMD ["sh", "-c", "socat TCP-LISTEN:80,fork,reuseaddr TCP:127.0.0.1:8000 & exec python -m agent_webui.server --port 8000"]
