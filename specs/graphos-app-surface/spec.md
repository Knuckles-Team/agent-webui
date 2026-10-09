# GraphOS browser shell and app surfaces

**ID:** WEBUI-APPS-001
**Owner:** agent-webui
**Related IDs:** WEBUI-APPS-R002, WEBUI-APPS-R003, WEBUI-APPS-R001; FIN-UI-R003 is the first app consumer
**Delivery:** specified; publication and consumer cutover unverified
**Acceptance:** open

## User outcomes

The browser presents one GraphOS product identity and a first-class Apps section. A contributor can add a native or approved package-contributed app using one typed `AppSurface` contract; navigation, capability filtering, WebMCP exposure, service client and optional Atlas renderer bind to the existing shell without app-specific rewiring. Markets is the first consumer, with its behavior defined by the local Finance spec. This spec owns the reusable shell, app contract and product-name migration, not finance calculations.

## Requirements

| ID | Behavior | Related ID | Evidence |
|---|---|---|---|
| APP-01 | Titles, metadata, webmanifest, assets, theme, UI copy and published Pages identity consistently say GraphOS | WEBUI-APPS-R002 | Asset regeneration + rendered snapshot + Pages build |
| APP-02 | Package/import, npm metadata, release image, WebMCP IDs, skills, browser storage/consent and environment variable names keep the agent-webui component identity; only user-visible strings are rebranded (operator decision 2026-10-09) | WEBUI-APPS-R003 | Build and wheel tests |
| APP-03 | `apps` is one section in `nav-registry.ts`; each app declares route, capability, typed client, WebMCP page and optional Atlas renderer in one `AppSurface` | WEBUI-APPS-R001 | Contract and route-census tests |
| APP-04 | Native and validated package-contributed apps resolve to the same shape; untrusted descriptors cannot register executable code, arbitrary URLs or extra privileges | WEBUI-APPS-R001 | Invalid descriptor and denied capability tests |
| APP-05 | Markets consumes the contract without duplicating scanner/chart or gateway wiring in the shell | FIN-UI-R003, WEBUI-APPS-R001 | First-consumer integration test |
| APP-06 | Storage and consent keys are unchanged by the rebrand, so legacy browser state stays valid; any future key change expires or migrates it with explicit renewed consent | WEBUI-APPS-R003 | Browser test |
| APP-07 | App navigation works with keyboard, touch, reduced motion and mobile/desktop layouts and has loading, unavailable and denied states | WEBUI-APPS-R001 | E2E accessibility suite |

Operator decision 2026-10-09: only front-end-facing items carry the Graph OS name; the repository, package and runtime identifiers stay `agent-webui`, a Graph OS component. Public examples and setup instructions must use portable addresses and credentials supplied by a contributor, never a private service or inventory. The shell must not receive a service bearer in JavaScript.

## Completion

BUILT requires merged source, generated assets and package metadata with consumers updated. ACCEPTED requires installed wheel and Pages build, clean browser migration/capability tests, one native app and one rejected contributed descriptor, and exact GitHub commit/CI evidence in `tasks.md`. Consumer release and public repository rename remain explicit external acceptance receipts.

Requirement IDs are defined in [requirements.md](requirements.md); delivery state per ID is in `status.json`.
