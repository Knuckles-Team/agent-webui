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
- [x] Add `graphos-decisions-transport.ts`, a real `DecisionsTransport` calling the shared `invoke()` adapter (`decide.records.*`, `decide.outcomes.aggregate`, `decide.receipts.*`); migrates the decisions caller off fixtures-only for its data-access seam (part of WEBUI-API-R001's "migrates decisions ... pages to call it"). Op ids are a best-effort naming convention pending the generated client; not yet wired into a route (`DecisionsView` still has no registered path — see `KNOWN_NON_ROUTE_COMPONENTS`). Test: `src/components/decisions/__tests__/graphos-decisions-transport.test.ts`.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-API-R001`, `WEBUI-API-R002`, `WEBUI-API-R003`, `WEBUI-API-R004`, `WEBUI-API-R005`, `APIUI-01`, `APIUI-02`, `APIUI-03`, `APIUI-04`, `APIUI-05`, `APIUI-06`.
