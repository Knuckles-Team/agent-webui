---
name: agent-webui-development
skill_type: skill
description: >-
  How to develop, build, test, gate, and release the agent-webui repository
  itself: the frontend/backend commands, the FastAPI host modules, how a page
  gets routed, and the gates that must pass before a change lands. Use this
  when you are changing agent-webui's own code, adding a new view, or
  preparing a commit/PR in this repository — not for using the shipped UI
  (see the `kg-webui-*` skills for that).
license: MIT
tags: [graph-os, webui, development, build, test, gates, routing]
tier: repository
metadata:
  author: Genius
  version: '0.1.0'
---

# agent-webui-development (repository)

Engineering contract for the agent-webui repository itself (browser app +
its FastAPI host), generated from `AGENTS.md`. The `kg-webui-*` skills in
this same directory document the shipped product surface for an end user;
this skill documents how to change the repository that builds it.

## What this repository owns

The browser presentation layer for Graph OS, plus the FastAPI host that
adapts browser protocols to the platform gateway (React views, streaming/
WebSocket/REST adapters, browser identity/session/CSP enforcement, sandboxed
MCP App rendering, packaged frontend assets / wheel / container image).
Graph OS owns auth, composition, routing contracts and the gateway;
epistemic-graph owns durable graph state; agent-utilities owns agent/
workflow control-plane behavior; connector packages own source transport.
Reuse the canonical gateway action or client — never add a second
route-specific implementation of something those layers already own.

## Toolchain and setup

Python 3.12–3.14, the Node.js version pinned in `.node-version`, `pnpm`, and
`uv` 0.9+.

```bash
scripts/bootstrap.sh            # pinned siblings, uv, Python, locked .venv, pnpm deps, git hooks
scripts/bootstrap.sh --engine   # also build epistemic-graph from source (slow; needed for KG/numeric tests)
```

Run dev services in separate terminals: `pnpm run dev:server` (FastAPI) and
`pnpm run dev` (Vite on 5173).

## Commands (exact `package.json` script names)

```bash
pnpm run typecheck     # tsc --noEmit
pnpm run lint           # eslint
pnpm run test           # vitest run
pnpm run test:coverage  # vitest run --coverage
pnpm run test:e2e       # playwright test
pnpm run build          # fabrication gate + site assets + tsc -b + vite build + publish-dist
```

Backend:

```bash
uv run --no-sync pytest tests                              # bounded fast suite (pre-push gate scope)
uv run --all-extras pytest agent/graph_os_webui/__tests__      # full backend contract/security suite (manual)
python -m graph_os_webui.server --security-doctor --host 0.0.0.0
```

`pytest.ini` sets `testpaths = agent/graph_os_webui/__tests__ tests`, but an
explicit path on the command line overrides `testpaths` — the two commands
above cover different, non-overlapping directories.

## The Python host (`agent/graph_os_webui/`)

`server.py` (FastAPI composition — `create_agent_web_app()` builds and mounts
the app; `main()` is the CLI entry point) · `api_extensions.py` (canonical
service browser facades) · `oidc_session.py` (OIDC flow and protected
sessions) · `graph_identity.py` (request-scoped graph identity) ·
`graph_admission.py` (graph operation authorization) · `browser_control.py`
(attended browser-control boundary) · `observability.py` (redacted request
telemetry).

## How a page gets routed

`src/lib/nav-registry.ts` is the single declarative source of truth for
every page: it exports the `RouteDef` type and the `ROUTES` / `PUBLIC_ROUTES`
/ `ROUTE_REGISTRY` arrays. **Adding a page means adding one `RouteDef` entry
here — there is no second place that declares a page.** `src/App.tsx` mounts
every route generically from its `RouteDef.element`, with three named
exceptions it documents inline (Dashboard, the persistent Chat panel, and the
`:id`-parameterized Object detail route). `public/spa-routes.json` is a
build-generated static mirror (via `scripts/site-route-registry.mjs`, run
from `pnpm run build`) used for sitemap/robots/WebMCP — never hand-edit it.

