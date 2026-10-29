# API consumer delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **SPECIFIED**. No cutover acceptance is asserted.

- [ ] Inventory all `api_extensions.py` and browser callers; add a checked-in route-family census with UI-local/Arbora/retire classification.
- [x] Pin the Arbora registry schema (`src/lib/arbora-api/generated/openapi.json`, built from `arbora.api.http.openapi.document` over the live registry) and a generator (`pnpm run arbora:client:gen`, openapi-typescript, into `src/lib/arbora-api/generated/schema.ts`) (OVERSTORY-API-R006). **Caveat** (see `generated/README.md`): this snapshot's arbora and epistemic-graph checkouts were not digest-pinned to each other, so EG-bound operations (`eg.*`) carry a placeholder result/params schema; regenerating from a digest-matched pair is still open. Digest parity and error tests remain open.
- [x] Checked the real registry against `#38`'s `decide.*` op ids (OVERSTORY-API-R001 follow-up): **no `decide.*` namespace exists.** The real decision operations are `eg.query.Decide`, `eg.coordination.DecisionLog`, `eg.coordination.DecisionEval`, `eg.coordination.DecisionFit`, `eg.storage.DecisionCommit`, each multiplexing several named actions (e.g. `DecisionLog` carries `get`/`aggregate`/`commit`/`evaluate`/`compact`/`learn`/`resolve`/`verify` selected by a request field) rather than one operation id per `DecisionsTransport` method. Retargeting `arbora-decisions-transport.ts` needs the real per-action request/result shapes, not a rename; tracked separately, not patched into `#38`'s branch.
- [ ] Migrate decisions, apps/Markets, WebMCP and effect confirmation; prove denied and step-up cases.
- [x] Migrate ontology, graph, Atlas and object sets with tenant and pagination parity. Split into `OVERSTORY-API-R008.1` (ontology), `OVERSTORY-API-R008.2` (graph), `OVERSTORY-API-R008.3` (Atlas), `OVERSTORY-API-R008.4` (object-set); see [requirements.md](requirements.md). `OVERSTORY-API-R008.1` is blocked: the pinned Arbora schema has no concrete ontology-shaped operation yet (its `eg.reasoning.GraphSchema`/`GraphSchemaList`/`OntologyInspect` and `eg.compute.MatchOntologyTerms`/`MineOntologyGap` operations all share one generic placeholder `EgSchemaRef {path: string}` request/response, not the schema-graph/catalogue/object shape the current host route returns).
- [ ] Migrate remaining prompts, SDD, KB, sessions, goals, MCP and model families.
- [x] OVERSTORY-API-R003.1: Add `src/lib/arbora-api/route-census.ts` — `RouteCensusEntry` typed model, strict disposition enum, refusal when a `generated-operation` row omits its owning operation (PR #62).
- [ ] OVERSTORY-API-R003.2: Add a checked-in route-census data file covering every `api_extensions.py` domain route family, plus an architecture lint rule enforced in CI that rejects any new unclassified domain route.
- [ ] Remove replaced host domain routes and AU-internal imports; add static architecture guard.
- [ ] Run all test-spec gates on exact merged commit, attach route census and CI/browser evidence, then assess acceptance.
- [x] OVERSTORY-API-R004: Mint a per-request correlation id in `RequestObservabilityMiddleware`. **State: Building.** Remaining: served log check after rollout.
- [x] Log the sanitized typed error code in `_log_failure` and add tests/test_log_failure_error_code.py (OVERSTORY-API-R005).
- [x] Add `ConsoleConfirmView` + the `console.confirm` route (`src/lib/nav-registry.ts`), built fresh on current main's `invoke.ts`/`identity.ts::confirmedStepUpUrl` plan-ref primitives: fetches the server-held plan by `plan_ref` alone and confirms by reference, never replaying the original request arguments. Test: `src/components/views/__tests__/ConsoleConfirmView.test.tsx` (OVERSTORY-API-R007; partial OVERSTORY-API-R001 — the generated TS client and decisions/Markets/WebMCP migration remain open).

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `OVERSTORY-API-R001`, `OVERSTORY-API-R002`, `OVERSTORY-API-R003`, `OVERSTORY-API-R004`, `OVERSTORY-API-R005`, `OVERSTORY-API-R006`, `OVERSTORY-API-R007`, `OVERSTORY-API-R008`, `OVERSTORY-API-R008.1`, `OVERSTORY-API-R008.2`, `OVERSTORY-API-R008.3`, `OVERSTORY-API-R008.4`, `OVERSTORY-API-R009`, `OVERSTORY-API-R010`, `OVERSTORY-API-R011`, `OVERSTORY-API-R003.1`, `OVERSTORY-API-R003.2`.

- [x] OVERSTORY-API-R011.1: Compose host routes through `application_composer` with no engine in the WebUI; prove served-operation calls and `not_available` answers through the real factory.

- [ ] OVERSTORY-API-R003.2: Join the domain-route census to OVERSTORY-APPS-R045 action coverage. Reject unclassified redesign/WebMCP actions. Retain owner boundaries and explicit unavailable results.
- [ ] OVERSTORY-API-R011.2: Bind browser conversation identity and preserve validated admitted references in streamed message metadata; qualify the composed browser-to-Arbora path before completion.

- [x] OVERSTORY-API-R011.2.1: Bind source preservation and refusal fixtures without claiming installed composition.
- [ ] OVERSTORY-API-R011.2.2: Qualify the complete parent identity matrix through the installed browser-to-Arbora path.

- [ ] **OVERSTORY-API-R011.3:** Consume the released public execution projection through the existing host/browser adapter. Qualify identity, redaction, replay and installed-producer behavior without client-owned orchestration.

- [x] OVERSTORY-API-R011.4: Qualify the flat execution read adapter with exact identity and adversarial producer fixtures.
- [ ] R011.3: Retain nested projections, public transcripts and installed-producer acceptance after this source-only slice.
