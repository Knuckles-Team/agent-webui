# WebMCP and Graph OS production readiness

**Feature ID:** `webmcp-production-readiness`
**Status:** `PLANNED`
**Baseline:** repository `e421a70` (2026-09-14)
**Owner:** agent-webui presentation and control-plane maintainers

## Overview

agent-webui has two related but different control surfaces:

1. **Browser-local WebMCP.** `document.modelContext.registerTool()` exposes a
   small, typed set of controls for the open document. The current surface can
   read page context, navigate through the role-aware route registry, and edit
   local Atlas filters or selection. It intentionally does not execute a query,
   call a backend tool, expose credentials, or provide a generic request
   primitive.
2. **Governed remote MCP.** Graph OS and its MCP gateway execute fleet and
   knowledge-graph work on behalf of an authenticated actor. The browser reaches
   that service through same-origin WebUI backend routes; it must never receive a
   service bearer or open a direct browser-to-Graph-OS MCP connection.

This specification completes the missing seam between those surfaces without
collapsing them into one authority. A remote caller may request a browser-local
tool only through a short-lived, user-bound capability lease. The WebUI and
Graph OS verify the lease, current identity, tenant, route, role, tool allowlist,
nonce, expiry, cancellation, and audit context on every call. The browser then
executes only the exact local tool named by the lease and returns a bounded,
validated result. No access token, service credential, OpenBao value, raw HTTP
client, SQL, Cypher, SPARQL, or arbitrary JavaScript crosses the browser-tool
boundary.

The same delivery also makes the web surface production-ready. Route metadata,
public/legal layout, consent and analytics loading, loading/error primitives,
and image handling are each defined once and reused. The twenty web requirements
below are independently testable and are intentionally tracked as requirements,
not as a checklist of duplicated page-by-page fixes.

## Current evidence and honest status

The evidence below is repository evidence from the baseline commit. It does not
claim that the live Graph OS deployment, origin trial, DNS, analytics property,
legal identity, or production ingress has been verified.

| Area | Evidence at baseline | Status |
| --- | --- | --- |
| Browser-local WebMCP | `src/lib/webmcp/adapter.ts`, `provider.tsx`, `tools.ts`, and `validation.ts` feature-detect `document.modelContext`, use Zod contracts, cap output at 1,500 characters, and retire registrations with `AbortSignal`. | **Present, bounded** |
| Active registration generation | `WebMcpProvider` derives a registration key from identity and page context and re-registers the active set as those values change. No server-verified generation is currently carried into a Graph OS lease or call. | **Partial; bridge binding missing** |
| Atlas browser controls | `src/lib/webmcp/atlas.tsx` exposes local state/filter/selection controls; the tool descriptions state that they do not execute queries or write backend data. | **Present, local only** |
| Governed MCP BFF | `src/lib/mcp-client.ts` uses same-origin `/api/enhanced/mcp/*` routes and documents that service credentials stay server-side. | **Present, separate seam** |
| Graph OS to browser bridge | `src/lib/webmcp/README.md` explicitly calls this a future bridge and requires a user-bound, short-lived lease. No lease/call/cancel protocol is implemented in this repository. | **Missing** |
| Route metadata | `src/lib/nav-registry.ts` is the route source of truth and includes path, label, blurb, role, and mobile disposition. `index.html` has one static title and no route-level description or Open Graph metadata. | **Partial** |
| Loading and error primitives | `App.tsx` has `RouteLoadingFallback`; the repository has `ErrorBoundary`, `Skeleton`, `UnavailableNotice`, and form `aria-invalid` primitives, but usage and error semantics are not a verified every-route contract. | **Partial** |
| Favicon assets | `public/favicon.ico`, `favicon.png`, `favicon.svg`, and `apple-touch-icon.png` exist; `index.html` currently links only the PNG favicon and Apple icon. | **Partial** |
| Mobile layout | The shell has a mobile header and route metadata has `mobile` dispositions; a complete viewport matrix and sticky mobile CTA contract do not exist. | **Partial** |
| Images | Image elements exist in AI, graph, chat, dashboard, and demo components. A repository-wide alt/compression policy and gate are not established. | **Unknown / open** |
| Public web/legal surface | No verified route or content contract for custom 404, thank-you, privacy, terms, contact address, robots, sitemap, cookie consent, or analytics was found in the baseline. | **Missing or unverified** |