A `RouteDef` also carries `minRole` (enforced both in `App.tsx` and
server-side by `agent/graph_os_webui/rbac.py`'s `WebUIAuthorizationMiddleware` —
a hidden nav item alone is not a permission) and `capability` (hides the item
unless the backend reports that capability available).

## A view counts only when it is routed AND served

Do not mark a view done from component code plus passing unit tests alone.
Two independent facts both have to be true:

1. **Routed** — the view has a `RouteDef` entry in `nav-registry.ts`, so it
   is reachable in the built app (prove it with a test that reaches the
   rendered route, not just the component in isolation — see
   `e2e/routes-smoke.spec.ts`, which iterates every entry in `ROUTES`).
2. **Served** — its backend endpoint is mounted and responding from the real
   FastAPI host, not a stub or an injected test double standing in for it
   (see `test_spa_http_status.py`: build the real app, use `TestClient`,
   assert on the HTTP response).

This follows from two repository rules: "a control wired at only one entry
point is incomplete," and "for frontend behavior, pair unit coverage with a
test that reaches the rendered route or component; for backend behavior,
prove the real FastAPI entry point and the injected service seam." A
component that renders in a unit test but has no `nav-registry.ts` entry is
unreachable; a route that renders but whose data calls hit an endpoint the
host never mounts is equally incomplete.

## Gates

`scripts/bootstrap.sh` installs the commit and push git hooks. Before
committing:

```bash
uvx pre-commit run --config .config/pre-commit.yaml --all-files
uvx pre-commit run --config .config/pre-commit.yaml --all-files --hook-stage manual
```

Hosted CI's `gates` job in `.github/workflows/release.yml` runs the same
pre-commit config (commit stage, then pre-push stage) over all files — the
one definition of the gate.

A hook whose tool or sibling checkout is missing prints
`SKIPPED (<gate>): <reason>` and passes locally; with `CI` set it fails
closed instead (`CANNOT RUN`, exit status 2). Never bypass a gate with
`--no-verify`, `SKIP`, a diagnostic-ignore comment, or warning suppression.

Documentation changes also run `public-surface` and `mkdocs build --strict`.
Skills under `agent/graph_os_webui/skills/` are not in `mkdocs.yml` nav — graph-os
discovers them as package data, not Pages content — so a skill-only change
skips `mkdocs build --strict` unless it also touches `docs/` or `mkdocs.yml`.

## Development rules

- Keep changes small, typed, and tied to one observable outcome. Use
  Pydantic models at Python boundaries and TypeScript types at browser
  boundaries; validate untrusted values before rendering or forwarding them.
- Never place a Graph OS service bearer, provider secret, or raw durable
  credential in browser state.
- Never stage with `git add -A` or `git add .`; stage an explicit path
  allowlist and review `git diff --cached` before committing.
- Never hand-edit version strings — use `bump-my-version bump patch|minor|major`.
- After a dependency change, regenerate and commit the lockfile with the
  declaration (`uv lock` + `uv.lock`, or `pnpm install` + `pnpm-lock.yaml`).
- Shared multi-worktree repository on a maintainer workstation: never edit
  the canonical checkout or `git stash` (the stash ref is shared by every
  worktree). Create a real Git worktree per lane
  (`git worktree add "$WORKTREE_ROOT/agent-webui/<branch>" -b <branch> main`),
  never a harness-managed isolated worktree against this repository.

## Skill packaging

This directory (`agent/graph_os_webui/skills/<name>/SKILL.md`) is already
covered by `pyproject.toml`'s `[tool.setuptools.package-data]` entry
(`graph_os_webui = ["dist/**", "icon.png", "skills/**/*"]`) and the
`agent_utilities.skill_providers` entry point
(`agent-webui = "graph_os_webui.skills"`) — a new `SKILL.md` needs no further
packaging change.
