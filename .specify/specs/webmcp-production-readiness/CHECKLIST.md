# Verification checklist: WebMCP and Graph OS production readiness

Baseline observed 2026-09-14 at `e421a70`. A checked baseline item means the
repository fact was inspected; it does not mean the production requirement is
implemented. Implementation and release items remain unchecked until evidence
is attached.

## Baseline evidence inventory

- [x] Browser-local WebMCP feature detection, strict input/output validation,
  bounded output, and `AbortSignal` retirement are present.
- [x] The current provider regenerates/retires the active browser registration
  set when identity or page context changes; this is local evidence only and is
  not a server-verified registration generation.
- [x] Atlas WebMCP tools are explicitly local state/filter/selection controls and
  do not execute queries or write backend data.
- [x] Existing MCP calls use same-origin WebUI backend routes; service
  credentials are documented as server-side.
- [x] The repository explicitly records the Graph OS-to-browser lease bridge as
  future work rather than claiming it exists.
- [x] The route registry is the current navigation authority and already carries
  role and mobile disposition metadata.
- [x] Existing loading/error/form primitives were inventoried.
- [x] Existing favicon files were inventoried; linkage is incomplete.
- [x] Image-bearing source files were inventoried; repository-wide alt and
  compression policy remains open.
- [x] No verified baseline implementation was found for custom 404, robots,
  sitemap, Open Graph metadata, thank-you, privacy, terms, consent banner,
  analytics loader, or reviewed contact identity.

## Current working-tree evidence (partial; release items remain unchecked)

These checked lines are narrow receipts from the current working tree, not
claims that the related production requirement is complete. The full
requirement, bridge, deployment, and release checkboxes below remain the source
of completion truth.

- [x] `pnpm run site:assets:test` passed the route-authority asset tests.
- [x] `pnpm run site:assets:check` passed in safe noindex mode.
- [x] `pnpm run site:image-alt:check` passed after scanning 167 TSX source files.
- [x] Targeted Vitest passed eight files and 30 tests covering route head and
  metadata projections, public/mobile surfaces, consent/analytics, the site
  configuration gate, responsive behavior, and image behavior.
- [x] `pnpm run site:config:check` failed closed with seven missing/invalid
  deployment or legal values. Owner-supplied contact/legal data is therefore
  still open and `T010` remains blocked.
- [x] The contact conversion slice passed 20 backend and nine frontend tests:
  authenticated exact-origin delivery, schema/PII bounds, fixed server routing,
  explicit retention, dedicated throttling, fail-closed adapter behavior,
  durable contact-namespaced opaque receipts, client retry idempotency, strict
  adapter-result validation, client/server deadlines, required shared limiting,
  control-character rejection, shared receipt validation, accessible
  validation/pending/refusal states, input preservation, unmount cancellation,
  and confirmed-only App routing to `/thank-you`.
- [ ] No current receipt closes the Graph OS bridge, active-generation server
  binding, attended opt-in, at-most-once fence, cancellation effect, durable
  audit, BrowserControlService, truthful Langfuse, or deployed-topology gates.
  Real legal/contact values, the production governed contact adapter, the
  analytics destination, anonymous SSO policy, and the general form-error sweep
  also remain open.

## Audited MCP wiring defects

- [ ] **WMCP-AUD-001:** One versioned capability descriptor labels
  browser-local, WebUI-BFF, and Graph OS remote authority without merging
  executors.
- [ ] **WMCP-AUD-002:** Route registry metadata drives navigation, head, CTA,
  mobile, page context, indexability, and WebMCP page identity.
- [ ] **WMCP-AUD-003:** Lease issue/renew/revoke/expiry is bound to actor,
  tenant, session/device, origin, route, policy, tool versions, and trace IDs.
- [ ] **WMCP-AUD-004:** Every bridge call emits bounded provenance correlated to
  Langfuse and Graph OS `RunTrace` (or an explicit telemetry-unavailable state).
- [ ] **WMCP-AUD-005:** Browser abort, remote cancel, timeout, expiry, replay,
  disconnect, sign-out, and identity/route changes are idempotent; cancellation
  prevents new uncorrelated dispatch, reports the honest effect state, and
  reconciles committed or unknown effects without unconditional late-effect
  rejection.
- [ ] **WMCP-AUD-006:** WebMCP, MCP, REST, and workflow projections use one
  canonical control operation and exact-request mutation confirmation.
- [ ] **WMCP-AUD-007:** Browser prerequisites and deployed topology have
  end-to-end receipts; unsupported WebMCP and missing policy fail closed.

## Adversarial bridge review requirements

- [ ] **ADV-001:** Every active document/tool set has a server-verifiable
  `registration_generation` bound to document, route, identity, and tool/schema
  digest; old generations are refused.
- [ ] **ADV-002:** Graph OS is the sole authority for authorization, leases,
  replay/fences, call state, durable audit, receipts, and terminal outcomes;
  WebUI has no shadow authority.
