# GraphOS browser shell and app surfaces

**ID:** WEBUI-APPS-001
**Owner:** agent-webui
**Program IDs:** EH-424, EH-425, EH-429; EH-420 is the first app consumer
**Delivery:** specified; publication and consumer cutover unverified
**Acceptance:** open

## User outcomes

The browser presents one GraphOS product identity and a first-class Apps section. A contributor can add a native or approved package-contributed app using one typed `AppSurface` contract; navigation, capability filtering, WebMCP exposure, service client and optional Atlas renderer bind to the existing shell without app-specific rewiring. Markets is the first consumer, with its behavior defined by the local Finance spec. This spec owns the reusable shell, app contract and product-name migration, not finance calculations.

## Requirements

| ID | Behavior | Program ID | Evidence |
|---|---|---|---|
| APP-01 | Titles, metadata, webmanifest, assets, theme, UI copy and published Pages identity consistently say GraphOS | EH-424 | Asset regeneration + rendered snapshot + Pages build |
| APP-02 | Package/import, npm metadata, release image, WebMCP IDs, skills, browser storage/consent and environment variable names use the new public identity consistently | EH-425 | Build, wheel, image and compatibility tests |
| APP-03 | `apps` is one section in `nav-registry.ts`; each app declares route, capability, typed client, WebMCP page and optional Atlas renderer in one `AppSurface` | EH-429 | Contract and route-census tests |
| APP-04 | Native and validated package-contributed apps resolve to the same shape; untrusted descriptors cannot register executable code, arbitrary URLs or extra privileges | EH-429 | Invalid descriptor and denied capability tests |
| APP-05 | Markets consumes the contract without duplicating scanner/chart or gateway wiring in the shell | EH-420, EH-429 | First-consumer integration test |
| APP-06 | Legacy browser state and controlled grants expire or migrate safely, with explicit renewed consent; inaccessible old links lead to the canonical destination where feasible | EH-425 | Migration/browser test |
| APP-07 | App navigation works with keyboard, touch, reduced motion and mobile/desktop layouts and has loading, unavailable and denied states | EH-429 | E2E accessibility suite |

The repo may be renamed only after its package consumers and published links are coordinated. A UI copy change alone does not satisfy APP-02. Public examples and setup instructions must use portable addresses and credentials supplied by a contributor, never a private service or inventory. The shell must not receive a service bearer in JavaScript.

## Completion

BUILT requires merged source, generated assets and package metadata with consumers updated. ACCEPTED requires installed wheel and Pages build, clean browser migration/capability tests, one native app and one rejected contributed descriptor, and exact GitHub commit/CI evidence in `tasks.md`. Consumer release and public repository rename remain explicit external acceptance receipts.