## Current working-tree evidence (partial)

The implementation lane has produced narrow, reproducible receipts in the
current working tree, but they do not replace the baseline inventory above or
close any release requirement. `pnpm run site:assets:test` passed the
route-authority asset tests; `pnpm run site:assets:check` passed in safe
noindex mode; and `pnpm run site:image-alt:check` passed after scanning 167 TSX
source files. A targeted Vitest run covering `PageHead`, page metadata, public
and mobile surfaces, consent/analytics, responsive behavior, the site
configuration gate, and image behavior passed 8 files and 30 tests.

The site configuration gate was also run deliberately without production/legal
configuration. `pnpm run site:config:check` failed closed with seven issues:
the site origin, legal owner, contact address, effective date, legal revision,
privacy text, and terms text were missing or invalid. Therefore `T010`, the
owner-supplied legal/contact receipt, and all deployment receipts remain open.
The targeted receipts do not prove the Graph OS bridge or its adversarial
requirements: server-verified registration generations and identity/session/
tenant/principal binding, attended opt-in, Graph OS-owned fences/call state,
durable audit before dispatch, one `BrowserControlService`, honest cancellation
effects, truthful Langfuse status, or trust-prerequisite deployment gates. Real
owner-supplied legal/contact values, the contact receipt producer, the
configured analytics destination, anonymous SSO policy, the general form-error
sweep, and confirmed contact/form submission receipt also remain explicitly
open.

The seven audit items below normalize the audited wiring gaps into stable IDs
for this SDD. If the parent program has an earlier external ID for one of these
findings, that ID must be retained as an alias when implementation work is
started; the normalized IDs do not erase prior audit history.

## Audited MCP wiring defects

| ID | Defect and evidence | Required disposition | Baseline |
| --- | --- | --- | --- |
| `WMCP-AUD-001` | The browser-local WebMCP registrar and the governed Graph OS MCP catalog are separate providers (`src/lib/webmcp/provider.tsx` and `src/lib/mcp-context.tsx`) with no shared capability descriptor or explicit protocol/authority label. | Publish one versioned capability descriptor that identifies `browser-local` versus `graph-os-remote`, while retaining separate execution authorities. | **Open** |
| `WMCP-AUD-002` | Route metadata is sufficient for navigation but not for page head metadata, CTA intent, indexability, or WebMCP page capability context. `index.html` contains the only static title. | Extend the route registry metadata once and derive navigation, page context, head tags, CTA policy, mobile disposition, and WebMCP page identity from it. | **Open** |
| `WMCP-AUD-003` | `src/lib/webmcp/README.md` says the Graph OS to browser bridge is intentionally out of scope. There is no lease issue, renew, revoke, or browser-channel handshake. | Add a server-mediated lease lifecycle bound to the authenticated user/session, tenant, origin, route, and allowlisted tool versions. | **Open** |
| `WMCP-AUD-004` | Current local callbacks validate their input/output and cancellation, but they do not produce a shared Graph OS provenance envelope or Langfuse/RunTrace correlation. | Record an immutable call receipt containing actor, route, lease, tool digest, authorization decision, timing, result/error digest, and trace IDs. | **Open** |
| `WMCP-AUD-005` | Local `AbortSignal` retirement is implemented, but there is no remote cancellation, expiry, replay, disconnect, or late-result contract. | Make cancel, expiry, disconnect, and timeout idempotent across the browser, WebUI, gateway, and Graph OS; prevent new uncorrelated dispatch, report the honest effect state, and reconcile committed or unknown effects without unconditional late-effect rejection. | **Open** |
| `WMCP-AUD-006` | Existing `/api/enhanced/mcp/tools/call` is a governed BFF call, but WebMCP has no explicit mapping to the canonical Graph OS control operation and no mutation confirmation rule. | Reuse one canonical control operation and policy decision for REST, MCP, and WebMCP projections; require explicit confirmation for mutating browser actions. | **Open** |
| `WMCP-AUD-007` | WebMCP depends on secure context, Permissions Policy, origin-trial/browser support, and the deployed WebUI/Graph OS topology. No release gate proves those conditions end to end. | Add static, browser, integration, and deployed-topology receipts. Unsupported WebMCP must remain an honest no-op; supported remote control must fail closed when identity, lease, policy, or telemetry is absent. | **Open** |