- [ ] **ADV-003:** Every lease and call verifies the live login session, tenant,
  principal, origin, document, route, and active generation from server state.
- [ ] **ADV-004:** Remote control requires explicit attended opt-in through a
  visible UI gesture for the current session, shows scope, and provides revoke;
  hidden/unattended renewal is refused.
- [ ] **ADV-005:** A durable Graph OS call fence/state is persisted before
  dispatch and duplicate/retried MCP, REST, and workflow deliveries dispatch a
  browser side effect at most once.
- [ ] **ADV-006:** Service credentials authenticate services only and are never
  treated as proof of human-user browser delegation.
- [ ] **ADV-007:** Cancellation reports exactly `none`,
  `browser_reported_committed`, or `unknown`; it does not claim rollback or
  unconditional late-effect rejection.
- [ ] **ADV-008:** MCP, REST, and workflow adapters all invoke one Graph OS
  `BrowserControlService` for browser authorization, dispatch, confirmation,
  cancellation, fences, and receipts.
- [ ] **ADV-009:** Actor, lease, policy, fence, tool, generation, and pending
  receipt are durably audited before dispatch; audit failure sends no browser
  command.
- [ ] **ADV-010:** Langfuse status is truthful (`recorded`, `not_configured`, or
  `unavailable`) and never fabricates a trace ID.
- [ ] **ADV-011:** The remote bridge is disabled unless secure context/
  Permissions Policy, authenticated channel, verified login/session/tenant/
  principal, document/route/generation, attended opt-in, healthy Graph OS lease
  authority, policy digest, and durable audit path are present.

## Twenty production-web requirements

- [ ] **FR-001 — Custom 404 page:** Unknown routes render an accessible,
  metadata-backed 404 with a safe CTA and no fabricated data; direct-request
  status behavior is documented and tested.
- [ ] **FR-002 — Meta title on every page:** Every route updates a unique
  deterministic title, including 404, thank-you, privacy, and terms.
- [ ] **FR-003 — Meta description on every page:** Public routes have specific
  descriptions; private routes have safe descriptions and `noindex`.
- [ ] **FR-004 — CTA above the fold:** Each public entry/landing route has one
  keyboard-accessible primary CTA visible at defined desktop/mobile viewports.
- [ ] **FR-005 — Favicon set:** ICO, SVG/PNG variants, Apple icon, manifest, and
  theme metadata are linked from one versioned branded asset source.
- [ ] **FR-006 — `robots.txt`:** Private/authenticated paths are disallowed and
  the canonical sitemap is advertised only in an indexable environment.
- [ ] **FR-007 — `sitemap.xml`:** Only public canonical route-registry entries
  are included; IDs, sessions, queries, and fragments are absent.
- [ ] **FR-008 — Open Graph image:** Public share metadata uses one valid,
  absolute, compressed, versioned OG image and safe image alt; private data is
  excluded.
- [ ] **FR-009 — Alt text on every image:** Meaningful images have contextual alt;
  decorative images have explicit decorative semantics; generated/lazy/error
  states are covered.
- [ ] **FR-010 — Mobile breakpoints:** Every route declares truthful mobile
  behavior and full/adapted routes pass the viewport matrix without overflow or
  inaccessible controls.
- [ ] **FR-011 — Sticky mobile CTA:** One shared metadata-driven sticky CTA
  respects focus, safe-area insets, zoom, reduced motion, and content overlap.
- [ ] **FR-012 — Loading states:** Lazy routes, requests, WebMCP catalogs, lease
  operations, and submissions show accessible shared loading states and prevent
  duplicate non-idempotent submission.
- [ ] **FR-013 — Form error states:** Field and summary validation use accessible
  invalid state, preserve safe input, distinguish server/network/cancel errors,
  and never echo secrets or raw traces.
- [ ] **FR-014 — Thank-you page:** Confirmed submission reaches a dedicated
  metadata-backed thank-you page with bounded receipt and next-step CTA, with no
  PII in the URL or false delivery claim.
- [ ] **FR-015 — Privacy policy page:** Reviewed public policy identifies
  controller, purposes, data, retention, processors, choices, security contact,
  effective date, and revision.
- [ ] **FR-016 — Terms and conditions:** Reviewed public terms identify service
  terms, acceptable use, agent/MCP boundaries, disclaimers, governing/contact
  information, effective date, and revision.
- [ ] **FR-017 — Cookie banner:** Nonessential storage and requests are blocked
  until affirmative versioned consent; settings/revoke and necessary-cookie
  distinctions are accessible and tested.
- [ ] **FR-018 — Analytics installed:** Consent-gated analytics has a configured
  property or honest disabled state and emits sanitized events without prompts,
  tool args, graph data, tokens, or sensitive URLs; Langfuse/RunTrace remains
  server operational telemetry.
