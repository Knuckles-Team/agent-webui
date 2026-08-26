# Agent Guidelines for @pydantic/agent-webui

> Claude Code loads this file via `CLAUDE.md` (`@AGENTS.md` import) — the two stay in sync. Edit this file, not `CLAUDE.md`.


> **Notice:** This project uses **Spec-Driven Development (SDD)**.
> - Project constitution and governance: `.specify/memory/constitution.md`.
> - Feature specifications and tasks: `.specify/specs/` and `.specify/tasks/`.
> This file (`AGENTS.md`) is for system-prompt context; the SDD directory is the source of truth for architecture and new features.

<!-- Ecosystem Concepts (cross-project, from agent-utilities kernel) -->
<!-- CONCEPT:AU-OS.deployment.infra-orchestration Ecosystem Topology Map — classified as FrontendPackage -->
<!-- CONCEPT:AU-KG.retrieval.evidence-weighted-memory Topological Graph Visualization — owned by this project -->
<!-- CONCEPT:AU-KG.memory.ground-truth-preamble-declaring Project-Aware Context — AGENTS.md auto-loaded by kernel -->
<!-- CONCEPT:EG-KG.query.wire-protocol Cross-Pillar Synergy Engine — topology consumer -->

## Tech Stack

- **Frontend Framework**: React 19 (`react`/`react-dom` 19.2.4) with TypeScript
- **Styling**: Tailwind CSS and shadcn/ui components
- **Routing & Tooling**: Vite, React Router, Radix UI
- **Backend Framework**: FastAPI (Python)
- **Agent Orchestration**: Pydantic AI with LadybugDB/Neo4j graph backends
- **Database**: LanceDB for vectors, LadybugDB for knowledge graph

## Project Structure

```text
agent-webui/
├── agent/                  # Python backend application
│   └── agent_webui/        # Core FastAPI and Pydantic AI integration
├── src/                    # React frontend application
│   ├── components/         # React components (ui, views, chat elements, knowledge-graph)
│   ├── hooks/              # Custom React hooks
│   └── lib/                # Utilities and protocol clients (ACP)
├── docs/                   # Detailed documentation
├── .specify/               # SDD architecture and specs
├── AGENTS.md               # Developer/Agent guidelines
└── pyproject.toml          # Python dependencies
```

## Build, Lint, and Test Commands

### Frontend

```bash
# Install dependencies
pnpm install

# Start development server (proxies /api to localhost:8000)
pnpm run dev

# Start backend server on port 38001 (separate terminal)
pnpm run dev:server

# Build for production
pnpm run build

# Preview production build
pnpm run preview

# Type checking (TypeScript)
pnpm run typecheck

# Linting (ESLint)
pnpm run lint

# Auto-fix linting issues
pnpm run lint-fix

# Format code (Prettier)
pnpm run format
```

### Backend (Manual)

```bash
# Start backend server
cd agent
uv run uvicorn chatbot.server:app --port 8000
```

Note: Stop any logfire platform instances to avoid port 8000 conflicts.

### Running Tests

```bash
# Frontend tests
pnpm run test              # Run unit tests
pnpm run test:ui           # Run tests with UI
pnpm run test:coverage     # Run with coverage
pnpm run test:watch        # Watch mode

# Backend tests
cd agent
pytest agent_webui/__tests__/              # Run backend tests
pytest agent_webui/__tests__/ --cov        # With coverage
pytest agent_webui/__tests__/test_api_extensions.py  # Specific test file

# E2E tests
pnpm run test:e2e          # Run E2E tests with Playwright
pnpm run test:e2e:ui       # Run E2E tests with UI
pnpm run test:e2e:headed   # Run E2E tests in headed mode
```

### Coverage Targets

- **Frontend**: 90% code coverage (Vitest)
- **Backend**: 85% code coverage (Pytest)
- **Integration**: 80% code coverage

See [TESTING.md](TESTING.md) for comprehensive testing documentation.

## Build & Deploy (container image + k8s)

**One** local command builds and deploys the k8s-hosted UI end to end:
`docker/deploy.sh` (add `--build-only` or `--skip-deploy` to stop early). **One**
GitHub Actions workflow (`.github/workflows/docker-publish.yml`, gated on a `v*`
tag) cuts the production image from the same `docker/Dockerfile`. Full contract,
env vars, and the coordination protocol for concurrent deploys are documented in
README.md's [Build & Deploy](README.md#build--deploy) section — read it before
touching anything under `docker/` or the k8s manifest.