## Adversarial bridge review requirements

The following requirements incorporate the completed adversarial bridge review.
They are separate from the seven normalized wiring defects so a review finding
cannot be lost when one defect is later marked closed. All are open until an
implementation receipt proves them.

- **ADV-001 — Active registration generation:** WebMCP registration is dynamic.
  Each active document/tool set MUST have a server-verifiable
  `registration_generation` (or equivalent monotonic generation) bound to the
  document, route, identity, and tool/schema digest. A lease or call for an old
  generation MUST be refused after the active registration changes. A provider
  `registrationKey` or browser-supplied string alone is not server proof.
- **ADV-002 — Graph OS owns bridge authority:** Graph OS MUST be the sole
  authority for authorization, leases, replay/fence state, call state, durable
  audit receipts, and terminal outcomes. WebUI transports and presents these
  records; it MUST NOT create a shadow lease, replay ledger, or authoritative
  call state.
- **ADV-003 — Server-verified binding:** Before lease issue and on every call,
  Graph OS MUST verify the live login session, tenant, principal, verified
  origin, document/session binding, current route, and active registration
  generation from server-side state. Values supplied by the browser are claims
  to compare, not authority to trust.
- **ADV-004 — Attended opt-in:** A remote browser bridge MUST remain disabled
  until the user explicitly arms it through an attended, visible UI gesture for
  the current session. The UI MUST show the active lease/tool scope and provide
  revoke. Background, unattended, hidden-tab, stale-session, and silently
  renewed control MUST be refused or revoked according to the lease policy.
- **ADV-005 — At-most-once fence:** Graph OS MUST assign a durable call fence /
  idempotency key and persist its state before dispatch. Retries, reconnects, and
  duplicate MCP/REST/workflow deliveries MUST observe the same call state and
  MUST NOT dispatch a browser side effect more than once. The protocol MUST NOT
  claim exactly-once completion across a network failure.
- **ADV-006 — No service credential as user delegation:** A service credential
  may authenticate the WebUI or Graph OS service to another service, but MUST
  never be treated as proof that the human user delegated browser control. User
  delegation requires the verified login session, principal, tenant, document,
  route, generation, attended opt-in, policy, and lease checks.
- **ADV-007 — Honest cancellation outcomes:** Cancellation is best effort and
  MUST expose one terminal effect state: `none` (no browser commit is known),
  `browser_reported_committed` (the browser durably acknowledged the effect
  before cancellation), or `unknown` (the race cannot prove either outcome).
  The bridge MUST NOT claim rollback or unconditional late-effect rejection;
  already committed effects may remain and `unknown` requires reconciliation.
- **ADV-008 — One BrowserControlService:** Graph OS MUST implement one
  `BrowserControlService` for authorization, lease/call dispatch, confirmation,
  cancellation, fences, and receipts. Graph OS MCP, REST, and workflow adapters
  MUST call this service rather than implementing protocol-specific browser
  control forks.
- **ADV-009 — Durable audit before dispatch:** Graph OS MUST durably persist the
  actor, lease, policy decision, call fence, requested tool, generation, and
  pending call receipt before sending a browser command. If that audit write
  fails, no browser command may be dispatched.
- **ADV-010 — Truthful Langfuse status:** Every receipt MUST report a truthful
  `langfuse_status` such as `recorded`, `not_configured`, or `unavailable`.
  Missing or failed Langfuse delivery MUST never be represented by a fabricated
  trace ID or a `recorded` status. The receipt remains useful through its Graph
  OS RunTrace and explicit telemetry status.
- **ADV-011 — Trust-prerequisite gate:** The remote bridge MUST be disabled
  unless all trust prerequisites are present: secure context and Permissions
  Policy, same-origin authenticated channel, server-verified live login session,
  tenant/principal, document/route/generation binding, attended opt-in, healthy
  Graph OS lease authority, valid capability/policy digest, and durable audit
  path. Browser-local WebMCP may remain an independent optional no-op, but it
  MUST NOT be upgraded into remote control when these prerequisites are absent.

## User stories

