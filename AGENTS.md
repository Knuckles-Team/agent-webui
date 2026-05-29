# Agent Guidelines for @pydantic/agent-webui

> **Notice:** This project uses **Spec-Driven Development (SDD)**.
> - Project constitution and governance: `.specify/memory/constitution.md`.
> - Feature specifications and tasks: `.specify/specs/` and `.specify/tasks/`.
> This file (`AGENTS.md`) is for system-prompt context; the SDD directory is the source of truth for architecture and new features.

<!-- Ecosystem Concepts (cross-project, from agent-utilities kernel) -->
<!-- CONCEPT:ECO-4.7 Ecosystem Topology Map — classified as FrontendPackage -->
<!-- CONCEPT:KG-2.18 Topological Graph Visualization — owned by this project -->
<!-- CONCEPT:KG-2.14 Project-Aware Context — AGENTS.md auto-loaded by kernel -->
<!-- CONCEPT:KG-2.19 Cross-Pillar Synergy Engine — topology consumer -->

## Tech Stack

- **Frontend Framework**: React 18 with TypeScript
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