Do not hand-roll a `docker build`/`kubectl set image` sequence, and do not
`kubectl apply` `inventory/k8s-migration/cutover/apptier/agent-webui.yaml` to
change the running image — that file's `image:` field is a point-in-time
snapshot, not the source of truth (see its own header comment). Three traps
already cost a day of production incidents before these scripts existed —
README.md's Build & Deploy section names all three; the short version: (1) a
digest-pinned Deployment still needs `kubectl set image ...@sha256:<new>`, a
plain rollout restart re-pulls identical bits forever; (2) `uv pip install
agent-utilities[...]` can silently resolve a stale PyPI release instead of the
locally built wheel; (3) the served frontend `dist/` is independently stale from
the backend because of a live NFS mount that shadows it — rebuilding the Docker
image alone does not ship a frontend change; `docker/deploy.sh` handles this by
also rebuilding `dist/` on the canonical checkout and verifying the live pod
serves it.

## Code Style Guidelines

### TypeScript/JavaScript

#### Formatting

- Use Prettier with default settings (via `pnpm run format`)
- Maximum line length: 100 characters
- Use semicolons
- Single quotes for strings
- Trailing commas in multi-line structures

#### Imports

- Sort imports: built-in, external, internal
- Internal imports use `@/` alias (maps to `./src/`)
- Relative imports for files in same directory
- Named imports destructured when importing 2+ items
- Default imports first, then named imports

Example:

```typescript
import React from 'react'
import { useState, useEffect } from 'react'
import { Chat } from '@/components/Chat'
import { useChat } from '@/hooks/useChat'
import './styles.css'
```

#### Types and Interfaces

- Use interfaces for object shapes, types for complex types
- Prefer explicit return types for exported functions
- Use type aliases for union/intersection types
- Avoid `any`; use `unknown` with type guards
- Define props interfaces for components

#### Naming Conventions

- Components: PascalCase (e.g., `Chat.tsx`)
- Functions and variables: camelCase
- Constants: UPPER_SNAKE_CASE
- Files and directories: kebab-case
- Type interfaces: PascalCase with `Props` suffix for component props

#### Error Handling

- Use try/catch for asynchronous operations
- Throw specific error types rather than strings
- Handle errors at boundaries (API calls, event handlers)
- Log errors appropriately for debugging
- Show user-friendly error messages in UI

#### React Specific

- Use functional components with hooks
- Prefer `const` for function declarations
- Use early returns for conditional rendering
- Extract complex logic into custom hooks
- Use React.memo for performance optimization when needed
- Accessibility: add alt text, labels, keyboard navigation

#### ESLint Configuration

- Uses neostandard with TypeScript and Prettier
- Rules enforced via `pnpm run lint`
- Key rules:
  - No console.log in production (except debug)
  - Consistent return statements
  - No unused variables or imports
  - Proper react/jsx-no-target-blank
  - React hooks rules enabled

## Architecture Conventions

> **Note:** The complete specification for the core **Chat Interface** (streaming, graph activity, approvals) is now formally tracked in `.specify/specs/chat_interface.md`.

### Frontend

- State management: React Query for server state, Context/Zustand for client state
- Routing: File-based via Vite (pages directory pattern)
- Styling: Tailwind CSS with custom classes in src/styles/
- Components: shadcn/ui primitives in src/components/ui/
- AI elements: Vercel AI SDK wrappers in src/components/ai-elements/
- Testing: Vitest for unit tests, Playwright for E2E tests
- Coverage: @vitest/coverage-v8 with 90% target
- Ontology operator views: `ObjectExplorerView.tsx` (object-set search/pivot/aggregate/bulk-actions), `ObjectView.tsx` (single-object hub: properties/derived/links/markings/edit-history), and `VertexView.tsx` (graph-canvas what-if scenario), all over `/api/enhanced/ontology/*` — see README "Ontology Operator Views".
- Vitest harness: a single React instance is enforced via pnpm `overrides` (`react`/`react-dom` pinned to 19.2.4); `src/__tests__/setup.ts` provides jsdom shims — a route-aware `fetch` shim for `/api/enhanced/*` and a WebGL/WebGL2 `getContext` stub for sigma.js graph rendering.

### Backend