- As an authenticated operator, I want browser-local WebMCP controls to be
  discoverable only in the open page and current role, so that an agent can
  operate the UI without receiving backend authority.
- As an authenticated operator, I want Graph OS to control an explicitly leased
  browser session, so that every remote action is user-bound, expiring,
  cancellable, and attributable.
- As a Graph OS operator, I want WebUI, MCP, and REST control calls to share one
  policy and provenance envelope, so that a UI path cannot bypass authorization
  or create an untraceable execution.
- As a visitor or signed-in user, I want every public and application route to
  have honest metadata, accessible responsive states, and truthful success or
  failure screens, so that the product is usable and safe in production.
- As a product owner, I want legal, contact, consent, analytics, and image
  policies centralized, so that pages do not drift or silently collect data.

## Architecture and deduplication rules

### Route registry metadata is the single page authority

Every route, including 404, thank-you, privacy, and terms, MUST be represented
by one route-registry entry or one explicitly declared non-application public
route descriptor. The metadata model MUST contain, as applicable:

- stable route ID and path pattern;
- human title and meta description templates;
- canonical/indexability policy and public/private classification;
- minimum role and mobile disposition;
- above-the-fold CTA policy and safe target;
- WebMCP page capability identity and local-tool allowlist;
- loading/error boundary choice; and
- documentation, legal version, or effective-date references where relevant.

The sidebar, route guard, document title/description, sitemap, robots policy,
CTA, page-context envelope, and WebMCP navigation MUST consume this authority.
No page may hand-write a second route table or duplicate a metadata constant.
Private authenticated application routes MUST be `noindex` and MUST NOT enter
the public sitemap.

### Shared public and legal layout

One accessible `PublicPageLayout` MUST render the public shell, heading hierarchy,
metadata, contact link, footer, and legal links. Privacy, terms, thank-you, 404,
and any public landing/CTA page reuse it. Application pages may use the existing
control-plane shell but must use the same head metadata and shared CTA policy.
Legal copy, legal owner, contact address, effective date, and revision ID come
from a reviewed configuration/content source. The implementation MUST refuse a
placeholder or missing real contact address; this specification does not invent
one.

### Shared consent and analytics loader

One consent-aware loader MUST own nonessential analytics. It MUST:

- default to no nonessential tracking until valid consent is recorded;
- version the consent notice and record the choice and timestamp without
  collecting unnecessary identity data;
- provide an accessible banner and settings/revoke path;
- avoid analytics calls on private content, tool arguments, prompts, graph data,
  credentials, tokens, or raw URLs containing sensitive values;
- distinguish product analytics from Langfuse/RunTrace server observability; and
- emit a truthful disabled/unavailable state when analytics is not configured.

Strictly necessary authentication/session cookies remain governed by the existing
security policy and are not silently presented as optional analytics consent.

### Existing loading/error primitives

New pages and control flows MUST compose the existing route fallback, `ErrorBoundary`,
`Skeleton`, `UnavailableNotice`, `SessionExpiredNotice`, and form validation
primitives where their semantics fit. A new visual primitive is justified only
when the existing contract cannot express the state. Every asynchronous boundary
must distinguish loading, unavailable, empty, denied, cancelled, validation
error, and successful completion; no error may be rendered as plausible empty
data or a fake success toast.

### One image policy

All image assets and image-producing components MUST follow one policy:

- meaningful images have concise, contextual `alt` text;
- decorative images use `alt=""` and are hidden from assistive technology when
  appropriate;
- remote or user-provided images are validated and safely constrained;
- source images have a documented maximum dimension/byte budget and are served
  in a compressed, cacheable format with a fallback;
- favicon and Open Graph assets are generated/checked by the same asset policy;
  and
- a static check and browser test cover every image element, including lazy and
  error states.

## WebMCP / Graph OS bridge contract

### Authority matrix

