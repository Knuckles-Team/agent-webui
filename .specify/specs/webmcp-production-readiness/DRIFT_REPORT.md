# Drift report: WebMCP and Graph OS production readiness

Generated: 2026-09-14
Baseline: `e421a70`
Spec status: **PLANNED**

## Requirement coverage

The canonical `spec.md` and `spec.json` define the same seven normalized audit
defects (`WMCP-AUD-001` through `WMCP-AUD-007`), eleven adversarial bridge
requirements (`ADV-001` through `ADV-011`), twenty production requirements
(`FR-001` through `FR-020`), ten bridge acceptance criteria (`BR-001` through
`BR-010`), and seven non-functional requirements (`NFR-001` through `NFR-007`).
Every audit, adversarial, FR, and BR requirement maps to one or more entries in
`tasks.md` and `tasks.json`.

## Confirmed baseline versus target

- The browser-local WebMCP adapter, provider, typed tools, output budget, and
  abort lifecycle are present and bounded.
- The provider regenerates/retires its active local registration set when
  identity or page context changes. This is only local evidence; there is no
  server-verified registration generation in the baseline.
- The existing MCP client uses a same-origin WebUI backend seam and does not
  place Graph OS service credentials in browser code.
- Graph OS ownership of authorization, leases, replay/fence state, call state,
  durable pre-dispatch audit, receipts, and terminal outcomes is not present in
  this repository baseline. Neither is the remote browser channel, attended
  opt-in, server binding, shared provenance receipt, or cross-boundary
  cancellation.
- Route role/mobile metadata and loading/error primitives exist partially, but
  page head, CTA, public/legal, consent/analytics, asset, and deployment
  contracts are incomplete or unverified.

These are deliberately recorded as `PRESENT_BOUNDED`, `PRESENT_SEPARATE_SEAM`,
`PARTIAL`, `MISSING`, `UNKNOWN_OPEN`, or `MISSING_UNVERIFIED` in `spec.json`.
Spec files do not claim that product code or live infrastructure has been
changed.

## Current working-tree proof (partial)

The current implementation lane has narrow receipts, but no receipt below
closes a task or changes the release decision:

- `pnpm run site:assets:test` passed the route-authority asset tests.
- `pnpm run site:assets:check` passed in safe noindex mode.
- `pnpm run site:image-alt:check` passed after scanning 167 TSX source files.
- A targeted Vitest run passed 8 files and 30 tests covering route
  head/metadata, public/mobile surfaces, consent/analytics, responsive
  behavior, site-config gating, and image behavior.
- `pnpm run site:config:check` failed closed with seven missing or invalid
  values: site origin, legal owner, contact address, effective date, legal
  revision, privacy text, and terms text.
- The contact flow passed 20 focused backend tests and nine focused frontend
  tests. This proves the authenticated exact-origin route, field and response
  bounds, server-owned destination/retention, dedicated throttle, default
  refusal, durable contact-namespaced opaque receipt, client retry idempotency,
  strict adapter-result validation, client/server deadlines, required shared
  limiting, control-character rejection, shared receipt validation, accessible
  form states, preserved input, unmount cancellation, and receipt-gated App
  routing to `/thank-you`.

The narrow evidence leaves T001, T003–T007, T009, T011, and T020 with partial
receipts in `tasks.json`; their task statuses remain `PENDING` because their
full acceptance criteria are not proven. T010 remains
`BLOCKED_PENDING_OWNER_INPUT`. T012 is complete at the code/test layer;
production adapter and deployed delivery proof remain part of T021/T022.
T013–T019 and T021–T023 remain open. In
particular, no current receipt proves Graph OS ownership, server-verified
login/session/tenant/principal/document/route/generation binding, attended
opt-in, at-most-once fences, honest cancellation effects, durable audit before
dispatch, one `BrowserControlService`, truthful Langfuse status, or deployed
topology. Real owner-supplied legal/contact values, the production governed
contact adapter, the analytics destination, anonymous SSO policy, and the
general form-error sweep are also explicitly open.

## Ambiguities requiring explicit owner decisions

1. The legal controller/business identity and real contact address are not
   available in the repository. `T010` is therefore blocked pending owner input;
   implementation must not invent a value.
2. The serving topology must decide whether direct unknown paths can return a
   transport-level 404 while still serving the SPA shell. The UI 404 requirement
   is independent, but the deployment receipt must document both behaviors.
3. Product analytics provider, retention, and indexable public host are not
   configured in this repository. The loader must support a truthful disabled
   state until deployment configuration and consent policy are supplied.
4. The exact Graph OS lease transport (same-origin request plus an authenticated
   event channel, or another approved server-mediated channel) is an
   implementation decision. The authority, lease claims, no-token rule,
   confirmation, cancellation, and provenance requirements are fixed.
5. The exact Graph OS call-state storage and fence implementation is an
   implementation decision, but Graph OS ownership, durable audit before
   dispatch, at-most-once dispatch, and honest unknown cancellation are fixed.
6. The historical audit may contain IDs for the seven MCP wiring gaps outside
   this checkout. Those IDs must be retained as aliases when implementation
   starts; `WMCP-AUD-*` are stable normalized IDs for this SDD only.

## Deduplication review

No new product source was changed by this lane. The spec explicitly assigns one
owner each to route metadata, public/legal layout, consent/analytics, loading /
error primitives, image policy, capability authority, lease authority,
`BrowserControlService`, and provenance. A future implementation that adds a
second route table, legal shell, analytics initializer, image budget, Graph OS
lease/replay authority, BrowserControlService fork, or raw Graph OS request path
is a spec drift and must be rejected in review.

## Verification commands for this spec-only lane

The lightweight checks run by the author are recorded in the handoff. Full
frontend/backend/build and pre-commit gates remain implementation gates and are
not represented as passing here.
