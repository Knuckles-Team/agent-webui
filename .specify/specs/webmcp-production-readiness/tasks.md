# Tasks: WebMCP and Graph OS production readiness

Generated: 2026-09-14
Status: **PLANNED** — product implementation has not started in this spec-only lane.

The task list is deliberately organized around the five shared authorities in
the spec. Each requirement appears in at least one task; no task should create a
second route table, legal shell, consent loader, loading/error primitive, or image
policy.

## Phase 1 — route and public surface authorities

- [ ] [P] **T001** Establish the typed route metadata contract and route census.
  - Covers: `WMCP-AUD-002`, `FR-001`–`FR-008`, `FR-010`, `FR-014`–`FR-016`, `FR-019`.
  - Add title, description, canonical/indexability, public/private class, CTA,
    mobile, loading/error, WebMCP page identity, and legal revision metadata to
    the existing route authority. Prove that navigation, head, sitemap, robots,
    page context, and WebMCP consume it.
  - Owner: `agent-webui`; dependencies: none.

- [ ] [P] **T002** Implement the route-registry-backed custom 404 boundary.
  - Covers: `FR-001`.
  - Render an accessible 404 with a safe CTA and explicit direct-request status
    behavior for the actual serving topology. Unknown routes must not fall
    through to a plausible page or fabricated data.
  - Owner: `agent-webui`; dependencies: `T001`.

- [ ] [P] **T003** Implement one route-head projection.
  - Covers: `FR-002`, `FR-003`, `FR-008`.
  - Update title, description, canonical, robots, Open Graph, and Twitter tags on
    route transitions; mark private routes `noindex` and exclude private context.
  - Owner: `agent-webui`; dependencies: `T001`.

- [ ] [P] **T004** Generate environment-aware `robots.txt` and `sitemap.xml`.
  - Covers: `FR-006`, `FR-007`.
  - Include only public canonical route descriptors; disallow authenticated and
    control-plane paths and never include IDs, sessions, queries, or fragments.
  - Owner: `agent-webui`/deployment; dependencies: `T001`.

- [ ] [P] **T005** Complete the favicon and Open Graph asset set.
  - Covers: `FR-005`, `FR-008`, `FR-020`.
  - Link the complete ICO/SVG/PNG/Apple/manifest/theme set from one source and
    publish one versioned compressed 1,200x630 social image with safe alt text.
  - Owner: `agent-webui`; dependencies: `T001`, `T006`.

## Phase 2 — shared UX, legal, consent, and image policies

- [ ] [P] **T006** Define and gate the single image policy.
  - Covers: `FR-009`, `FR-020`, and the image portion of `FR-005`/`FR-008`.
  - Establish meaningful/decorative alt rules, validated remote/user image
    handling, dimensions/byte budgets, compression/cache/fallback rules, and
    static checks for every image element and shipped asset.
  - Owner: `agent-webui`; dependencies: none.

- [ ] [P] **T007** Complete the route-aware responsive contract and shared mobile CTA.
  - Covers: `FR-004`, `FR-010`, `FR-011`.
  - Exercise the route viewport matrix, preserve truthful unsupported states, and
    add one metadata-driven sticky CTA that respects focus, safe areas, zoom, and
    reduced motion.
  - Owner: `agent-webui`; dependencies: `T001`.

- [ ] [P] **T008** Normalize loading, unavailable, denied, cancelled, error, and
  form validation states onto existing primitives.
  - Covers: `FR-012`, `FR-013`.
  - Audit all lazy/data/lease/form boundaries; use `RouteLoadingFallback`,
    `ErrorBoundary`, `Skeleton`, `UnavailableNotice`, `SessionExpiredNotice`,
    and existing field validation where applicable. Prohibit error-as-empty and
    fabricated success.
  - Owner: `agent-webui`; dependencies: `T001`.