| Surface | Authority | Allowed behavior | Explicitly forbidden |
| --- | --- | --- | --- |
| Browser-local WebMCP | Open authenticated document | Read bounded page/Atlas context; navigate to a registered role-visible route; change local Atlas filter/selection. | Backend calls, data writes, credentials, raw requests, arbitrary code, query execution. |
| Existing WebUI MCP BFF | WebUI backend + Graph OS gateway | Catalog and call governed MCP tools through `/api/enhanced/mcp/*`, with server-side policy and credentials. | Browser-held service bearer or direct browser-to-Graph-OS MCP connection. |
| Leased browser bridge | Graph OS `BrowserControlService` plus the user’s open document | Invoke only the active, leased browser-local tool set for the server-verified login session, tenant, principal, document, route, and registration generation, with attended opt-in, mutation confirmation, at-most-once fencing, and full receipt tracing. | Permanent registration, cross-user/session/generation reuse, unattended control, unbounded page control, service-credential-as-user delegation, token forwarding, policy bypass. |

### Lease

Graph OS owns the authoritative lease record, authorization decision, replay/fence
ledger, call state, durable audit, and receipt. WebUI may transport an opaque
lease reference and render its state, but it MUST NOT maintain a shadow lease,
replay ledger, or call state. The lease record binds:

- `lease_id`, lease version, issuing authority, issued-at, expiry, and revocation;
- the server-verified live login session, principal, tenant, session/device
  binding, and verified origin;
- the server-verified document identity, current route/page identity, and active
  `registration_generation`; a browser-supplied value is a comparison claim,
  not authority;
- exact tool IDs, versions, input/output schema digests, read/mutate class, and
  confirmation policy;
- authorization policy and role decision digest;
- a durable monotonic nonce/replay floor and at-most-once call fence; and
- a Graph OS `RunTrace` correlation and truthful Langfuse status.

The default lease lifetime SHOULD be no more than five minutes and the hard
maximum MUST be no more than fifteen minutes. Renewal is a new authenticated
decision, never an unbounded client-side extension. Revoke on sign-out, identity
or tenant change, page unload/lease channel loss, policy change, and explicit
operator action. A lease is available only after an attended, visible user
gesture explicitly arms the current session; the UI shows its scope and provides
revoke. Hidden, background, stale, or unattended sessions MUST NOT silently
renew or continue remote control. The browser receives no service access token.
The service credential used by Graph OS to authenticate a downstream service is
never proof of human-user delegation; user delegation is the verified session,
principal, tenant, document, route, generation, attended opt-in, policy, and
lease together.

### Call and receipt

Each remote call MUST include only a lease reference, tool ID/version,
`registration_generation`, bounded validated arguments, request nonce/call fence,
and cancellation/confirmation information. Graph OS verifies the live login
session, tenant, principal, origin, document, route, generation, lease, nonce,
policy, and attended opt-in from server-side state. A mutating operation is
denied until the required user confirmation is recorded for that exact request.

Before dispatching a browser command, Graph OS MUST durably persist the actor,
lease, generation, policy decision, call fence, requested tool, and pending call
receipt. If that write fails, no browser command is sent. `BrowserControlService`
is the one Graph OS owner of this sequence; its MCP, REST, and workflow adapters
call it rather than implementing protocol-specific browser-control forks.

The fence gives retries and duplicate MCP/REST/workflow deliveries one durable
call state and prevents more than one browser-side dispatch. This is an
at-most-once dispatch guarantee, not an exactly-once completion claim across a
network failure.

The durable receipt MUST preserve, at minimum, actor/tenant/session, origin,
document, route/page, registration generation, lease, tool/schema digest,
request nonce/call fence, authorization decision and policy digest, attended
opt-in, start/end time, cancellation/expiry state, Graph OS `RunTrace` ID,
truthful `langfuse_status` (`recorded`, `not_configured`, or `unavailable`),
bounded result or error digest, cancellation effect state, and
source/provenance references. A missing or failed Langfuse write MUST never be
represented by a fabricated trace ID or `recorded` status. Tool arguments are
redacted or hashed according to the existing privacy policy; secrets never enter
logs, analytics, browser-visible error text, or provenance payloads.

### Cancellation and failure

Abort in the browser, explicit remote cancel, lease revocation, timeout, channel
disconnect, and identity change all converge on one idempotent cancellation
operation owned by `BrowserControlService`. Cancellation is best effort and does
not assert rollback. Every terminal call MUST expose exactly one effect state:

- `none`: no browser commit is known;
- `browser_reported_committed`: the browser durably acknowledged the effect
  before cancellation; or
- `unknown`: the transport race cannot prove either outcome.

