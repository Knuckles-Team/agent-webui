# Agent Guidelines for @pydantic/agent-webui

> **Notice:** This project uses **Spec-Driven Development (SDD)**.
> - Project constitution and governance: `.specify/memory/constitution.md`.
> - Feature specifications and tasks: `.specify/specs/` and `.specify/tasks/`.
> This file (`AGENTS.md`) is for system-prompt context; the SDD directory is the source of truth for architecture and new features.

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

_Generated for agentic coding agents to maintain consistency in this codebase._

## Architecture Details

### Recent Architecture Changes

- **Comprehensive API Extensions**: Added 20+ new API endpoints for knowledge graph CRUD, knowledge base management, SDD lifecycle, MAGMA views, resource management, and maintenance operations
- **Enhanced Frontend Components**: Created GraphView with interactive visualization, KnowledgeBaseView for KB management, MemoryView for memory management, and SDDView for spec-driven development
- **Testing Infrastructure**: Implemented comprehensive testing with Vitest (frontend), Pytest (backend), Playwright (E2E), and CI/CD pipeline with coverage reporting
- **Knowledge Graph Integration**: Full CRUD operations for memory nodes, article management, and MAGMA orthogonal views (semantic, temporal, causal, entity)
- **Backend Abstraction**: GraphBackend factory supporting LadybugDB (default), FalkorDB, and Neo4j for hot-swappable database backends
- **ACP protocol** now routes through the full HSM graph pipeline (not a flat agent) via `create_graph_acp_app()`.
- **Graph Activity visualization** (`GraphActivity.tsx`) shows specialist routing decisions, parallel execution status, tool calls, and expert reasoning in a collapsible timeline.
- Backend uses `create_agent_web_app()` in `agent/agent_webui/server.py` to compose Pydantic AI web routes with enhanced workspace APIs.
- **Unified execution**: all protocols (AG-UI, ACP, SSE /stream) share the same graph engine via `graph/unified.py`.
- **Human-in-the-loop approval** (`ApprovalCard.tsx`) intercepts security-sensitive tool calls before execution.
- **Conversation persistence** merges localStorage entries with server-side records from `/api/enhanced/chats`.
- **Unified specialist discovery**: The backend now uses `discover_all_specialists()` to merge MCP agents (`NODE_AGENTS.md`) and A2A peers (`A2A_AGENTS.md`) into a single `DiscoveredSpecialist` roster during graph bootstrap. Both sources share the same registration and tag-prompt code path. The frontend does not need changes -- it consumes the same sideband events regardless of specialist source.
- **Tool-count telemetry**: The `tools-bound` sideband event now includes `toolset_count`, `dev_tools`, and `mcp_tools` breakdowns alongside the existing `count` and `tools` fields. `GraphActivity.tsx` can render these for richer tool-binding visibility.
- **Structured trace logger**: The backend emits structured log lines to `agent_utilities.graph.trace` for every graph event, enabling server-side prompt-flow tracing without the UI.
- **Model registry is backend-driven**: the hardcoded `MODEL_COST_TABLE` in `Chat.tsx` has been removed. Both the model picker and the per-session cost badge now consume `GET /api/enhanced/models` (which mirrors the `agent-utilities` core `GET /models`). The payload shape is `{ models: ModelDefinition[], default_id: string | null }`; see `agent-utilities/AGENTS.md` > *Model Registry* for the data model. Zero-cost models render as `$0.00` so token / tool counts remain visible for local / free deployments.

### Protocol Flow

```
AG-UI: /api/chat  -> Vercel AI SDK useChat -> pydantic-ai agent -> graph (via tools)
ACP:   /acp/*     -> create_graph_acp_app() -> graph (via run_graph_flow tool)
SSE:   /stream    -> run_graph_stream() -> direct graph execution
```

### Key Component Map

| Component         | File                                         | Responsibility                                                                                            |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Chat              | `src/Chat.tsx`                               | Main chat interface with streaming, tool execution, graph activity, multi-modal input, approval workflows |
| GraphActivity     | `src/components/GraphActivity.tsx`           | Real-time graph execution timeline (routing, parallel execution, tool binding, expert reasoning)          |
| ApprovalCard      | `src/components/ApprovalCard.tsx`            | Human-in-the-loop tool approval for security-sensitive operations                                         |
| Part              | `src/Part.tsx`                               | Message part renderer (text, tool calls, elicitation forms, sources, images)                            |
| AppSidebar        | `src/components/app-sidebar.tsx`             | Navigation, conversation history, agent identity, view switching                                          |
| **New Components** |                                              |                                                                                                          |
| GraphView         | `src/components/views/GraphView.tsx`         | Interactive graph visualization with layouts, zoom/pan, node inspection, statistics                      |
| KnowledgeBaseView | `src/components/views/KnowledgeBaseView.tsx` | Knowledge base ingestion, article management, health checks, search                                      |
| MemoryView        | `src/components/views/MemoryView.tsx`        | Memory CRUD with timeline visualization, importance scoring, advanced search                             |
| SDDView           | `src/components/views/SDDView.tsx`          | Spec-driven development: constitution, specs, plans, tasks, memory synchronization                        |
| **Workspace Views** |                                              |                                                                                                          |
| FilesView         | `src/components/views/FilesView.tsx`         | Workspace file browser                                                                                    |
| SkillsView        | `src/components/views/SkillsView.tsx`        | Universal skills viewer and configuration                                                                 |
| SchedulingView    | `src/components/views/SchedulingView.tsx`    | Cron task monitoring and management                                                                       |
| ConfigurationView | `src/components/views/ConfigurationView.tsx` | Agent and workspace configuration                                                                         |
| KnowledgeView     | `src/components/views/KnowledgeView.tsx`     | Knowledge base and embedding management (legacy)                                                          |
| **Protocol**       |                                              |                                                                                                          |
| ACP Client        | `src/lib/acp-client.ts`                      | ACP protocol client (session management, JSON-RPC, SSE event streaming)                                   |
| MCP Context       | `src/lib/mcp-context.tsx`                    | MCP tool context provider for the React tree                                                              |

