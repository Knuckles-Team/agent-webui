# API consumer delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **SPECIFIED**. No cutover acceptance is asserted.

- [ ] Inventory all `api_extensions.py` and browser callers; add a checked-in route-family census with UI-local/Graph OS/retire classification.
- [ ] Pin the Graph OS registry schema and generator; add digest parity and error tests.
- [ ] Migrate decisions, apps/Markets, WebMCP and effect confirmation; prove denied and step-up cases.
- [ ] Migrate ontology, graph, Atlas and object sets with tenant and pagination parity.
- [ ] Migrate remaining prompts, SDD, KB, sessions, goals, MCP and model families.
- [ ] Remove replaced host domain routes and AU-internal imports; add static architecture guard.
- [ ] Run all test-spec gates on exact merged commit, attach route census and CI/browser evidence, then assess acceptance.
- [ ] WEBUI-API-R004: Mint a per-request correlation id in `RequestObservabilityMiddleware`. **State: Building.** Remaining: served log check after rollout.
- [x] Log the sanitized typed error code in `_log_failure` and add tests/test_log_failure_error_code.py (WEBUI-API-R005).
- [x] Add `ConsoleConfirmView` + the `console.confirm` route (`src/lib/nav-registry.ts`), built fresh on current main's `invoke.ts`/`identity.ts::confirmedStepUpUrl` plan-ref primitives: fetches the server-held plan by `plan_ref` alone and confirms by reference, never replaying the original request arguments. Test: `src/components/views/__tests__/ConsoleConfirmView.test.tsx` (APIUI-02; partial WEBUI-API-R001 — the generated TS client and decisions/Markets/WebMCP migration remain open).

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-API-R001`, `WEBUI-API-R002`, `WEBUI-API-R003`, `WEBUI-API-R004`, `WEBUI-API-R005`, `APIUI-01`, `APIUI-02`, `APIUI-03`, `APIUI-04`, `APIUI-05`, `APIUI-06`.
