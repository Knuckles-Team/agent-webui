# Generated Graph OS API consumer cutover

**ID:** WEBUI-API-001
**Owner:** agent-webui
**Program IDs:** EH-515, EH-618, EH-619, EH-620
**Delivery:** specified; current adapter inventory requires verification
**Acceptance:** open

## Purpose

All domain and administrative actions in the browser use one typed, versioned Graph OS API client. The WebUI host keeps only browser protocol, session, safe asset, consent and narrowly necessary UI-local endpoints. It must stop owning a second graph/ontology/agent/finance domain API or calling Agent Utilities internals. The Graph OS operation registry owns authorization and behavior. This spec is the WebUI cutover and consumer test contract; it does not implement the Graph OS registry.

## Requirements

| ID | WebUI obligation | Program IDs | Proof |
|---|---|---|---|
| APIUI-01 | Generate TypeScript types and client from a pinned Graph OS `/api/v1` schema/digest, with one `invoke` adapter and stable error envelope | EH-618 | Regeneration-diff and contract tests |
| APIUI-02 | Migrate decisions, Markets/apps, WebMCP and console confirmation to typed operations, preserving preview/confirm/step-up for effects | EH-618 | Positive/negative effect tests |
| APIUI-03 | Migrate ontology, graph, Atlas and object-set reads/writes without losing tenant, purpose, paging or error semantics | EH-619 | Cross-surface fixtures and browser tests |
| APIUI-04 | Migrate prompts, SDD, knowledge base, sessions, goals, MCP servers/tools and model management operations | EH-620 | Route-census and contract tests |
| APIUI-05 | Remove direct AU-internal imports and domain handlers from the WebUI host once replacement operations are proven; preserve browser-local endpoints by explicit inventory | EH-515, EH-618–620 | Static dependency and route-census gate |
| APIUI-06 | Preserve shared auth, credential delegation, streaming/cancel and error handling; never expose a Graph OS service bearer to JavaScript | all | Host integration and adversarial browser tests |

User stories: a tenant reader can browse graph and Atlas results without changing identity; an operator can preview and confirm an effect with its exact plan reference; a contributor can regenerate the client from a public schema and see CI fail if a required operation disappears. Unsupported operations present a typed unavailable state rather than silently falling back to a legacy direct route.

Out of scope: creating new graph, ontology, finance or agent algorithms, or exposing every Graph OS administrative operation in UI navigation. Generated API coverage is still required for operations the WebUI consumes.

## Completion

BUILT requires a merged cutover with zero forbidden imports and zero remaining domain route families in the host inventory. ACCEPTED requires exact-registry digest parity, denial/error/effect tests, generated-client reproducibility and browser proof against a provisioned Graph OS fixture. Each route family may be accepted separately, but the spec is accepted only when all four program ID obligations are met and recorded in `tasks.md`.
