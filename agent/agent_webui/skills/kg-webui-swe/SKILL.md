---
name: kg-webui-swe
description: >-
  The agent-webui software-engineering surface — the developer-workspace runtime
  (create a session, act, stream events, inspect KG provenance), SWE-bench runs,
  and the code call-graph views. Use when you want to drive a coding session in
  the UI, run SWE-bench, or explore the code graph / symbol navigation.
license: MIT
tags: [graph-os, webui, swe, code, workspace, provenance, swe-bench]
tier: surface
metadata:
  author: Genius
  version: '0.1.0'
---

# kg-webui-swe (surface)

Documents the software-engineering UI: the developer-workspace runtime
(OS-5.33/ORCH-1.46) where an agent creates a sandboxed session and streams
action/observation steps with KG provenance, the SWE-bench harness (AHE-3.22),
and the code call-graph / symbol-navigation views (KG-2.210/2.214).

## UI routes (agent-webui/src/App.tsx)
- `/swe` — `SweView` (create session, act, live event log, provenance graph).
- `/code-graph` — `CodeGraphView` (god nodes, communities, bridges, code metrics).

## Backing endpoints (from src/lib/api.ts)
- Runtime session: `POST /api/runtime/sessions {prefer_docker?,image?,actor?}`
  (`createSweSession`), `POST /api/runtime/sessions/{id}/act` (`sweAct`),
  `GET /api/runtime/sessions/{id}` (`sweStatus`),
  `GET /api/runtime/sessions/{id}/provenance` (`sweProvenance` → actions +
  `MUTATED` edges), `DELETE /api/runtime/sessions/{id}` (`stopSweSession`),
  `GET /api/runtime/sessions/{id}/events` — SSE action/observation log
  (`sweEventsUrl`).
- SWE-bench: `POST /api/swebench/run {instances, ingest?, remediate?}`
  (`runSweBench` → `SweBenchReport`).
- Code graph: `POST /api/graph/analyze {action:'code_metrics', target, top_k}`
  (`getCodeMetrics`), `GET /api/enhanced/code/instances`,
  `POST /api/enhanced/code/nav` (symbol navigation, CodeGraphView).

## How an agent drives it
Navigate to `/swe`, or drive directly: `POST /api/runtime/sessions` to open a
workspace, `POST /api/runtime/sessions/{id}/act {…}` to run each step, attach an
EventSource to `.../events`, then read `.../provenance` for the KG-recorded
actions and mutated symbols; `DELETE` to tear down. For headless code analysis
prefer the `kg-code` verb skill (`graph_code` / `graph_code_nav`); use this
surface for interactive coding sessions and rendered code-graph analytics.