The bridge MUST NOT claim unconditional late-effect rejection: an effect already
committed before cancellation may remain. A cancelled call MUST not start a new
uncorrelated dispatch, and `unknown` requires reconciliation against the durable
receipt or Graph OS state. A bridge call MUST fail closed if the actor, lease,
login session, tenant, principal, origin, document, route, generation, nonce,
policy, attended opt-in, trust prerequisite, or required provenance context
cannot be verified. Unsupported browser WebMCP remains a typed no-op and cannot
downgrade to an ungoverned remote path.

## Functional requirements

The twenty production-web requirements are deliberately one-to-one with the
IDs below. Shared policies above satisfy them through common authorities rather
than per-page copies.

### Public routing and metadata

- **FR-001 — Custom 404 page:** Unknown routes MUST render an accessible custom
  404 page with a useful explanation, safe navigation CTA, and no fabricated
  data. The deployment contract MUST preserve a real 404 response for direct
  requests where the serving topology supports it.
- **FR-002 — Meta title on every page:** Every route, including 404, thank-you,
  privacy, and terms, MUST set a unique, deterministic `<title>` from route
  metadata. Route transitions MUST update it without a full reload.
- **FR-003 — Meta description on every page:** Every indexable/public route MUST
  set a route-specific description; private application routes MUST set a safe
  description while being `noindex`.
- **FR-004 — Above-the-fold CTA:** Every public entry/landing page MUST have one
  primary, keyboard-accessible CTA visible without scrolling. The CTA target and
  event name come from route metadata and may not imply an operation that the
  actor cannot perform.
- **FR-005 — Favicon set:** The built artifact MUST provide the required ICO,
  SVG/PNG size variants, Apple touch icon, and manifest/theme metadata from one
  branded asset source. Missing or stale links fail the asset gate.
- **FR-006 — `robots.txt`:** A static or generated environment-aware
  `robots.txt` MUST disallow private/authenticated/control-plane paths and
  advertise the canonical sitemap only in an indexable environment.
- **FR-007 — `sitemap.xml`:** A generated sitemap MUST contain only public,
  indexable, canonical routes from the route registry, with no session IDs,
  object IDs, private routes, query strings, or fragments.
- **FR-008 — Open Graph image:** Every shareable public route MUST expose valid
  Open Graph/Twitter metadata and one versioned, absolute, compressed image with
  safe `og:image:alt`. Private application routes MUST not leak graph or user
  data through social metadata.

### Accessibility and responsive behavior

- **FR-009 — Alt text on every image:** Every meaningful image MUST have
  contextual alt text; decorative images MUST use empty alt and appropriate
  presentation semantics. Tests/gates MUST cover JSX, generated images, and
  image failure states.
- **FR-010 — Mobile breakpoints:** All route entries MUST declare `full`,
  `adapted`, or `unsupported` mobile behavior. Supported/adapted routes MUST
  pass the defined viewport matrix without horizontal overflow, inaccessible
  controls, or clipped dialogs; unsupported views MUST explain the limitation
  and provide a safe alternative.
- **FR-011 — Sticky mobile CTA:** Where a public/mobile flow has a primary CTA,
  it MUST remain reachable in a safe sticky mobile treatment that respects
  keyboard focus, safe-area insets, zoom, reduced motion, and content overlap.
  The shared component MUST not be copied into each page.

### Runtime states and conversion flows

- **FR-012 — Loading states:** Every lazy route, data request, WebMCP catalog,
  lease operation, and form submission MUST expose a visible, accessible loading
  state using the shared primitives and disable duplicate submission where
  needed. Loading MUST never look like successful empty data.
- **FR-013 — Form error states:** Forms MUST validate at field and summary
  levels, expose `aria-invalid`/descriptions, preserve safe user input, render
  server and network failures honestly, and avoid echoing secrets or raw backend
  traces.
- **FR-014 — Thank-you page:** A successful contact/CTA submission MUST navigate
  to a dedicated, metadata-backed thank-you page with a bounded receipt/reference
  and next-step CTA. It MUST be reachable without PII in the URL and MUST NOT
  claim delivery when the backend did not confirm it.
- **FR-015 — Privacy policy:** A public privacy page MUST identify the data
  controller, purposes, categories, retention, processors/analytics, user
  choices, security contact, effective date, and revision. Copy requires legal
  owner review; placeholders fail release.
