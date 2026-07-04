---
name: kg-webui-dashboards
description: >-
  The agent-webui dashboards & analytics surface — composable live panels
  (PromQL metrics, logs, traces) plus usage/cost observability. Use when you want
  to build a metrics dashboard in the UI, chart PromQL, view traces/logs panels,
  or analyze token usage and cost by model/project/agent.
license: MIT
tags: [graph-os, webui, dashboards, analytics, promql, traces, observability]
tier: surface
metadata:
  author: Genius
  version: '0.1.0'
---

# kg-webui-dashboards (surface)

Documents the analytics UI: the composable LiveDashboards panels (add/remove
PromQL metric, logs, and trace panels over a time range) and the usage/cost
observability views assimilated from agentsview.

## UI routes (agent-webui/src/App.tsx)
- `/dashboards` — `LiveDashboardsView` (panel grid: PromQL / Logs / Traces).
- `/usage` — `UsageView` and `/observability` — `ObservabilityView`
  (token/cost/session analytics).

## Backing endpoints (from src/lib/api.ts + dashboards panels)
- Metrics: `POST /api/graph/promql` (PromqlPanel — LIVE, EG-172/302).
- Traces: `POST /api/graph/traces` (TracesPanel — LIVE, EG-163).
- Logs: `POST /api/graph/logs` (LogsPanel — placeholder/read-only until wired).
- Usage/cost (all under `/api/observability`): `/summary`, `/by-model`,
  `/by-project`, `/by-agent`, `/analytics/tools`, `/analytics/activity`,
  `/analytics/session-shape`, `/top-sessions`, `/sessions`, `/sessions/{id}`,
  `/search?q=`, `/traces` (`getUsageSummary` / `getUsageByModel` / … /
  `getUsageSessionDetail` / `getUsageTraces`), most accepting `UsageFilters`
  (from/to/project/agent/model/origin/tenant_id/limit) as query params.

## How an agent drives it
Navigate to `/dashboards` and add panels, or query directly:
`POST /api/graph/promql {query, range}` for a metric series,
`POST /api/graph/traces {…}` for recent traces, and the `/api/observability/*`
family for cost analytics (e.g. `GET /api/observability/by-model?from=…`). For
raw PromQL/trace verbs headlessly, prefer the `kg-promql` / `kg-traces` skills;
use this surface to compose and present the panels.
