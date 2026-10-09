# GraphOS shell and app delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **SPECIFIED**; no exact-head publication receipt recorded.

- [ ] Inventory current brand identifiers, package consumers, generated assets, site links, consent keys and tool IDs on main.
- [x] Add `apps` navigation and one typed `AppSurface` contract using existing route, contribution, WebMCP and renderer seams. (APP-03, APP-04, APP-05, APP-07, WEBUI-APPS-R001; ported commit 0809b6d3ca727b19b196f2b875a7cf007eb341db)
- [x] Integrate Markets as first native consumer and add valid/invalid contributed-app fixtures. (APP-05; same commit as above)
- [ ] Perform atomic public-name package and consumer cutover; regenerate assets and digests; document browser migration. (APP-02, APP-06, WEBUI-APPS-R002, WEBUI-APPS-R003: source commit 677a27e0f701eca99cad20887a0b5c4b8ec9734e exists on local branch feat/eh427-retire-review-20260926 but conflicts heavily with main — rename touches package.json, pyproject.toml, uv.lock, pnpm-lock.yaml and deletes files main already restructured; needs a fresh, smaller port, not a direct cherry-pick.)
- [ ] Run all test-spec gates, installed wheel and Pages build on exact commit; record consumer and publication evidence.
- [ ] Review every requirement and mark ACCEPTED only after browser, package and public-site evidence is attached.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `APP-01`, `APP-02`, `APP-03`, `APP-04`, `APP-05`, `APP-06`, `APP-07`, `WEBUI-APPS-R001`, `WEBUI-APPS-R002`, `WEBUI-APPS-R003`.
