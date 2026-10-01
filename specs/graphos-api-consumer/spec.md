# Generated Graph OS API consumer cutover

**ID:** WEBUI-API-001
**Owner:** agent-webui
**Related IDs:** AU-BOUNDARY-R039, WEBUI-API-R001, WEBUI-API-R002, WEBUI-API-R003
**Delivery:** specified; current adapter inventory requires verification
**Acceptance:** open

Every requirement ID in this spec is defined in [requirements.md](requirements.md); its current delivery and acceptance state, with evidence, is recorded in [status.json](status.json).

## Purpose

All domain and administrative actions in the browser use one typed, versioned Graph OS API client. The WebUI host keeps only browser protocol, session, safe asset, consent and narrowly necessary UI-local endpoints. It must stop owning a second graph/ontology/agent/finance domain API or calling Agent Utilities internals. The Graph OS operation registry owns authorization and behavior. This spec is the WebUI cutover and consumer test contract; it does not implement the Graph OS registry.

## Requirements

| ID | WebUI obligation | Related IDs | Proof |
|---|---|---|---|
| APIUI-01 | Generate TypeScript types and client from a pinned Graph OS `/api/v1` schema/digest, with one `invoke` adapter and stable error envelope | WEBUI-API-R001 | Regeneration-diff and contract tests |
| APIUI-02 | Migrate decisions, Markets/apps, WebMCP and console confirmation to typed operations, preserving preview/confirm/step-up for effects | WEBUI-API-R001 | Positive/negative effect tests |
| APIUI-03 | Migrate ontology, graph, Atlas and object-set reads/writes without losing tenant, purpose, paging or error semantics | WEBUI-API-R002 | Cross-surface fixtures and browser tests |
| APIUI-04 | Migrate prompts, SDD, knowledge base, sessions, goals, MCP servers/tools and model management operations | WEBUI-API-R003 | Route-census and contract tests |
| APIUI-05 | Remove direct AU-internal imports and domain handlers from the WebUI host once replacement operations are proven; preserve browser-local endpoints by explicit inventory | AU-BOUNDARY-R039, WEBUI-API-R001, WEBUI-API-R002, WEBUI-API-R003 | Static dependency and route-census gate |
| APIUI-06 | Preserve shared auth, credential delegation, streaming/cancel and error handling; never expose a Graph OS service bearer to JavaScript | all | Host integration and adversarial browser tests |

User stories: a tenant reader can browse graph and Atlas results without changing identity; an operator can preview and confirm an effect with its exact plan reference; a contributor can regenerate the client from a public schema and see CI fail if a required operation disappears. Unsupported operations present a typed unavailable state rather than silently falling back to a legacy direct route.

Out of scope: creating new graph, ontology, finance or agent algorithms, or exposing every Graph OS administrative operation in UI navigation. Generated API coverage is still required for operations the WebUI consumes.

## Completion

BUILT requires a merged cutover with zero forbidden imports and zero remaining domain route families in the host inventory. ACCEPTED requires exact-registry digest parity, denial/error/effect tests, generated-client reproducibility and browser proof against a provisioned Graph OS fixture. Each route family may be accepted separately, but the spec is accepted only when all four related requirements — see [requirements.md](requirements.md) — are met and recorded in `tasks.md`.

## Delivery slices and dependency decisions

WEBUI-API-R001 owns the generated `src/lib/graphos-api/` client, its `invoke` seam, decision and Markets/app callers, WebMCP page tools, and a console confirmation page. The browser sends a typed operation and input to the same-origin session host. The host binds the authenticated caller; the browser never supplies a service token. A write or destructive operation first returns a server-issued preview and `plan_ref`, and the confirmation page sends that exact reference only after the required human action and step-up. A stale reference, changed principal, altered parameters, missing MFA or denial must fail closed. The host's app domain routes retire only after equivalent Graph OS operations and fixtures exist.

WEBUI-API-R002 owns migration of ontology, graph, Atlas and object-set callers, including the matching blocks in `agent/agent_webui/api_extensions.py`. The graph/database service remains the durable authority. Preserve source IDs, cursor pagination, tenant and purpose context, typed validation, and partial/unavailable states. Replace each domain block only after the generated operation has positive and cross-tenant denial coverage; no direct database access moves into React.

WEBUI-API-R003 owns prompts, SDD, knowledge base, sessions, goals, MCP servers and tools, and LLM/model administration. Inventory every corresponding host route and browser caller before deletion. A checked-in route census must list each old method/path, owning operation ID, caller, scope, effect class, migration state and disposition; UI-local browser routes need an explicit owner and reason. An architecture lint must reject any new unclassified domain route or direct browser domain endpoint, while permitting enumerated session, asset, protocol and UI-local handlers. A missing Graph OS operation blocks that family's cutover; the UI shows unavailable instead of using a hidden fallback.

The migration order is WEBUI-API-R001 client/host seam, WEBUI-API-R002 graph families, then WEBUI-API-R003 remaining families. Each slice can merge independently with its own fixture tests, but the status manifest remains `SPECIFIED` until an exact merged revision and evidence for the applicable slice is recorded. No historical source checkpoint alone establishes current-main delivery.
