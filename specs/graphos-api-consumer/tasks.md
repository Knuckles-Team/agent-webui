# API consumer delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **SPECIFIED**. No cutover acceptance is asserted.

- [ ] Inventory all `api_extensions.py` and browser callers; add a checked-in route-family census with UI-local/Graph OS/retire classification.
- [ ] Pin the Graph OS registry schema and generator; add digest parity and error tests.
- [ ] Migrate decisions, apps/Markets, WebMCP and effect confirmation; prove denied and step-up cases.
- [ ] Migrate ontology, graph, Atlas and object sets with tenant and pagination parity.
- [ ] Migrate remaining prompts, SDD, KB, sessions, goals, MCP and model families.
- [ ] Remove replaced host domain routes and AU-internal imports; add static architecture guard.
- [ ] Run all test-spec gates on exact merged commit, attach route census and CI/browser evidence, then assess acceptance.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-API-R001`, `WEBUI-API-R002`, `WEBUI-API-R003`, `APIUI-01`, `APIUI-02`, `APIUI-03`, `APIUI-04`, `APIUI-05`, `APIUI-06`.
