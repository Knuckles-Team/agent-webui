# Agent WebUI engineering contract

This file defines the current repository contract for contributors and
automation. `CLAUDE.md` imports it, so edit this file when the contract changes.

## What this repository owns

Agent WebUI owns the browser presentation layer for Graph OS and the FastAPI
host that safely adapts browser protocols to the platform gateway. Its public
surface includes:

- the React chat, Atlas, ontology, graph, workflow, administration, and
  operational views;
- AG-UI streaming, optional ACP sessions, WebSocket updates, and browser-safe
  REST adapters;
- browser identity, session, origin, host, CSP, and permission enforcement;
- sandboxed MCP App rendering and host-mediated MCP calls; and
- the packaged frontend assets, Python wheel, container image, and Pages site.

Keep authority at its owning layer. Graph OS owns authentication, composition,
routing, and gateway contracts. epistemic-graph owns durable graph state,
queries, reasoning, schemas, and evidence. Agent Utilities owns agent and
workflow control-plane behavior. Connector packages own source transport. This
repository renders and adapts those capabilities; it must not create parallel
graph, orchestration, connector, or scheduling implementations.

## Architecture and module map

The runtime path is:

```text
browser -> React application -> Agent WebUI FastAPI host
        -> authenticated Graph OS gateway -> epistemic-graph / agent fleet
```

- `src/App.tsx` and `src/Chat.tsx`: application shell and streaming chat.
- `src/components/`: views, UI primitives, renderers, graphs, and workflows.
- `src/hooks/`: reusable browser behavior and stateful integrations.
- `src/lib/`: typed clients, protocol adapters, validation, and state helpers.
- `agent/agent_webui/server.py`: FastAPI composition, middleware, and assets.
- `agent/agent_webui/api_extensions.py`: canonical service browser facades.
- `agent/agent_webui/oidc_session.py`: OIDC flow and protected sessions.
- `agent/agent_webui/graph_identity.py`: request-scoped graph identity.
- `agent/agent_webui/graph_admission.py`: graph operation authorization.
- `agent/agent_webui/browser_control.py`: attended browser-control boundary.
- `agent/agent_webui/observability.py`: redacted request telemetry.
- `public/`: static assets copied into the production build.
- `docs/` and `mkdocs.yml`: published reference documentation.
- `docker/`: reproducible image and deployment scripts.
- `agent/agent_webui/__tests__/`: backend contract and security tests.
- `src/**/__tests__/` and `e2e/`: frontend and browser tests.

Frontend server state uses React Query. Chat uses the Vercel AI SDK. Local UI
state uses React context or component state. The FastAPI host mounts canonical
gateway routes instead of maintaining a separate browser-only implementation.

## Commands

Use Python 3.12–3.14, the Node.js version in `.node-version`, `pnpm`, and `uv`.
Bootstrap a source checkout with:

```bash
pnpm install --frozen-lockfile
uv venv --python 3.12
source .venv/bin/activate
uv pip install -e '.[test]'
cp .env.example .env
```

Run the development services in separate terminals:

```bash
pnpm run dev:server  # FastAPI on port 38001
pnpm run dev         # Vite on port 5173
```

Common frontend checks:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:coverage
pnpm run test:e2e
pnpm run build
```

Backend and repository checks:

```bash
uv run --all-extras pytest agent/agent_webui/__tests__
pre-commit run --all-files
python -m agent_webui.server --security-doctor --host 0.0.0.0
```

Build and deploy only through the repository scripts:

```bash
docker/deploy.sh --build-only
docker/deploy.sh --skip-deploy
docker/deploy.sh
```

## Quality gates

Run focused tests while developing, then run `pre-commit run --all-files` before
committing. Do not bypass a gate with `--no-verify`, `SKIP`, diagnostic ignores,
or warning suppression. Fix the source of each finding or report a genuine
environmental blocker.

For documentation changes, run the shared public-surface gate and build Pages:

```bash
pre-commit run public-surface --all-files
mkdocs build --strict
```

For frontend behavior, pair unit coverage with a test that reaches the rendered
route or component. For backend behavior, prove the real FastAPI entry point and
the injected service seam. Security changes require positive and adversarial
tests for authorization, origin/host validation, bounds, redaction, and failure
behavior. A production build must regenerate and verify packaged assets rather
than relying on an existing `dist/` directory.

The public surface, privacy, root-hygiene, dependency, type, lint, build, wheel,
and test gates are release requirements. Treat a clean baseline as an invariant.

## Development rules

- Keep changes small, typed, and tied to one observable outcome. Reuse the
  canonical gateway action or client rather than adding another route-specific
  implementation.
- Preserve REST, streaming, WebSocket, and MCP behavior at their shared service
  seam. A control wired at only one entry point is incomplete.
- Use Pydantic models at Python boundaries and TypeScript types at browser
  boundaries. Validate untrusted values before rendering or forwarding them.
- Follow the checked-in Prettier, ESLint, Ruff, and mypy configuration. Use the
  `@/` alias for cross-directory frontend imports and relative imports locally.
- Never place a Graph OS service bearer, provider secret, or raw durable
  credential in browser state. Keep MCP Apps sandboxed and host-mediated.
- Non-loopback serving must retain verified JWT/OIDC, exact host and origin
  allowlists, bounded requests, CSP enforcement, and redacted access logging.
- Keep the repository root clean. Put durable source, tests, and documentation
  in their named directories; keep logs, caches, generated reports, databases,
  editor state, and experiments outside the repository.
- Never stage with `git add -A` or `git add .`. Review the full diff, stage an
  explicit path allowlist, then review `git diff --cached` before committing.
- Never hand-edit version strings. Use `bump-my-version bump patch|minor|major`
  so `pyproject.toml`, `package.json`, README, and module versions move together.
- After a Python dependency change, run `uv lock` and commit `uv.lock` with the
  declaration. After a JavaScript dependency change, use `pnpm` and commit
  `pnpm-lock.yaml` with `package.json`.
- Use conventional commit subjects and keep examples synthetic. Do not commit
  credentials, private endpoints, personal data, or machine-specific paths.

## Documentation

README.md is the concise public entry point. Keep feature inventories, protocol
details, security guidance, and operator procedures in `docs/`, and add each
published page to `mkdocs.yml`. Public documentation describes the current
product and must not expose internal planning notes, local filesystem paths, or
private infrastructure.

Update documentation with the behavior it describes. Verify local links,
Markdown style, and `mkdocs build --strict`. Keep commands runnable from the
repository root and keep environment-variable names aligned with the code and
`.env.example`.

## Branching & isolation

This is a shared multi-worktree repository. Never edit the canonical checkout.
Create a distinct branch and a real Git worktree for each lane:

```bash
git worktree add "$WORKTREE_ROOT/agent-webui/<branch>" -b <branch> main
```

Do not use harness-managed worktree isolation for this repository. It can alter
shared Git configuration used by every linked worktree. Do not use `git stash`:
the stash reference is shared by all worktrees and can exchange or consume
another lane's uncommitted changes.

Before delivery, confirm the worktree is clean except for the intended files,
run the required gates, commit with the repository author identity, and report
the commit SHA and evidence. Merge, push, tag, deploy, remove a worktree, or
delete a branch only when the task explicitly authorizes that action.