- [ ] [P] **T009** Build one accessible public/legal layout and reviewed content
  routes.
  - Covers: `FR-001`, `FR-014`, `FR-015`, `FR-016`.
  - Reuse one shell for 404, thank-you, privacy, terms, contact, and public
    landing pages. Attach legal owner, effective date, revision, and reviewed
    copy; do not invent legal text or contact identity.
  - Owner: `agent-webui`/legal owner; dependencies: `T001`, `T002`, `T003`.

- [ ] [P] **T010** Supply and validate the real contact address and legal identity.
  - Covers: `FR-015`, `FR-016`, `FR-019`.
  - Load one reviewed value into legal/contact/consent surfaces and fail a
    release with a missing, sample, or placeholder address. Evidence requires
    owner sign-off.
  - Owner: product/legal owner; dependencies: `T009`.

- [ ] [P] **T011** Implement the shared consent-aware analytics loader.
  - Covers: `FR-017`, `FR-018`.
  - Block nonessential storage/requests until versioned consent, support revoke
    and settings, sanitize events, and keep product analytics separate from
    Langfuse/RunTrace. Missing configuration must be truthful and nonfatal.
  - Owner: `agent-webui`; dependencies: `T001`, `T009`, `T010`.

- [x] [P] **T012** Add confirmed-submission and form receipts.
  - Covers: `FR-013`, `FR-014`.
  - Preserve safe input on failure, render accessible field/summary errors, and
    navigate to a metadata-backed thank-you route only after backend confirmation;
    no PII or raw submission belongs in the URL.
  - Code receipt: 20 focused backend tests and nine focused frontend tests pass.
    The delivery port remains disabled without server-owned destination and
    retention configuration; production adapter/deployment proof belongs to
    `T021`/`T022`.
  - Owner: `agent-webui`; dependencies: `T008`, `T009`.

## Phase 3 — governed WebMCP / Graph OS bridge

- [ ] [P] **T013** Publish one versioned capability descriptor with explicit
  authority and mutation class.
  - Covers: `WMCP-AUD-001`, `WMCP-AUD-006`, `ADV-001`, `ADV-008`, `BR-002`,
    `BR-009`.
  - Describe browser-local, WebUI-BFF, and Graph OS remote tools with IDs,
    versions, schema digests, role requirements, route binding, read/mutate
    class, confirmation policy, active registration generation, and source
    provenance. Do not merge executors. The current local provider
    registration key is evidence of dynamic registration only; it is not server
    authority.
  - Owner: `agent-webui` + Graph OS; dependencies: `T001`.

- [ ] [P] **T014** Implement the server-side capability lease lifecycle.
  - Covers: `WMCP-AUD-003`, `WMCP-AUD-007`, `ADV-002`, `ADV-003`, `ADV-004`,
    `ADV-006`, `ADV-011`, `BR-003`, `BR-005`, `BR-006`.
  - Graph OS `BrowserControlService` owns issue/renew/revoke/expire records,
    authorization, replay/fence state, call state, and receipts. Bind leases to
    server-verified live login session, principal, tenant, session/device,
    origin, document, route, active registration generation, tool/schema
    allowlist, role policy, nonce floor, attended opt-in, and trace IDs. Use
    opaque identifiers only; never treat a service credential as user
    delegation or send it to the browser. Default lifetime is at most five
    minutes and hard maximum at most fifteen minutes. The bridge is disabled
    when any trust prerequisite is absent.
  - Owner: Graph OS; dependencies: `T013`.

- [ ] [P] **T015** Implement the authenticated browser bridge and local dispatcher.
  - Covers: `WMCP-AUD-003`, `WMCP-AUD-005`, `ADV-001`, `ADV-003`, `ADV-004`,
    `ADV-011`, `BR-001`, `BR-004`, `BR-007`.
  - Bind the open document and active registration generation to the lease
    channel; Graph OS verifies live login session, tenant, principal, origin,
    document, route, and generation on every call. Require attended visible
    opt-in, dispatch only named browser-local tools, enforce strict schemas and
    output bounds, and retire on identity/page/session/generation changes.
    Unsupported WebMCP remains a typed no-op and cannot become an ungoverned
    remote path.
  - Owner: `agent-webui`; dependencies: `T001`, `T013`, `T014`.

