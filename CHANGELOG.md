# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Ecosystem Integration (CONCEPT:ECO-4.7)** — Classified as `FrontendPackage` in the kernel ecosystem topology. Inherits project-aware context (KG-2.14) from `agent-utilities` kernel.
- **CONCEPT:KG-2.18: Topological Graph Visualization** — Replaced legacy canvas with scalable WebGL Sigma.js visualization capable of 100K+ nodes. Added ForceAtlas2 physics and interactive GraphOverlayUI.

## [0.37.0] - 2026-06-06

### Added
- **Visual Workflow Editor (D9)** — New node-based `/workflows` view for composing, editing and running agent workflows visually, round-tripping the backend canonical `WorkflowSpec`.
  - Frontend: `@xyflow/react` (React Flow) canvas with six custom node kinds (Agent, Tool, Skill, Step, Team, Router), a capabilities-driven drag-and-drop `NodePalette`, a Radix-based `Inspector` (model / system prompt / tool tags / required capability), and a toolbar (New / Load / Save / Run / auto-layout) with live per-node run status (idle → running → done/error) plus best-effort capability-validation warnings.
  - Serializer (`src/lib/workflow.ts`): stable canvas ↔ `WorkflowSpec` mapping — `orchestrates` from prefixed `agent:`/`tool:`/`skill:` refIds, `steps` from the topological order of the DAG; a persisted canvas sidecar restores the layout verbatim on reload.
  - Backend (`agent_webui/api_extensions.py`): `GET /workflows`, `GET /workflows/capabilities`, `POST /workflows` (persists a canonical `WorkflowSpec` plus a `:WorkflowCanvas` sidecar), and `POST /workflows/{wid}/run` (dispatches via `AgentOrchestrationEngine.dispatch(mode="workflow")`, degrading to `{status:"error"}` instead of 500). Orchestration imports are lazy/guarded.
  - Tests: vitest serializer round-trip + validation suite and a view smoke test; pytest coverage for the new endpoints; a Playwright e2e (`e2e/workflow-editor.spec.ts`).

## [1.1.0] - 2026-02-16

### Added
- display tool error text in modal dialog

## [1.0.0] - 2026-01-09

### Added
- setup automation
