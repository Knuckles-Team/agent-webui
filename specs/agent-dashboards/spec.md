# OVERSTORY-DASH — Overstory Studio

**Owner:** `overstory`. Every requirement ID is defined in [requirements.md](requirements.md). The generator records state in [status.json](status.json).

Component: Overstory Studio
Depends-on: [OVERSTORY-APPS](../arbora-app-surface/spec.md), [OVERSTORY-API](../arbora-api-consumer/spec.md)
References: [ARBORA-OPS-R861](https://github.com/Knuckles-Team/arbora/blob/main/specs/hosted-api-operations/spec.md)
Code: ../../src/lib/dashboards/model.ts ../../src/lib/dashboards/tools.ts ../../src/components/dashboards/DashboardsView.tsx

## Outcome

A person builds business-intelligence dashboards in the browser. The chat agent builds and edits the same dashboards with the person. The agent acts through WebMCP tools that the Overstory Studio page exposes. A dashboard is a declarative, versioned document. Arbora saves it, and medulla stores it as a catalog asset.

## Why a new spec

Search: `git grep -n -i "dashboard" -- specs` finds no WebUI row for user-built dashboards. OVERSTORY-APPS owns the app shell. OVERSTORY-API owns the arbora client. FIN-UI owns the Markets chart. This spec owns the dashboard document, its panels and its tools. It extends none of them.

## Scope

- Owns the dashboard document, panel rendering, the editing UI and the WebMCP tools.
- Does not own queries or storage. Arbora serves queries and saves. EG stores. The WebUI never reaches a source directly.
- Does not own the arbora dashboard operations. Those rows live in the arbora specs.

## Requirements

| ID | Observable requirement | Related IDs |
|---|---|---|
| OVERSTORY-DASH-R001 | A dashboard is a declarative document with schema_version, id, title, revision, params and a grid of panels. Every edit raises the revision by 1. A 12-column grid bounds each panel. | — |
| OVERSTORY-DASH-R002 | A panel is a query plus one visualization. The browser renders table, line, bar and KPI panels from a row set. Each panel shows loading, empty, error and unavailable states. | — |
| OVERSTORY-DASH-R003 | The panel kinds pie, map and graph render from a row set. The map reads latitude and longitude columns. The graph reads source and target columns. | — |
| OVERSTORY-DASH-R004 | A panel query of kind uql runs through the same governed graph query route as Understory. The browser never contacts a data source directly. Unsafe query text is refused before sending. | OVERSTORY-API-R008.2 |
| OVERSTORY-DASH-R005 | Panel query kinds nl, fleet-call and eg-op run through arbora served operations. Those are eg.query.NlQuery, fleet.call and named eg.query operations. Each kind validates its arguments. | OVERSTORY-API-R008.2 |
| OVERSTORY-DASH-R006 | A user creates a dashboard, adds, edits, moves and removes panels, and renames the dashboard in the UI. Every control works with the keyboard alone. | — |
| OVERSTORY-DASH-R007 | The Overstory Studio page registers seven WebMCP tools. The tools are create, add_panel, update_panel, remove_panel, set_layout, list_data_sources and preview_query. Each tool validates input and output against a strict schema. Results stay under 1,500 bytes. | OVERSTORY-APPS-R040 |
| OVERSTORY-DASH-R008 | Each agent edit appears in an activity log tagged agent. A user undoes and redoes any edit, agent or user, with the keyboard. | — |
| OVERSTORY-DASH-R009 | An agent call that removes a panel waits for explicit user approval in the page. Denial, timeout or cancellation leaves the dashboard unchanged. | — |
| OVERSTORY-DASH-R010 | The browser saves, loads, lists, drops and shares dashboards through the arbora dashboard operations (ARBORA-OPS-R861). EG stores each dashboard as the catalog asset of MEDULLA-TYPED-PACKS-R108, with an owner. A stale revision yields a conflict, never an overwrite. | OVERSTORY-API-R001, ARBORA-OPS-R861, MEDULLA-TYPED-PACKS-R108 |
| OVERSTORY-DASH-R011 | Until R010 lands, the browser keeps dashboards in local storage. The page states that the save is local and pending. Storage failure leaves the in-memory dashboard intact and says so. | — |
| OVERSTORY-DASH-R012 | The page shows the owner and the caller's access level. An owner grants or revokes reader or editor access. A reader sees no edit controls and the edit tools refuse. | — |
| OVERSTORY-DASH-R013 | A refresh control reruns every panel query. An optional interval refreshes on a timer. Dashboard parameters substitute into queries as validated typed values, and a change reruns the affected panels. | — |
| OVERSTORY-DASH-R014 | Every panel has a text summary and a data table alternative. Series differ by more than color. Panels follow the light and dark theme tokens and respect reduced motion. | — |
| OVERSTORY-DASH-R015 | The route workspace.dashboards in the navigation registry mounts the view. The view mounts the WebMCP registrar, so the tools exist only on that page. | OVERSTORY-APPS-R040 |
| OVERSTORY-DASH-R016 | The Catalog page lets a user browse and search the EG metadata catalog through arbora. It lists connector assets, glossary terms, lineage, owners, ratings, comments, Agent Library entries, workflows, knowledge graphs and dashboards. | MEDULLA-TYPED-PACKS-R106, MEDULLA-TYPED-PACKS-R108 |

## Failure behavior

A query that fails shows its error inside its panel. The other panels keep working. A missing arbora operation shows an unavailable state, never an empty chart. The agent receives a typed refusal when a tool call is invalid, denied or cancelled.
