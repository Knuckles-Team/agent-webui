---
name: kg-webui-graphviz
skill_type: skill
description: >-
  The agent-webui graph-visualization surface — GraphView, TemporalGraphView,
  CodeGraphView and the single-vertex explorer. Use when you want to visualize
  the Knowledge Graph, render a vertex neighborhood, browse temporal/as-of graph
  state, or draw the code call-graph in the web UI.
license: MIT
tags: [graph-os, webui, visualization, graph, vertex, code-graph]
tier: surface
metadata:
  author: Genius
  version: '0.1.0'
---

# kg-webui-graphviz (surface)

Documents the graph-visualization area of agent-webui. These are the visual,
interactive twins of the KG read verbs — they render nodes/edges, vertex
neighborhoods, temporal snapshots and code-graph analytics on a canvas.

## UI routes (agent-webui/src/App.tsx)
- `/graph` — `GraphView` (whole-graph node/edge canvas + Cypher-backed panels).
- `/temporal-graph` — `TemporalGraphView` (bi-temporal / as-of graph state).
- `/code-graph` — `CodeGraphView` (Graphify-style god nodes, communities, bridges).
- `/vertex` — `VertexView` (expand one object's neighborhood by typed link).

## Backing endpoints (from src/lib/api.ts)
- `GET /api/enhanced/graph/stats` — node/edge counts + `by_type` (`getGraphStats`).
- `GET /api/enhanced/graph/nodes[?node_type=]` — node list (`getGraphNodes`).
- `GET /api/enhanced/graph/relationships` — edge list (`getGraphRelationships`).
- `POST /api/enhanced/graph/query` — Cypher-backed graph fetch (GraphView).
- `POST /api/enhanced/graph/magma` — dense/magma layout payload (GraphView).
- `POST /api/enhanced/ontology/object-set/search` and `.../search-around` and
  `.../aggregate` — drive the VertexView neighborhood expansion / faceting
  (`ontologySearch` / `ontologySearchAround` / `ontologyAggregate`).
- `POST /api/graph/analyze {action:'code_metrics', target, top_k}` — code-graph
  analytics + render payload (`getCodeMetrics`), backs CodeGraphView.

## How an agent drives it
Navigate the browser to the route (e.g. `/vertex` then supply an object id), or
call the endpoint directly for the data behind the canvas — e.g.
`GET /api/enhanced/graph/stats` for the summary, then
`POST /api/enhanced/ontology/object-set/search-around {ids,link_type,hops,direction}`
to expand a neighborhood. For headless graph reads prefer the `kg-query` /
`kg-search` verb skills; use this surface when a human needs the rendered view.
