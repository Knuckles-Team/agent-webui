# Project Constitution - agent-webui

## Vision & Mission
**agent-webui** is a high-fidelity, React-based web interface designed to provide a cinematic and interactive experience for agentic orchestration. Its mission is to bridge the gap between complex backend graph execution and intuitive user interaction through rich visualizations and real-time feedback.

## Core Principles
### Guiding Principles
- **Functional Components & Hooks**: All new components MUST be functional components using React Hooks.
- **Strict Typing**: TypeScript is non-negotiable. Avoid `any` at all costs; use `unknown` with type guards if necessary.
- **Component-Driven Design**: Leverage `shadcn/ui` primitives and maintain a clear separation between UI components and business logic hooks.
- **Cinematic Aesthetics**: Prioritize visual excellence, smooth transitions, and premium design tokens.

### Normative Statements
- **Coverage**: Frontend code MUST maintain at least 90% code coverage (Vitest).
- **Backend Sync**: Backend components in `agent/` MUST maintain at least 85% code coverage (Pytest).
- **Styling**: Use Tailwind CSS for all styling. Ad-hoc CSS should be avoided in favor of utility classes or design tokens.

## Governance
- **State Management**: React Query for server state; Context or Zustand for client state.
- **Routing**: File-based routing via Vite.
- **Decision Making**: Architectural changes must be documented in SDD specs and approved via pull request.

## Quality Gates
- **Testing**:
  - All new features MUST be implemented with corresponding **Pytests** (backend) or **Vitests** (frontend).
- **Verification Loop**:
  - After any code change, `pre-commit run --all-files` MUST be executed to verify integrity.
  - If issues are introduced, the implementation plan MUST be updated to address them, and the process repeated until all checks pass.
- **E2E Testing**: Critical user flows (chat, approval, graph view) MUST have Playwright E2E tests.

## Tech Stack & Standards
- **Frontend**: React, Next.js (pattern), Vite, Tailwind CSS, shadcn/ui, Vercel AI SDK.
- **Backend**: FastAPI, Pydantic AI.
- **Testing**: Vitest, Playwright, Pytest.

## Ecosystem Human Interface Guidelines (HIG)

All user-facing projects MUST strictly adhere to the unified **CONCEPT-HIG** (Human Interface Guidelines) to ensure ecosystem cohesion.

1. **Dynamic Brand Theming**: UIs MUST NOT use hard-coded branding colors. They MUST ingest a base brand color (e.g., OKLCH, Hex, or QPalette) and generate application palettes dynamically.
2. **Collapsible "Rail" Navigation**: All primary application navigation menus MUST support a graceful collapse into an icon-only "rail" to maximize workspace real-estate. Text labels must degrade to tooltips.
3. **Depth-Aware Modals**: Disruptive configurations or tool-approval flows (Tool Guards) MUST be presented in depth-separated modals. Where supported by the OS/Framework (Web, Qt), these MUST utilize glassmorphic/blur effects. In environments where it is not (Terminal), they MUST use simulated depth (borders, shadows, and z-index layers).