### Backend Structure

| Module         | File                                  | Responsibility                                                                                                  |
| -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Server Factory | `agent/agent_webui/server.py`         | `create_agent_web_app()` -- composes FastAPI app with Pydantic AI routes, enhanced APIs, and SPA static serving |
| API Extensions | `agent/agent_webui/api_extensions.py` | `/api/enhanced/*` routes for knowledge graph, KB, SDD, MAGMA, resources, and maintenance                    |

### Environment Variables (Frontend)

| Variable          | Default | Description                                 |
| ----------------- | ------- | ------------------------------------------- |
| `VITE_ENABLE_ACP` | `false` | Enable ACP protocol support alongside AG-UI |

### Graph Activity Event Types

The `GraphActivity` component renders sideband events emitted by the agent orchestrator. Key event types:

| Event                                                         | Description                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `routing_started` / `routing_completed`                       | Domain routing analysis and result                                        |
| `plan_created`                                                | Execution plan generated with step count                                  |
| `step_dispatched` / `batch_dispatched`                        | Sequential or parallel specialist dispatch                                |
| `parallel_execution_started` / `parallel_execution_completed` | Fan-out/fan-in of parallel specialist execution                           |
| `specialist_enter` / `specialist_exit`                        | HSM entry/exit with duration tracking                                     |
| `expert-metadata`                                             | Specialist handshake and initialization                                   |
| `tools-bound`                                                 | Tool binding confirmation with count, toolset_count, dev_tools, mcp_tools |
| `subagent_tool_call` / `subagent_tool_completed`              | Individual tool execution within a specialist                             |
| `subagent_text`                                               | Streaming text delta from a specialist                                    |
| `subagent_completed`                                          | Specialist execution finished                                             |
| `expert-warning`                                              | Warning or degraded-mode notification (e.g. 0 tools bound)                |
| `verification_result`                                         | Quality gate score and feedback                                           |
| `replanning_started` / `replanning_completed`                 | Plan-level failure recovery                                               |
| `graph_force_terminated`                                      | Infinite-loop guard triggered                                             |

### API Endpoint Summary

#### Knowledge Graph APIs
- `GET /api/enhanced/graph/stats` - Graph statistics
- `GET /api/enhanced/graph/nodes` - List graph nodes
- `GET /api/enhanced/graph/relationships` - List relationships
- `POST /api/enhanced/graph/memory` - Create memory node
- `GET /api/enhanced/graph/memory/{id}` - Get memory node
- `PUT /api/enhanced/graph/memory/{id}` - Update memory node
- `DELETE /api/enhanced/graph/memory/{id}` - Delete memory node
- `POST /api/enhanced/graph/link` - Link nodes
- `GET /api/enhanced/graph/search` - Hybrid search
- `GET /api/enhanced/graph/impact/{symbol}` - Impact analysis
- `POST /api/enhanced/graph/query` - Execute Cypher query

#### Knowledge Base APIs
- `POST /api/enhanced/kb/ingest` - Ingest knowledge base
- `GET /api/enhanced/kb/list` - List knowledge bases
- `GET /api/enhanced/kb/search` - Search knowledge base
- `GET /api/enhanced/kb/article/{id}` - Get article
- `POST /api/enhanced/kb/health` - Health check

#### SDD Lifecycle APIs
- `GET /api/enhanced/sdd/constitution` - Get constitution
- `POST /api/enhanced/sdd/constitution` - Save constitution
- `GET /api/enhanced/sdd/specs` - List specifications
- `POST /api/enhanced/sdd/spec` - Create specification
- `GET /api/enhanced/sdd/plans` - List implementation plans
- `GET /api/enhanced/sdd/tasks` - Get tasks
- `POST /api/enhanced/sdd/sync` - Sync SDD to memory

#### MAGMA View APIs
- `POST /api/enhanced/graph/magma` - Retrieve orthogonal context

#### Resource Management APIs
- `GET /api/enhanced/resources` - List callable resources
- `POST /api/enhanced/resources/spawn` - Spawn specialized agent

#### Maintenance APIs
- `GET /api/enhanced/maintenance/status` - Get maintenance status
- `POST /api/enhanced/maintenance/trigger` - Trigger maintenance operation

#### Pipeline APIs
- `GET /api/enhanced/pipeline/status` - Get pipeline status
- `POST /api/enhanced/pipeline/trigger` - Trigger pipeline phase
