# GraphOS shell and app delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **SPECIFIED**; no exact-head publication receipt recorded.

- [ ] Inventory current brand identifiers, package consumers, generated assets, site links, consent keys and tool IDs on main.
- [x] Make browser title, metadata, web manifest, docs site name and README consistently present the GraphOS brand, with a `site:brand:check` gate (part of `pnpm run build`) proving it. (APP-01; index.html/webmanifest already said "Graph OS"; this fixes `mkdocs.yml` `site_name`/ecosystem entry and `README.md`'s heading, overview line and license line, and is deliberately scoped to brand copy only — no package, import or environment rename.)
- [ ] Add `apps` navigation and one typed `AppSurface` contract using existing route, contribution, WebMCP and renderer seams.
- [ ] Integrate Markets as first native consumer and add valid/invalid contributed-app fixtures.
- [x] Perform atomic public-name package and consumer cutover; regenerate assets and digests; document browser migration. (APP-02, APP-06, WEBUI-APPS-R002's remaining theme-token/asset-regeneration surface, WEBUI-APPS-R003: source commit 677a27e0f701eca99cad20887a0b5c4b8ec9734e exists on local branch feat/eh427-retire-review-20260926 but conflicts heavily with main — rename touches package.json, pyproject.toml, uv.lock, pnpm-lock.yaml and deletes files main already restructured; needs a fresh, smaller port, not a direct cherry-pick. The operator has not yet confirmed this package-identity rename; do not attempt it without that confirmation.)
- [ ] Run all test-spec gates, installed wheel and Pages build on exact commit; record consumer and publication evidence.
- [ ] Review every requirement and mark ACCEPTED only after browser, package and public-site evidence is attached.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `APP-01`, `APP-02`, `APP-03`, `APP-04`, `APP-05`, `APP-06`, `APP-07`, `WEBUI-APPS-R001`, `WEBUI-APPS-R002`, `WEBUI-APPS-R003`.