- [ ] [P] **T016** Route calls through one Graph OS `BrowserControlService` with
  at-most-once fences.
  - Covers: `WMCP-AUD-006`, `ADV-005`, `ADV-008`, `BR-005`, `BR-009`.
  - Implement one Graph OS service for authorization, lease/call state,
    confirmation, cancellation, fences, dispatch, and receipts. MCP, REST, and
    workflow adapters all call it. Persist a durable call fence before dispatch
    so retries cannot send a browser side effect more than once; do not claim
    exactly-once completion across a network failure. Prohibit raw
    SQL/Cypher/SPARQL/REST forwarding and arbitrary browser actions.
  - Owner: Graph OS; dependencies: `T013`, `T014`, `T015`.

- [ ] [P] **T017** Implement cross-boundary cancellation, expiry, replay, and
  disconnect handling.
  - Covers: `WMCP-AUD-005`, `ADV-005`, `ADV-007`, `BR-007`.
  - Make browser abort, explicit cancel, timeout, lease revoke/expiry, nonce
    replay, channel loss, sign-out, route/generation change, and tenant/identity
    change converge on one idempotent Graph OS operation. Report exactly one
    effect state: `none`, `browser_reported_committed`, or `unknown`; never
    claim rollback or unconditional late-effect rejection. Do not start a new
    uncorrelated dispatch after cancellation; reconcile `unknown` outcomes.
  - Owner: Graph OS/WebUI; dependencies: `T014`, `T015`, `T016`.

- [ ] [P] **T018** Emit the governed provenance and observability receipt.
  - Covers: `WMCP-AUD-004`, `ADV-002`, `ADV-009`, `ADV-010`, `BR-004`,
    `BR-006`, `BR-008`.
  - Graph OS durably records the actor, verified login session, tenant,
    principal, origin, document, route/generation, lease, tool/schema digest,
    nonce/fence, policy decision, attended confirmation, timing, cancellation
    effect, result/error digest, RunTrace ID, truthful Langfuse status
    (`recorded`, `not_configured`, or `unavailable`), and source/provenance
    references before dispatch. Redact or hash sensitive arguments; failed audit
    persistence prevents dispatch; never fabricate Langfuse IDs or status.
  - Owner: Graph OS; dependencies: `T014`, `T016`, `T017`.

## Phase 4 — verification and release evidence

- [ ] [P] **T019** Add static contract and no-duplication gates.
  - Covers: all `WMCP-AUD-*`, all `ADV-*`, `FR-001`–`FR-020`, `BR-001`–
    `BR-010`, `NFR-005`.
  - Check route coverage, metadata uniqueness, private sitemap/robots exclusion,
    legal/contact placeholders, image compression, image alt semantics, asset
    links, consent loader singularity, loading/error primitive use, active
    registration-generation metadata, no shadow Graph OS authority, and no
    service-credential-as-user-delegation path.
  - Owner: `agent-webui`; dependencies: `T001`–`T018` as applicable.

- [ ] [P] **T020** Add Vitest and Playwright browser evidence.
  - Covers: `FR-001`–`FR-020`, `ADV-001`, `ADV-003`, `ADV-004`, `ADV-006`,
    `ADV-007`, `ADV-011`, `BR-001`, `BR-002`, `BR-004`, `BR-007`, `BR-010`.
  - Exercise route head/404/legal/thank-you/consent/analytics, forms, image
    semantics, desktop/mobile/sticky CTA, WebMCP supported/unsupported paths,
    deep links, route and active-generation changes, attended opt-in/revoke,
    cancellation effect states, trust-prerequisite refusal, and no-token
    behavior.
  - Owner: `agent-webui`; dependencies: `T001`–`T018` as applicable.