- **FR-016 — Terms and conditions:** A public terms page MUST contain the
  reviewed service terms, acceptable-use and agent-control boundaries,
  disclaimers, governing/contact information, effective date, and revision. It
  must share the public/legal layout and metadata policy.
- **FR-017 — Cookie banner:** Nonessential cookies/storage MUST be blocked until
  affirmative, versioned consent. The banner/settings UI MUST be accessible,
  reversible, region/configuration aware, and explicit about strictly necessary
  session cookies versus analytics/marketing categories.
- **FR-018 — Analytics installed:** Analytics MUST load through the shared
  consent-aware loader only after consent, use a configured property or report a
  truthful disabled state, and emit sanitized route/CTA events without prompts,
  tool arguments, graph contents, tokens, or personal data. Langfuse/RunTrace
  remains server-side operational tracing and is not a substitute for consent.

### Trust and assets

- **FR-019 — Real contact address:** Privacy, terms, contact/thank-you, and
  consent surfaces MUST show a verified legal/business contact address supplied
  by the owner. A missing, sample, or invented address MUST block release.
- **FR-020 — Compressed images:** Every shipped raster/bitmap and Open Graph or
  favicon asset MUST satisfy the one image policy's format, dimensions, byte
  budget, compression, cache, and fallback checks. User-uploaded images MUST be
  validated and bounded before persistence or display.

## Bridge acceptance criteria

- **BR-001:** A supported browser registers only the bounded browser-local tools;
  an unsupported, insecure, or disallowed browser exposes no synthetic fallback.
- **BR-002:** A capability catalog clearly labels browser-local, WebUI-BFF, and
  Graph OS remote authorities and includes tool/schema/version/role metadata,
  active registration generation, and mutation/confirmation class.
- **BR-003:** An authenticated user can obtain a lease only after Graph OS
  verifies the live login session, tenant, principal, origin, document, route,
  active registration generation, attended opt-in, and role policy; the lease
  expires, revokes, and cannot be used from another binding.
- **BR-004:** A leased read-only browser call reaches only the named local tool,
  returns a schema-valid bounded result, and produces one WebUI/Graph OS receipt.
- **BR-005:** A mutating browser control is denied without exact-request user
  confirmation; a denied or stale lease never reaches the underlying action.
- **BR-006:** No browser network, tool input, output, error, analytics event,
  Langfuse field, or RunTrace field contains a service bearer, Keycloak token,
  OpenBao value, or unredacted secret; a service credential is never treated as
  user delegation.
- **BR-007:** Identity change, sign-out, route or generation change, tenant
  change, lease expiry, explicit cancel, timeout, and channel disconnect all
  converge on an idempotent operation. The terminal effect is honestly one of
  `none`, `browser_reported_committed`, or `unknown`; the bridge does not claim
  rollback or unconditional late-effect rejection.
- **BR-008:** Every accepted, denied, cancelled, expired, malformed, and
  unavailable call has actor, verified login session, tenant, principal,
  document, route, generation, lease, policy, nonce/fence, timing, result/error,
  cancellation effect, Graph OS RunTrace, and truthful Langfuse status. Graph OS
  durably records the pending audit before dispatch.
- **BR-009:** WebMCP, REST, MCP, and workflow projections exercise one Graph OS
  `BrowserControlService` and authorization decision; no protocol-specific
  browser-control fork or second raw query/request surface is introduced.
- **BR-010:** Browser, integration, and deployed-topology tests cover secure
  context/Permissions Policy, origin-trial absence, CORS/host restrictions,
  direct deep links, route/generation changes, attended opt-in, mobile view,
  Graph OS restart/reconnect, replay fences, and trust-prerequisite refusal.

## Adversarial bridge review receipts

- **ADV-001 receipt:** Active registration generation changes are observed and an
  old-generation lease/call is refused by server state.
- **ADV-002 receipt:** Graph OS is the only authority for authorization, leases,
  replay/fences, call state, durable audit, receipts, and terminal outcomes;
  WebUI has no shadow authority.
- **ADV-003 receipt:** A call is refused when any server-verified login session,
  tenant, principal, origin, document, route, or generation binding differs from
  the active lease.
- **ADV-004 receipt:** Remote control cannot start without an attended explicit
  opt-in, visible scope/revoke UI, and current active session; hidden/unattended
  renewal is refused.