- [ ] **FR-019 — Real contact address:** One verified owner-supplied address is
  shown consistently in legal/contact/consent surfaces; placeholder or missing
  identity fails release.
- [ ] **FR-020 — Compressed images:** Raster, favicon, OG, and user-upload image
  assets pass one format/dimension/byte/compression/cache/fallback policy.

## Bridge acceptance

- [ ] **BR-001:** Supported WebMCP registers only bounded local tools; unsupported,
  insecure, and disallowed contexts are typed no-ops.
- [ ] **BR-002:** Catalog labels authority, tool ID/version, schema, role, route,
  active generation, mutation class, confirmation, and provenance metadata.
- [ ] **BR-003:** Graph OS lease issue verifies live login session, actor/
  principal, tenant, session, origin, document, route, active generation,
  attended opt-in, and role policy and cannot cross those bindings.
- [ ] **BR-004:** Leased read-only call reaches only the named local tool, returns
  bounded schema-valid data, and emits one receipt.
- [ ] **BR-005:** Mutating control requires exact-request user confirmation;
  stale/denied lease never reaches the action.
- [ ] **BR-006:** No browser payload, error, analytics, Langfuse, or RunTrace
  field contains service bearer, Keycloak token, OpenBao value, or unredacted
  secret; a service credential is never user delegation.
- [ ] **BR-007:** Identity/session/tenant/route/generation changes, expiry,
  cancel, timeout, and disconnect are idempotent; terminal effect is `none`,
  `browser_reported_committed`, or `unknown` without claiming rollback or
  unconditional late-effect rejection.
- [ ] **BR-008:** Every outcome preserves verified session/actor/tenant/principal/
  document/route/generation, lease, policy, nonce/fence, timing, result/error,
  cancellation effect, Graph OS RunTrace, and truthful Langfuse status. Durable
  audit is written before dispatch.
- [ ] **BR-009:** WebMCP, REST, MCP, and workflow projections exercise one Graph
  OS `BrowserControlService` and authorization decision.
- [ ] **BR-010:** Browser, integration, and deployed-topology tests cover secure
  context, Permissions Policy, origin-trial absence, direct deep links, route/
  generation changes, attended opt-in, mobile, replay fences, trust-prerequisite
  refusal, and Graph OS restart/reconnect.

## Shared-authority and anti-duplication checks

- [ ] Route metadata is declared once and consumed by all route/head/CTA/mobile/
  sitemap/robots/page-context/WebMCP surfaces.
- [ ] 404, thank-you, privacy, terms, contact, and public landing pages use one
  public/legal layout.
- [ ] Consent banner, analytics initialization, settings, and revoke use one
  consent-aware loader.
- [ ] Loading, unavailable, denied, cancelled, error, and form states reuse the
  existing primitives unless a documented contract gap justifies a new one.
- [ ] Favicon, Open Graph, content, and user-upload images use one image policy.
- [ ] Browser-local WebMCP, WebUI-BFF MCP, and Graph OS remote execution retain
  distinct authorities and cannot silently downgrade into one another.
- [ ] Graph OS `BrowserControlService` is the sole remote browser-control
  authority; WebUI does not own shadow leases, call state, replay fences, or
  receipts.
- [ ] No browser path forwards bearer tokens, OpenBao values, raw HTTP, raw SQL,
  Cypher, SPARQL, or arbitrary JavaScript.

## Verification receipts

- [ ] Route registry census and metadata uniqueness gate pass.
- [ ] Static robots/sitemap/head/asset/image/alt/legal/contact/consent gates pass.
- [ ] Vitest unit/component suite passes with frontend coverage at least 90%.
- [ ] Playwright desktop/mobile/public-route/WebMCP suite passes.
- [ ] Backend/integration lease, authorization, confirmation, cancellation,
  replay/fence, active-generation, login-session/tenant/principal/document/
  route, attended-opt-in, no-token, canonical-control, BrowserControlService,
  durable-audit-before-dispatch, honest cancellation effect, truthful Langfuse,
  and RunTrace suite passes with backend coverage at least 85%.
- [ ] Secure-context, Permissions Policy, origin-trial absence, Graph OS
  restart/reconnect, deployment artifact, identity, analytics, robots/sitemap,
  and rollback receipt is attached.
- [ ] `pnpm run lint` passes.
- [ ] `pnpm run typecheck` passes.
- [ ] `pre-commit run --all-files` passes.
- [ ] Final review confirms no requirement is marked complete from spec presence
  alone; every checked item points to test or deployment evidence.

## Release decision

**Current decision: Needs implementation.** The baseline has a bounded
browser-local WebMCP surface and a separate governed MCP BFF, but it does not yet
have the leased browser bridge or the twenty production-web requirements. Release
Release is blocked until the seven audit defects, ADV-001–ADV-011, FR-001–FR-020,
BR-001–BR-010, and the constitution gates have green receipts.