- FastAPI app with Pydantic AI agent
- Endpoints under /api/ and /api/enhanced/*
- Model configuration in agent/chatbot/
- Vector storage with LanceDB
- Testing: Pytest with pytest-cov, 85% coverage target
- Knowledge Graph: LadybugDB (default), FalkorDB, Neo4j support via GraphBackend abstraction

## Additional Notes

- Commit messages: Follow conventional commits (feat:, fix:, docs:, etc.)
- Branch naming: feature/_, bugfix/_, release/\*
- Pull requests: Include summary and testing steps
- Documentation: Update README.md for user-facing changes
- Performance: Monitor bundle size with vite-bundle-analyzer
- Security: Never commit secrets; use environment variables

## Getting Started

1. Fork and clone repository
2. Run `pnpm install`
3. Start development: `pnpm run dev` (frontend) and `pnpm run dev:server` (backend)
4. Open http://localhost:5173

---

## Detailed Documentation

For comprehensive documentation, see the `docs/` directory:

- **[Architecture](docs/architecture.md)** — Protocol flow, component map, backend structure
- **[Agents & Events](docs/agents.md)** — Graph activity event types, specialist discovery, telemetry
- **[Features](docs/features.md)** — API endpoints, environment variables, recent architecture changes

## ⛔ No Scratch or Temporary Files in Repository

**NEVER write any of the following to this repository:**
- Temporary test scripts (`test_*.py`, `debug_*.py` outside of `tests/`)
- Scratch scripts or experimental one-off files
- Log files (`.log`, `.txt` command output)
- Random text files with command output or debug dumps
- Any file that is NOT production source code, tests in `tests/`, or documentation

**Why:** These files expose private filesystem paths, credentials, and internal infrastructure details when pushed to GitHub publicly.

**Where to put scratch work instead:**
- Use `~/workspace/scratch/` for temporary scripts and experiments
- Use `~/workspace/reports/` for command output and reports
- Keep test scripts in the `tests/` directory following proper pytest conventions


## ⛔ Keep the Repository Root Pristine

The repository root must contain only canonical project files. The only hidden
directories allowed at root are `.git/`, `.github/`, `.specify/` (plus a local,
git-ignored `.venv/`). NEVER write scratch/debug/migration files to the repo —
especially the root: no `fix_*.py`/`migrate_*.py`/`refactor_*.py`/root `test_*.py`,
no `*.db`/`*.log`/scratch `*.txt`/`*.orig`/`*.rej`/`*.bak`, no build artifacts
(`*.tsbuildinfo`), and no AI scratch dirs (`.agent/`, `.agents/`, `.agent_data/`,
`.tmp/`, `.hypothesis/`). Put experiments in `~/workspace/scratch/`, tests in
`tests/`. Run `git status` before finishing and confirm no stray root files.

## Working Discipline — think, simplify, stay surgical, verify

These four habits cut the most common LLM coding mistakes. For trivial tasks, use
judgment; the bias here is correctness over speed.

- **Think before coding.** State your assumptions explicitly. If a request has more than
  one reasonable reading, surface the options instead of silently picking one. If a
  simpler approach exists, say so and push back when warranted. When something is
  genuinely unclear, stop and name what's confusing — ask, don't guess.
- **Simplicity first.** Write the minimum code that solves the stated problem — no
  speculative features, no abstraction for single-use code, no configurability that
  wasn't requested, no error handling for impossible states. If you wrote 200 lines and
  it could be 50, rewrite it. (Name code from its purpose, never `wave0`/`phase2`/`v2`.)
- **Stay surgical.** Every changed line should trace directly to the task. Don't refactor,
  reformat, or "improve" working code adjacent to your change; match the existing style
  even where you'd do it differently. Remove only the imports/symbols your own change
  orphaned; if you spot unrelated dead code, mention it rather than deleting it inline.
  *Exception — the Quality Bar below:* lint/format/type errors the pre-commit gate flags
  get fixed regardless of who introduced them. In short: **surgical on behavior, clean on
  lint.**
- **Verify against a goal.** Turn the task into a checkable outcome before you start:
  "fix the bug" → "write a failing test that reproduces it, then make it pass"; "add
  validation" → "tests for the invalid inputs pass". For multi-step work, state the short
  plan and the check for each step, then loop until the checks pass.

## Quality Bar — Leave the Codebase Clean (REQUIRED)

After completing any code change, run the project's pre-commit suite and drive it
**fully green** before committing:

```bash
pre-commit run --all-files
```

Resolve **every** issue it reports — failures, lint errors, type errors, and
warnings — **including problems that pre-date your change and were not caused by
your edits**. The standing goal is a clean, working codebase with **no errors and
no warnings**. Do not silence checks (`# noqa`, `# type: ignore`, `SKIP=`,
`--no-verify`) to force green unless the exception is already documented in this
file as a known, unavoidable limitation. Only commit once `pre-commit run
--all-files` passes cleanly; if a check legitimately cannot pass, stop and explain
why rather than bypassing it.

## Working with Git Worktrees (multi-session)

Multiple agents/sessions work the `agent-packages/*` repos concurrently. **Do not
edit the canonical checkout** (`${WORKSPACE_ROOT}/agent-packages/<repo>`) — a
background `repository-manager` sync can reset its working tree and discard
uncommitted edits. Take your own git worktree on your own branch instead:

```bash
# preferred — repository-manager MCP:
rm_worktree add <repo> <your-branch>      # -> ${WORKTREE_ROOT}/<repo>/<your-branch>

# raw-git fallback:
git -C agent-packages/<repo> checkout main
git -C agent-packages/<repo> worktree add ${WORKTREE_ROOT}/<repo>/<branch> -b <branch>
```

Work in the worktree and **commit often** (commits survive a working-tree reset).
Each session must use a **distinct branch** — git allows a branch in only one
worktree, which is what keeps concurrent sessions from colliding. Worktrees live
under `${WORKTREE_ROOT}/` (outside the workspace scan, so the sync leaves them
alone).

**Finishing work in a worktree** — run this sequence before calling it done:
1. **Pre-commit green** — `pre-commit run --all-files`; resolve every issue per the
   Quality Bar above (including pre-existing), no `--no-verify`.
2. **Commit** in the worktree.
3. **Merge to main locally** — `rm_worktree merge <repo> <branch> --into main`
   (or `git merge --no-ff`). Push only when the user asks.
4. **Clean up** — remove the worktree and delete the merged branch:
   `rm_worktree remove <repo> <branch> --delete-branch`; `rm_worktree prune` clears
   stale entries. (Raw-git: `git worktree remove <path> && git branch -d <branch>`.)

<!-- BEGIN concept-coordination (generated) -->
## Concept-ID Coordination (multi-session)

Working in parallel with other sessions/worktrees? **Reserve a concept id before you write its `CONCEPT:` marker** so two sessions never collide:

```bash
agent-utilities --json concept reserve --ns EG-KG.compute.backend   # or a package prefix, e.g. KEY
```

Full protocol (ledger, merge=union, reconcile, MCP/REST): <https://knuckles-team.github.io/agent-utilities/concept_coordination/>
<!-- END concept-coordination (generated) -->

## Version & lockfile drift edict (keep the version mirrors AND the lock in sync)

The two most common release-breakers in this fleet are **version drift** (the version in
`pyproject.toml`/`.bumpversion.cfg` advancing while `README.md`, `docker/Dockerfile`, and the
module `__version__`s lag) and a **stale `uv.lock`** (shipping known-vulnerable transitive deps).
A version mismatch makes the next `bump-my-version` throw `VersionNotFoundException`; a stale lock
is what Dependabot flags. Rules:

1. **Never hand-edit a version string.** Change the version ONLY via
   `bump-my-version bump {patch|minor|major}` (a.k.a. `bump2version`), which rewrites every file
   registered in `.bumpversion.cfg` in one atomic, tagged commit. If you edited the version in
   `pyproject.toml` by hand, you created drift — revert and use the bumper.
2. **Every version-bearing file must be registered in `.bumpversion.cfg`** — at minimum
   `pyproject.toml` AND `README.md`, plus `docker/Dockerfile` and any module `__version__`. Never
   add a file that embeds the version without a `[bumpversion:file:...]` entry for it.
3. **Re-lock on every dependency change.** After editing `pyproject.toml` deps/extras, run
   `uv lock` and commit `uv.lock` in the SAME change. The `uv-lock` pre-commit hook runs with
   `--locked` and fails on drift — never bypass it. The committed `uv.lock` is the
   Dependabot/security surface.
4. **Patch CVEs with a version floor at the source, then re-lock.** `uv` resolves one version
   graph-wide, so a lower-bound in the extra that pulls a dependency raises it for the whole lock.

## Provenance citations — `reports/*.md` resolves OUTSIDE this repo

Code and docs here cite planning artifacts as `reports/issue-register.md`,
`reports/seam-identity-closure.md`, `reports/waveN/ADR-*.md`, and similar.
**These are workspace-level documents; they are NOT paths in this repository.**
They resolve under the workspace root:

- `reports/issue-register.md`, `reports/seam-*.md`, `reports/waveN/ADR-*.md`
  → `plans/_archive/au-eg-program/`
- GOC-numbered items → `plans/graph-os-completion-program/`

`git log --all -- 'reports/issue-register.md'` in this repo correctly returns
**zero commits**. That is expected and is *not* evidence the citation is
fabricated — a per-repo git log cannot see a workspace-level document. That
exact absence-of-evidence was misread as evidence-of-absence on 2026-08-25,
and valid provenance was deleted from ~11 sites before it was caught and
restored.

**Before concluding any citation is fake, resolve the filename against the
workspace root.** New citations should use the qualified path
(e.g. `plans/_archive/au-eg-program/issue-register.md`) rather than the bare
`reports/...` form; existing bare citations are upgraded opportunistically,
not in a bulk sweep (a mass rewrite risks mis-mapping GOC-numbered items into
the wrong archive directory).
