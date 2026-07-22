---
name: kg-webui-admin
skill_type: skill
description: >-
  The agent-webui admin / fleet console — tenants, shards, RBAC, backup/PITR and
  the swarm supervisory plane (health, topology, pause/kill, approvals). Use when
  you want to inspect or operate the fleet from the UI, manage engine tenants or
  shards, review the mutation/risk approval queue, or check service health.
license: MIT
tags: [graph-os, webui, admin, fleet, tenants, shards, rbac, health]
tier: surface
metadata:
  author: Genius
  version: '0.1.0'
---

# kg-webui-admin (surface)

Documents the platform-operations UI: the AdminView engine console (Tenants /
Shards / RBAC / Backup-PITR tabs) and the FleetView supervisory plane over live
agent sessions and goals.

## UI routes (agent-webui/src/App.tsx)
- `/admin` — `AdminView` tabs → `TenantsPanel`, `ShardsPanel`, `RbacPanel`,
  `BackupPanel` (some panels degrade to read-only where the engine capability is
  not yet on the REST surface).
- `/fleet` — `FleetView` (swarm health, topology, emergency containment,
  approval queue).

## Backing endpoints (from src/lib/api.ts + admin panels)
- Tenants/Shards: `GET /api/dashboard/daemon/status`,
  `GET /api/dashboard/daemon/shards`, `GET /api/enhanced/graph/stats`,
  `GET /api/enhanced/code/instances` (TenantsPanel/ShardsPanel).
- RBAC & Backup/PITR: `POST /api/graph/configure` (RbacPanel / BackupPanel).
- Fleet plane: `GET /api/fleet/health` (`getFleetHealth`),
  `GET /api/fleet/topology` (`getFleetTopology`), `POST /api/fleet/pause`
  (`pauseFleet`), `POST /api/fleet/kill` (`killFleet`),
  `GET /api/fleet/approvals` (`getFleetApprovals`),
  `POST /api/fleet/approvals/grant` (`grantFleetApproval`).

## How an agent drives it
Navigate to `/admin` (pick a tab) or `/fleet`, or call the endpoints directly —
`GET /api/fleet/health` for a domain roll-up, then contain a run with
`POST /api/fleet/pause {domain|session_ids}` or `.../kill`, and clear the queue
with `POST /api/fleet/approvals/grant {job_id,decision}`. Engine-level tenancy
and consensus/resharding operations map to the `kg-modality-consensus` verb skill
(`engine_tenants` / `engine_resharding`); this surface is the human console.