- [ ] [P] **T021** Add backend/integration and deployed-topology receipts.
  - Covers: `WMCP-AUD-003`–`WMCP-AUD-007`, all `ADV-*`, `BR-003`–`BR-010`,
    `NFR-001`–`NFR-007`.
  - Prove Graph OS-owned lease/call/replay state, login-session/tenant/principal/
    origin/document/route/generation binding, attended opt-in, at-most-once
    fence, durable audit before dispatch, confirmation, honest cancellation
    effects, one BrowserControlService across protocols, no-token delegation,
    truthful Langfuse/RunTrace, restart/reconnect, secure context, Permissions
    Policy, origin-trial absence, Graph OS gateway identity, actual WebUI
    artifact, analytics configuration, robots/sitemap environment, and rollback.
  - Owner: Graph OS/WebUI/deployment; dependencies: `T013`–`T020`.

- [ ] [P] **T022** Run the constitution release gates and attach the final receipt.
  - Covers: all requirements and success rule.
  - Run `pnpm run lint`, `pnpm run typecheck`, required Vitest/Playwright and
    backend suites, `pre-commit run --all-files`, and coverage gates (frontend
    at least 90%, backend at least 85%). Mark only evidenced items complete.
  - Owner: release owner; dependencies: `T019`–`T021`.

- [ ] [P] **T023** Run the adversarial bridge review receipt against the exact
  implementation and deployment.
  - Covers: `ADV-001`–`ADV-011`.
  - Verify active registration generations, Graph OS sole authority, every
    server-side binding, attended opt-in, at-most-once fences, service-credential
    separation, all three honest cancellation effects, one
    `BrowserControlService`, durable pre-dispatch audit, truthful Langfuse
    status, and trust-prerequisite bridge disablement. No review row may be
    marked complete from source presence or a mock-only test.
  - Owner: adversarial reviewer + release owner; dependencies: `T014`–`T022`.

## Current implementation evidence (partial; task completion remains open)

These receipts were run against the current working tree on 2026-09-14. A
checked evidence line records only the narrow behavior proved by that command;
it does not close the corresponding task or production requirement.

- [x] Route metadata/head/public-surface projections have targeted evidence:
  `PageHead.test.tsx`, `page-metadata.test.ts`, and the public/mobile component
  tests passed as part of the eight-file Vitest run (30 tests passed).
- [x] The safe noindex asset gate passed with `pnpm run site:assets:check`, and
  route-authority asset tests passed with `pnpm run site:assets:test`.
- [x] The repository image-alt scan passed with
  `pnpm run site:image-alt:check` (167 TSX source files scanned).
- [x] Targeted consent, responsive, public-surface, metadata, site-config-gate,
  and image component tests passed: eight test files and 30 tests.
- [x] The site configuration gate fails closed when deployment/legal values are
  absent: `pnpm run site:config:check` reported seven missing or invalid origin,
  owner, contact-address, legal-date/revision, privacy, and terms values.
- [ ] Full route, form, legal-owner, deployment, Graph OS bridge, adversarial,
  and release receipts remain open. In particular, real legal/contact values,
  the production governed contact adapter, the analytics destination,
  anonymous SSO policy, and the general form-error sweep are still open. These
  receipts also do not prove Graph OS authority, server
  binding, attended opt-in, fences, cancellation effects, durable audit,
  BrowserControlService parity, or Langfuse status.

## Definition of done

The feature is complete only when all seven audit defects, `ADV-001` through
`ADV-011`, every `FR-001` through `FR-020` and `BR-001` through `BR-010` have
green evidence, the real contact/legal owner receipt is attached, and all
constitution gates pass.
The repository must still preserve a clean distinction between browser-local
WebMCP and governed remote MCP after implementation.
