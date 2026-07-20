# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-07-03

### Changed
- Pin the `agent-utilities[agent,graph]` test dependency to `>=1.4.0` — consumes the numpy-free
  epistemic-graph kernel backend + per-package ontology federation (dependency-cascade after
  epistemic-graph 2.8.0 → agent-utilities 1.4.0).

## [1.1.0] - 2026-07-03

### Added
- **Admin console view** (`AdminView.tsx` + `admin/` panels) — tenants, shard topology/health,
  RBAC, and backup/PITR over the engine admin APIs. Shards fully wired; RBAC/backup surfaced as
  clearly-labeled read-only panels where only the UDS engine op exists (no REST twin) — no fabricated data.
- **Live dashboards view** (`dashboards/` — PromQL, logs, traces panels + a composable shell with
  time-range + auto-refresh). PromQL + traces wired to `/graph/promql` + `/graph/traces`; logs marked
  placeholder until `/graph/logs` REST twin lands. Dependency-free inline SVG line chart.

## [Unreleased]

### Added
- **Interactive KG extraction view (CONCEPT:ECO-4.43)** — `ExtractionView.tsx`, an SSE-streamed
  fact-extraction cockpit over `/api/enhanced/extract/*` with Sigma.js edge-cards and longest-path
  surfacing. Includes a feature guide in `docs/`.
- **Usage & Cost view (CONCEPT:ECO-4.41)** — agentsview-parity dashboard surfacing per-model usage
  and cost over the backend `/api/observability` store.

### Changed
- **Infra & ecosystem handlers fail honestly** — infra handlers no longer fabricate success, and the
  ecosystem dashboards are de-stubbed onto the live MCP fleet (verified, no simulated success).

### Added
- **SWE Agent view (OS-5.34)** — `SweView.tsx`, a new sidebar view (`/swe`) for the KG-grounded
  software-engineering agent. Creates a developer-workspace runtime session
  (`POST /api/runtime/sessions`), sends shell actions (`/act`), and renders the **live
  action/observation event stream** over SSE (`/events`) beside a **KG-provenance panel** that
  shows the `WorkspaceAction` steps and the `Code` symbols each edit mutated
  (`/provenance`, KG-2.64) — the differentiator over a flat log. Adds typed client methods +
  DTOs (`SweProvenanceAction`/`SweMutatedEdge`/`SweBenchReport`) to `lib/api.ts`.
- **Ontology Operator UI** — Three operator views surfacing the `agent-utilities` ontology system (`kg.ontology`) over live `/api/enhanced/ontology/*` routes (no fixtures), resolved against the same `IntelligenceGraphEngine` backend and gated by `kg.ontology.permissioning.enforce`.
  - `ObjectExplorerView.tsx` — faceted/full-text object-set search with property filters, results table, pivot across a link type, search-around (N-hop related objects), aggregate metrics (count/sum/avg/min/max, optionally grouped), bulk Actions on a row selection through the governed `ActionExecutor` (Edit-Ledger writeback, HITL approve for high-risk verbs), and save/list of object sets.
  - `ObjectView.tsx` — single-object hub renderer: value-type-aware properties, computed derived properties, in/out links grouped by link type, marking/permission badges, bitemporal edit-history timeline, inline edit/revert; `variant` (full/panel) and `layout` (standard schema-derived / configured stored widget composition).
  - `VertexView.tsx` — graph-canvas exploration over an object-set seed with link-type expansion, per-node derived-property computation, and a what-if scenario mode (remove nodes, recompute an aggregate scenario metric, compare baseline vs delta).
  - Backend (`agent/agent_webui/api_extensions.py`): `/ontology/object-types`, `/property-types`, `/interfaces[/{name}/implementers]`, `/object-set/{search,search-around,pivot,aggregate,save,list,action}`, `/actions`, `/object/{id}[/edit,/revert]`, `/function/invoke`, `/derive`, `/document/process`, and `/object-view/{type}` (GET/POST). Maps to ontology concepts KG-2.38/40/41/47/48 and the action-type extension KG-2.42.
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
