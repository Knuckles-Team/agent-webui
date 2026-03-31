# Agent Guidelines for @pydantic/agent-webui

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

Currently, there are no test scripts configured. To run a single test:

1. Set up a testing framework (e.g., Vitest) if needed
2. Add test scripts to package.json
3. Run specific test with: `pnpm vitest run path/to/test.test.ts -t "test name"`

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

### Frontend

- State management: React Query for server state, Context/Zustand for client state
- Routing: File-based via Vite (pages directory pattern)
- Styling: Tailwind CSS with custom classes in src/styles/
- Components: shadcn/ui primitives in src/components/ui/
- AI elements: Vercel AI SDK wrappers in src/components/ai-elements/

### Backend

- FastAPI app with Pydantic AI agent
- Endpoints under /api/
- Model configuration in agent/chatbot/
- Vector storage with LanceDB

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
