# Agent WebUI engineering contract

<!-- agent-contract:start -->
## Agent contract

Tool-neutral rules for any AI agent or human working in this repository. This block is maintained by the fleet standard; edit outside the markers.

- **Owner boundary:** this repository owns what a person sees in the web interface. Data reaches it only through arbora (spec prefix `WEBUI-`). Feature routing across repositories: [ecosystem boundaries](https://github.com/Knuckles-Team/pipelines/blob/main/reference/ecosystem-boundaries.md).
- **Setup:** run `scripts/bootstrap.sh`. It is idempotent and non-interactive. It pins uv and Python, syncs the locked environment, installs the git hooks and prints the gate command.
- **Gates:** `uvx pre-commit run --all-files` must pass before every push. Do not bypass hooks to get green.
- **Commits:** one logical change per commit with a `Spec: <ID>` trailer (or `Spec: none (<reason>)`), plus a `Co-Authored-By:` trailer naming the assisting agent. Stage explicit paths only; never `git add -A` or `git add .`. Use the contributor's own configured Git identity, never a tool or bot name.
- **Org rules:** [organization AGENTS.md](https://github.com/Knuckles-Team/.github/blob/main/AGENTS.md).
<!-- agent-contract:end -->

This file defines the current repository contract for contributors and
automation. `CLAUDE.md` imports it, so edit this file when the contract changes.

## Boundaries

- **Owns:** what a person sees in the browser.
- **Never builds:** data access other than through arbora, or a decision (route decisions to epistemic-graph). Served operations go to arbora.
- **Allowed dependencies:** `arbora.client` and agent-connector-sdk. It imports no EG or arbora internals in-process.

Route every feature with the [ecosystem boundaries standard](https://github.com/Knuckles-Team/pipelines/blob/main/reference/ecosystem-boundaries.md) before any code. A part this repository does not own goes to its owner's specs.

## What this repository owns

Agent WebUI owns the browser presentation layer for Arbora. It also owns
the FastAPI host that safely adapts browser protocols to the platform gateway.
Its public surface includes:

- the React chat, Atlas, ontology, graph, workflow, administration, and
  operational views;
- AG-UI streaming, optional ACP sessions, WebSocket updates, and browser-safe
  REST adapters;
- browser identity, session, origin, host, CSP, and permission enforcement;
- sandboxed MCP App rendering and host-mediated MCP calls; and
- the packaged frontend assets, Python wheel, container image, and Pages site.

Keep authority at its owning layer. Arbora owns authentication, composition,
routing, and gateway contracts. epistemic-graph owns durable graph state,
queries, reasoning, schemas, and evidence. Agent Utilities owns agent and
workflow control-plane behavior. Connector packages own source transport. This
repository renders and adapts those capabilities; it must not create parallel
graph, orchestration, connector, or scheduling implementations.

## Architecture and module map

The runtime path is:

```text
browser -> React application -> Agent WebUI FastAPI host
        -> authenticated Arbora gateway -> epistemic-graph / agent fleet
```

- `src/App.tsx` and `src/Chat.tsx`: application shell and streaming chat.
- `src/components/`: views, UI primitives, renderers, graphs, and workflows.
- `src/hooks/`: reusable browser behavior and stateful integrations.
- `src/lib/`: typed clients, protocol adapters, validation, and state helpers.
- `src/lib/nav-registry.ts`: the single declarative route registry
  (`RouteDef`, `ROUTES`/`PUBLIC_ROUTES`/`ROUTE_REGISTRY`). Adding a page means
  adding one entry here; `App.tsx` mounts every route generically from it.
- `agent/agent_webui/server.py`: FastAPI composition, middleware, and assets.
- `agent/agent_webui/api_extensions.py`: canonical service browser facades.
- `agent/agent_webui/oidc_session.py`: OIDC flow and protected sessions.
- `agent/agent_webui/graph_identity.py`: request-scoped graph identity.
- `agent/agent_webui/graph_admission.py`: graph operation authorization.
- `agent/agent_webui/browser_control.py`: attended browser-control boundary.
- `agent/agent_webui/observability.py`: redacted request telemetry.
- `public/`: static assets copied into the production build.
- `docs/` and `mkdocs.yml`: published reference documentation.
- `agent/agent_webui/__tests__/`: backend contract and security tests.
- `src/**/__tests__/` and `e2e/`: frontend and browser tests.

Frontend server state uses React Query. Chat uses the Vercel AI SDK. Local UI
state uses React context or component state. The FastAPI host mounts canonical
gateway routes instead of maintaining a separate browser-only implementation.

## Commands

Use Python 3.12–3.14, the Node.js version in `.node-version`, `pnpm`, and `uv`
0.9 or newer. Bootstrap a fresh clone (locally, or automatically in a Claude
Code cloud session through `.claude/hooks/session-start.sh`) with:

```bash
scripts/bootstrap.sh            # gate tooling, uv >= 0.9, Python, locked .venv, pnpm deps, git hooks
cp .env.example .env
```

Every locked dependency, agent-utilities and agent-connector-sdk included,
resolves from PyPI. `scripts/siblings.lock` pins only the agent-utilities
checkout under `.uv-workspace-siblings/` that supplies shared gate scripts. The
bootstrap checks it out and leaves an existing workspace symlink alone.

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
uv run --no-sync pytest tests
uvx pre-commit run --config .config/pre-commit.yaml --all-files
uvx pre-commit run --config .config/pre-commit.yaml --all-files --hook-stage manual
python -m agent_webui.server --security-doctor --host 0.0.0.0
```

agent-webui ships only as a PyPI package (wheel and sdist). Arbora installs it
through its `webui` extra and serves it in-process on port 8080; there is no
container image or deploy script in this repository.

## Quality gates

`scripts/bootstrap.sh` installs the commit and push hooks. Run focused tests
while developing, then run
`uvx pre-commit run --config .config/pre-commit.yaml --all-files` before
committing. Hosted CI (the `CI required` aggregate (alias `gates`) in `.github/workflows/ci.yml`, also
the pull-request check) runs the same file after the same bootstrap, so the
hook list is the one definition of the gate. Automatic pre-push checks are
bounded; full pytest, typecheck, wheel builds, and repository-wide lint remain
manual checks.

A hook whose tool or sibling checkout is missing prints
`SKIPPED (<gate>): <reason>` and passes locally; with `CI` set it fails closed
with exit status 2 (`CANNOT RUN`). Gates never call external services such as
package indexes or advisory databases at run time. The privacy gate derives
local identities from the ambient account only on a developer machine; on CI
and in cloud sessions only the declared `AGENT_UTILITIES_PRIVACY_IDENTIFIERS`
list applies, while the home-path and internal-host detectors run everywhere.
Do not bypass a gate with `--no-verify`, `SKIP`, diagnostic ignores,
or warning suppression. Fix the source of each finding or report a genuine
environmental blocker.

For documentation changes, build Pages:

```bash
mkdocs build --strict
```

For frontend behavior, pair unit coverage with a test that reaches the rendered
route or component. For backend behavior, prove the real FastAPI entry point and
the injected service seam. Security changes require positive and adversarial
tests for authorization, origin/host validation, bounds, redaction, and failure
behavior. A production build must regenerate and check packaged assets rather
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
- Never place an Arbora service bearer, provider secret, or raw durable
  credential in browser state. Keep MCP Apps sandboxed and host-mediated.
- Non-loopback serving must retain checked JWT/OIDC, exact host and origin
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

Update documentation with the behavior it describes. Check local links,
Markdown style, and `mkdocs build --strict`. Keep commands runnable from the
repository root and keep environment-variable names aligned with the code and
`.env.example`.

## Branching & isolation

Work on a topic branch and open a pull request against `main`; the `gates` job
must pass before merge. Keep commits logical and conventional, push with
`git push -u origin <branch>`, and open the pull request as a draft until the
gates and review are complete.

On a maintainer workstation this is a shared multi-worktree repository. Never edit the canonical checkout.
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
remove a branch only when the task explicitly authorizes that action.

## Specs: extend first

Find the spec row that owns the behavior before any code change. Search with `git grep -n "<term>" -- specs`. Cite the row ID in the commit `Spec:` trailer. Extend the owning spec before any new spec text. Add a child row, a new rollup, or a dated `plan.md` "Amendments" entry. Create a new spec only for a capability that no spec owns. Audits, reviews, and carry-overs land in the owning spec. They never get a spec directory. Reuse an existing function, module, or store before adding one. The rules are the ecosystem [spec standard](https://github.com/Knuckles-Team/pipelines/blob/main/reference/spec-standard.md).
