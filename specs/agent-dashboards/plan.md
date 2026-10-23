# WEBUI-DASH architecture

## Reuse inventory

- Query: `uqlAdapter` in `src/lib/atlas/adapters/uql.ts` runs panel queries. It posts to the governed graph query route.
- Tools: `makeTool` in `src/lib/webmcp/tools.ts` and `useWebMcpToolSet` in `src/lib/webmcp/provider.tsx`. The registrar follows `src/lib/webmcp/atlas.tsx`.
- Route: one entry in `src/lib/nav-registry.ts`.
- Charts: a small SVG renderer in `src/components/dashboards/ChartSvg.tsx`. The Markets renderer draws finance series only, so the dashboards renderer stays separate.

## Document

```text
Dashboard { schema_version: 1, id, title, revision, params[], panels[] }
Panel { id, title, viz: table|line|bar|kpi, query { kind: uql, text }, layout { x, y, w, h }, options }
```

The document is the catalog asset of EG-TYPED-PACKS-R108. Arbora saves it under that asset type.
The catalog page (WEBUI-DASH-R016) reads EG-TYPED-PACKS-R106 and R108 assets through the arbora catalog operations.

## Interfaces

- `model.ts` holds pure edit functions. Each returns a new document with revision + 1.
- `history.ts` holds the undo stack and the activity log. Each entry records the actor.
- `tools.ts` builds the WebMCP tools over a controller. Tool names use the `agent-webui.dashboard.` prefix.
- `store.ts` defines the store interface. The local store is the interim implementation.

## Decisions

- Agent edits run through the same reducer as user edits, so undo is uniform.
- Tool results stay small. The 1,500-byte budget forbids returning row data in full. `preview_query` returns columns, a row count and a short sample.
- Parameters substitute only as validated scalar values. Query text is never built from free text.
- The remaining rows stay SPECIFIED until the arbora dashboard operations land.

## Relation to the Status page

The `observability.live-dashboards` route at `/dashboards` shows fixed metric, log and trace panels. This spec owns graph-query dashboards at `/data-dashboards`. The two share no state.
