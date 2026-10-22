# WEBUI-APPS — Arbora browser shell and app surfaces

**ID:** WEBUI-APPS
**Owner:** agent-webui
**Related IDs:** WEBUI-APPS-R002, WEBUI-APPS-R003, WEBUI-APPS-R001; FIN-UI-R003 is the first app consumer
**Delivery:** specified; publication and consumer cutover unverified
**Acceptance:** open

## User outcomes

The browser presents one Arbora product identity and a first-class Apps section. A contributor can add a native or approved package-contributed app using one typed `AppSurface` contract. Navigation, capability filtering, WebMCP exposure, service client and optional Atlas renderer bind to the existing shell without app-specific rewiring. Markets is the first consumer, with its behavior defined by the local Finance spec. This spec owns the reusable shell, app contract and product-name migration, not finance calculations.

## Requirements

| ID | Behavior | Related ID | Evidence |
|---|---|---|---|
| WEBUI-APPS-R038 | Titles, metadata, webmanifest, assets, theme, UI copy and published Pages identity consistently say Arbora | WEBUI-APPS-R002 | Asset regeneration + rendered snapshot + Pages build |
| WEBUI-APPS-R039 | Package/import, npm metadata, release image, WebMCP IDs, skills, browser storage/consent and environment variable names keep the agent-webui component identity; only user-visible strings are rebranded (operator decision 2026-10-09) | WEBUI-APPS-R003 | Build and wheel tests |
| WEBUI-APPS-R040 | `apps` is one section in `nav-registry.ts`. Each app declares route, capability, typed client, WebMCP page and optional Atlas renderer in one `AppSurface` | WEBUI-APPS-R001 | Contract and route-census tests |
| WEBUI-APPS-R041 | Native and validated package-contributed apps resolve to the same shape. Untrusted descriptors cannot register executable code, arbitrary URLs or extra privileges | WEBUI-APPS-R001 | Invalid descriptor and denied capability tests |
| WEBUI-APPS-R042 | Markets consumes the contract without duplicating scanner/chart or gateway wiring in the shell | FIN-UI-R003, WEBUI-APPS-R001 | First-consumer integration test |
| WEBUI-APPS-R043 | Storage and consent keys are unchanged by the rebrand, so legacy browser state stays valid. Any future key change expires or migrates it with explicit renewed consent | WEBUI-APPS-R003 | Browser test |
| WEBUI-APPS-R044 | App navigation works with keyboard, touch, reduced motion and mobile/desktop layouts and has loading, unavailable and denied states | WEBUI-APPS-R001 | E2E accessibility suite |

Operator decision 2026-10-09: only front-end-facing items carry the Arbora name; the repository, package and runtime identifiers stay `agent-webui`, an Arbora component. Public examples and setup instructions must use portable addresses and credentials supplied by a contributor, never a private service or inventory. The shell must not receive a service bearer in JavaScript.

## Completion

BUILT requires merged source, generated assets and package metadata with consumers updated. ACCEPTED requires installed wheel and Pages build, clean browser migration/capability tests, one native app and one rejected contributed descriptor, and exact GitHub commit/CI evidence in `tasks.md`. Consumer release and public repository rename remain explicit external acceptance receipts.

Requirement IDs are defined in [requirements.md](requirements.md); delivery state per ID is in `status.json`.

<!-- spec-definition-patch:consumer-definitions-20261012 -->
## Additional consumer scope

The existing app, run, session and graph rollups also own the browser consumers listed in plan.md.
They cover evolution evidence, unified sessions, indexed usage, live graph convergence and the additional app interactions.
The app interactions include retrieval comparison, bounded charts, column bindings, editor compatibility, meetings, bookmarks and generated artifacts.
EG retains semantic and policy authority. Arbora retains authenticated serving and host effects. SDK and AU retain their respective transports and execution.
All new requirements remain SPECIFIED until their real served acceptance passes. No implementation or runtime receipt is recorded by this definition batch.
<!-- /spec-definition-patch -->

Definition closure remains open for all twelve source inputs.
Missing specialized producer bindings, quantitative limits and complete harness-manifest coverage are definition prerequisites as well as runtime dependencies.
See the open definition prerequisites in plan.md. All new rows remain SPECIFIED.
