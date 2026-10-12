# GraphOS shell and app delivery

No exact-head publication receipt is recorded.

- [ ] Inventory current brand identifiers, package consumers, generated assets, site links, consent keys and tool IDs on main.
- [x] Make browser title, metadata, web manifest, docs site name and README consistently present the GraphOS brand, with a `site:brand:check` gate (part of `pnpm run build`) proving it. (APP-01; index.html/webmanifest already said "Graph OS"; this fixes `mkdocs.yml` `site_name`/ecosystem entry and `README.md`'s heading, overview line and license line, and is deliberately scoped to brand copy only — no package, import or environment rename.)
- [ ] Add `apps` navigation and one typed `AppSurface` contract using existing route, contribution, WebMCP and renderer seams.
- [ ] Integrate Markets as first native consumer and add valid/invalid contributed-app fixtures.
- [x] Perform atomic public-name package and consumer cutover; regenerate assets and digests; document browser migration. (APP-02, APP-06, WEBUI-APPS-R002's remaining theme-token/asset-regeneration surface, WEBUI-APPS-R003: source commit 677a27e0f701eca99cad20887a0b5c4b8ec9734e exists on local branch feat/eh427-retire-review-20260926 but conflicts heavily with main — rename touches package.json, pyproject.toml, uv.lock, pnpm-lock.yaml and deletes files main already restructured; needs a fresh, smaller port, not a direct cherry-pick. The operator has not yet confirmed this package-identity rename; do not attempt it without that confirmation.)
- [ ] Run all test-spec gates, installed wheel and Pages build on exact commit; record consumer and publication evidence.
- [ ] Review every requirement after attaching browser, package and public-site evidence.
- [ ] **WEBUI-APPS-R004:** Run harness surface (rollup of 1 to 6)
- [ ] **WEBUI-APPS-R004.1:** Run read goes through the graph-os read operations.
- [ ] **WEBUI-APPS-R004.2:** Applied harness configuration is shown.
- [ ] **WEBUI-APPS-R004.3:** Context use is shown against the budget.
- [ ] **WEBUI-APPS-R004.4:** Current plan is shown read-only.
- [ ] **WEBUI-APPS-R004.5:** Each termination reason has a distinct state.
- [ ] **WEBUI-APPS-R004.6:** Absent operation shows an honest state.
- [ ] **WEBUI-APPS-R030.1:** Graph edit types.
- [ ] **WEBUI-APPS-R030.2:** Send edits to graph-os.
- [ ] **WEBUI-APPS-R030.3:** Wire graph handlers to the engine.
- [ ] **WEBUI-APPS-R030.4:** Show refusals on unauthorized edits.
- [ ] **WEBUI-APPS-R030.5:** Semantic filters and persona modes.
- [ ] **WEBUI-APPS-R030.6:** Edit log with verdicts.
- [ ] **WEBUI-APPS-R030.7:** Graph edit hot-path proof.
- [ ] **WEBUI-APPS-R031.1:** Memory file types.
- [ ] **WEBUI-APPS-R031.2:** Memory file operations.
- [ ] **WEBUI-APPS-R031.3:** Files tab in the memory view.
- [ ] **WEBUI-APPS-R031.4:** Authorized retained conflicts and head-free refusals.
- [ ] **WEBUI-APPS-R031.5:** Sync state labels.
- [ ] **WEBUI-APPS-R031.6:** Save evidence.
- [ ] **WEBUI-APPS-R031.7:** Memory files hot-path proof.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `APP-01`, `APP-02`, `APP-03`, `APP-04`, `APP-05`, `APP-06`, `APP-07`, `WEBUI-APPS-R001`, `WEBUI-APPS-R002`, `WEBUI-APPS-R003`, `WEBUI-APPS-R004`.
- [ ] **WEBUI-APPS-R005:** Navigation and dashboards follow the signed-in user's role (rollup).
- [ ] **WEBUI-APPS-R005.1:** Nav entry declares a minimum role.
- [ ] **WEBUI-APPS-R005.2:** Layout saved per user.
- [ ] **WEBUI-APPS-R005.3:** Connector tiles from the catalog.
- [ ] **WEBUI-APPS-R005.4:** One chat session list.
- [ ] **WEBUI-APPS-R005.5:** Every route renders.
- [ ] **WEBUI-APPS-R005.6:** Each view states its purpose.
- [ ] **WEBUI-APPS-R006:** One panel relates goals, sessions and fleets (rollup).
- [ ] **WEBUI-APPS-R006.1:** Link type.
- [ ] **WEBUI-APPS-R006.2:** Panel reads typed operations.
- [ ] **WEBUI-APPS-R006.3:** Absent operation is honest.

- [ ] R030.7: implement the served browser → GraphOS operation → fixture-engine journey and prove unauthorized edits leave durable graph state unchanged.
- [ ] R031.2 prerequisite: implement generated EG R085 and GraphOS R024.4.1–.6 contracts through canonical invoke; prove registered same-origin hosting. Definitions exist, runtime proof remains missing.
- [ ] R031.7: implement served snapshot/conflict/refusal journeys and the unchanged-head observation-generation acknowledgment race. Retain and reload authorized versions. Prove redacted denied/revoked reads and browser acknowledgment refusal. Accept sync labels only from EG evidence. No client/host-handler/engine-transport mocks.

<!-- spec-definition-patch:consumer-definitions-20261012 -->
## Consumer implementation tasks

All tasks below remain open. Definitions do not establish runtime delivery.

- [ ] **WEBUI-APPS-R004.7.1:** Implement and prove model for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.2:** Implement and prove behavior for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.3:** Implement and prove wiring for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.4:** Implement and prove refusal for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.5:** Implement and prove evidence for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.6:** Implement and prove served acceptance for evolution evidence.
- [ ] **WEBUI-APPS-R006.4.1:** Implement and prove model for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.2:** Implement and prove behavior for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.3:** Implement and prove wiring for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.4:** Implement and prove refusal for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.5:** Implement and prove evidence for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.6:** Implement and prove served acceptance for unified harness sessions.
- [ ] **WEBUI-APPS-R004.8.1:** Implement and prove model for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.2:** Implement and prove behavior for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.3:** Implement and prove wiring for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.4:** Implement and prove refusal for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.5:** Implement and prove evidence for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.6:** Implement and prove served acceptance for indexed usage analysis.
- [ ] **WEBUI-APPS-R030.8.1:** Implement and prove model for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.2:** Implement and prove behavior for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.3:** Implement and prove wiring for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.4:** Implement and prove refusal for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.5:** Implement and prove evidence for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.6:** Implement and prove served acceptance for live graph convergence.
- [ ] **WEBUI-APPS-R001.1.1:** Implement and prove model for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.2:** Implement and prove behavior for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.3:** Implement and prove wiring for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.4:** Implement and prove refusal for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.5:** Implement and prove evidence for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.6:** Implement and prove served acceptance for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.2.1:** Implement and prove model for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.2:** Implement and prove behavior for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.3:** Implement and prove wiring for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.4:** Implement and prove refusal for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.5:** Implement and prove evidence for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.6:** Implement and prove served acceptance for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.3.1:** Implement and prove model for column vector controls.
- [ ] **WEBUI-APPS-R001.3.2:** Implement and prove behavior for column vector controls.
- [ ] **WEBUI-APPS-R001.3.3:** Implement and prove wiring for column vector controls.
- [ ] **WEBUI-APPS-R001.3.4:** Implement and prove refusal for column vector controls.
- [ ] **WEBUI-APPS-R001.3.5:** Implement and prove evidence for column vector controls.
- [ ] **WEBUI-APPS-R001.3.6:** Implement and prove served acceptance for column vector controls.
- [ ] **WEBUI-APPS-R001.4.1:** Implement and prove model for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.2:** Implement and prove behavior for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.3:** Implement and prove wiring for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.4:** Implement and prove refusal for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.5:** Implement and prove evidence for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.6:** Implement and prove served acceptance for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.5.1:** Implement and prove model for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.2:** Implement and prove behavior for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.3:** Implement and prove wiring for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.4:** Implement and prove refusal for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.5:** Implement and prove evidence for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.6:** Implement and prove served acceptance for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.6.1:** Implement and prove model for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.2:** Implement and prove behavior for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.3:** Implement and prove wiring for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.4:** Implement and prove refusal for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.5:** Implement and prove evidence for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.6:** Implement and prove served acceptance for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.7.1:** Implement and prove model for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.2:** Implement and prove behavior for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.3:** Implement and prove wiring for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.4:** Implement and prove refusal for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.5:** Implement and prove evidence for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.6:** Implement and prove served acceptance for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.8.1:** Implement and prove model for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.2:** Implement and prove behavior for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.3:** Implement and prove wiring for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.4:** Implement and prove refusal for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.5:** Implement and prove evidence for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.6:** Implement and prove served acceptance for interactive code explanations.
<!-- /spec-definition-patch -->

- [ ] Reconcile exact specialized producer requirements, operation IDs and schema revisions before marking any source input definition-complete.
- [ ] Obtain owner-defined positive finite latency, layout and viewport bounds for R004.8, R030.8 and R001.2.
- [ ] Bind R006.4 acceptance to every entry in the complete versioned supported-harness manifest.
