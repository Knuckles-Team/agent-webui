---
name: kg-webui-ontology-operator
skill_type: skill
description: >-
  The agent-webui ontology operator surface — Object Explorer and Object View for
  browsing, filtering, editing and acting on ontology objects, types, interfaces,
  functions and actions. Use when you want to edit ontology object types/links in
  the UI, run a governed bulk action over an object set, or inspect an object's
  properties, derived values, links and edit history.
license: MIT
tags: [graph-os, webui, ontology, object-set, actions, operator]
tier: surface
metadata:
  author: Genius
  version: '0.1.0'
---

# kg-webui-ontology-operator (surface)

Documents the Palantir-style ontology operator UI: browse object types &
interfaces, resolve object sets (search / search-around / pivot / aggregate),
open a single object to edit properties and links, invoke functions, compute
derived properties, and run governed bulk actions.

## UI routes (agent-webui/src/App.tsx)
- `/explorer` — `ObjectExplorerView` (object-set builder, filters, saved sets,
  bulk-action menu, aggregate/pivot).
- `/object/{id}` — `ObjectView` (properties, derived values, links, markings,
  edit history/timeline, per-type layout).

## Backing endpoints (from src/lib/api.ts, all under /api/enhanced/ontology/)
- Registry: `GET /object-types`, `GET /property-types`, `GET /interfaces`,
  `GET /interfaces/{name}/implementers` (`listObjectTypes` / `listPropertyTypes`
  / `listInterfaces` / `getInterfaceImplementers`).
- Object set: `POST /object-set/search`, `.../search-around`, `.../pivot`,
  `.../aggregate`, `.../save`, `GET /object-set/list`, `POST /object-set/action`
  (`ontologySearch` / `SearchAround` / `Pivot` / `Aggregate` / `SaveObjectSet` /
  `listSavedObjectSets` / `ontologyObjectSetAction`).
- Actions catalog: `GET /actions[?object_type=]` (`listOntologyActions`).
- Single object: `GET /object/{id}[?layout=]`, `POST /object/{id}/edit`,
  `POST /object/{id}/revert` (`getOntologyObject` / `editOntologyObject` /
  `revertOntologyEdit`).
- Function / derive / document: `POST /function/invoke`, `POST /derive`,
  `POST /document/process`, `GET|POST /object-view/{type}`.

## How an agent drives it
Navigate to `/explorer`, or call the endpoints directly: resolve a set with
`POST /object-set/search {query,kind,filters}`, then either open
`/object/{id}` or run `POST /object-set/action {ids,action_name,params,approve}`.
Edits go through `POST /object/{id}/edit {edit_type,property|link_type,value|target}`
and are reversible via `.../revert`. Only genuinely registered, executor-routed
actions are offered (via `GET /actions`). Headless ontology work should prefer
the `kg-ontology` verb skill; use this surface for interactive operator sessions.