- **ADV-005 receipt:** Duplicate/retried MCP, REST, and workflow deliveries share
  one durable fence/call state and dispatch at most once.
- **ADV-006 receipt:** Removing or replacing a service credential does not turn it
  into a user-delegation proof; only verified user/lease context authorizes.
- **ADV-007 receipt:** Cancellation tests produce and expose `none`,
  `browser_reported_committed`, and `unknown` without claiming rollback or
  unconditional late-effect rejection.
- **ADV-008 receipt:** MCP, REST, and workflow adapters invoke one
  `BrowserControlService` implementation.
- **ADV-009 receipt:** Audit persistence is durable before browser dispatch; an
  audit failure results in no dispatch.
- **ADV-010 receipt:** Langfuse `recorded`, `not_configured`, and `unavailable`
  states are truthful and never fabricate trace IDs.
- **ADV-011 receipt:** Removing any trust prerequisite disables the remote bridge
  and does not downgrade to an ungoverned path.

## Non-functional requirements

- **NFR-001 — Security:** Fail closed at every lease, identity, role, origin,
  nonce, policy, confirmation, and secret boundary. Same-origin browser calls
  use the established session mechanism; service credentials remain server-side.
- **NFR-002 — Provenance:** A WebMCP call is a first-class Graph OS execution
  event with immutable correlation to verified login session, actor, tenant,
  principal, document, route, registration generation, capability, lease, fence,
  policy, truthful Langfuse status, and RunTrace.
- **NFR-003 — Bounded data:** Browser tool inputs, outputs, page context, logs,
  analytics, and receipts have explicit byte/item/field limits and redaction.
- **NFR-004 — Accessibility:** Public/legal pages and mobile controls meet the
  repository accessibility contract, including keyboard operation, focus order,
  labels, live-region state, contrast, reduced motion, and screen-reader text.
- **NFR-005 — No duplication:** Metadata, public/legal layout, consent/analytics,
  loading/error states, CTA treatment, image processing, and control authority
  are implemented once and consumed through typed contracts.
- **NFR-006 — Truthful degradation:** Missing Graph OS, unsupported WebMCP,
  unavailable analytics, denied consent, incomplete catalog, backend timeout,
  and expired lease are visible states with no fabricated success or empty data.
- **NFR-007 — Operability:** All bridge and public web transitions emit bounded
  diagnostics suitable for Graph OS RunTrace and truthful Langfuse status and
  support cancellation, retry, deployment health, reconciliation of `unknown`
  effects, and rollback without leaking sensitive content.

## Verification strategy

Implementation is accepted only after the following evidence is attached to the
spec/task receipt:

1. A route-registry census proves every route has metadata, one head projection,
   one CTA policy, one mobile disposition, one loading/error boundary, and one
   WebMCP page identity where applicable.
2. Static checks prove no duplicate route/CTA/legal/analytics/image policy and
   no missing alt text; asset checks prove favicon, robots, sitemap, OG, and
   compression requirements.
3. Vitest unit and component tests prove metadata transitions, 404, legal and
   thank-you states, consent gating, analytics redaction, image semantics,
   loading/error/form states, and WebMCP adapter/lease validation.
4. Playwright tests cover desktop/mobile public routes, direct deep links,
   responsive/sticky CTA behavior, consent, 404, form failure/success, and
   browser WebMCP supported/unsupported paths.
5. Backend/integration tests prove Graph OS-owned lease/call/replay state,
   active-generation binding, live login-session/tenant/principal/document/
   route checks, attended opt-in, at-most-once fences, durable audit before
   dispatch, policy/confirmation, no-token forwarding, the one
   `BrowserControlService`, truthful cancellation effect states, truthful
   Langfuse/RunTrace receipts, and Graph OS unavailable/restart behavior.
6. A deployed-topology receipt proves the actual Graph OS gateway, WebUI asset,
   identity provider, secure context, Permissions Policy, robots/sitemap
   environment, analytics consent configuration, and rollback path.

The baseline is not release-ready until all open audit rows, ADV receipts, BR
criteria, FR criteria, and the repository constitution gates are green. Spec
completion does not imply product implementation; this branch contains
requirements and machine-readable work items only.
