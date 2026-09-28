# Finance Asset Manager — delivery and evidence tracker

**Spec state:** specified; implementation not verified. **Baseline:** 2026-09-27 ledger EH-698–EH-713 and EH-715 all QUEUED. This file does not update the canonical ledger. Change row state only after checking merged owner code and tests, recording PR/commit evidence, and reconciling `plans/refactor/LEDGER.md`.

| Work item | Owner | Ledger | State | Completion evidence required |
|---|---|---|---|---|
| Finance ontology, accounting, reference data and fixtures | epistemic-graph | EH-698–EH-700, EH-715 | waiting for verification | finance-v1 and golden fixtures merged; no-float invariant |
| Stocks and other asset data, account import | SDK / Emerald | EH-701, EH-709, EH-713 | waiting for verification | qualified data paths, mapping/idempotency tests |
| Strategies, backtests, recommendations and leverage | epistemic-graph / AU | EH-702–EH-704, EH-706 | waiting for verification | deterministic runs, scorecards, abstention and risk gates |
| Scheduled DCA and finance alerts | graph-os / Emerald | EH-705, EH-712 | waiting for verification | replay-safe scheduling and outbox receipts |
| Leverage guide and media skills | Emerald / media-downloader | EH-707, EH-708 | waiting for verification | authoritative citations, claims separated from rules |
| Markets responsive navigation, groups, detail, portfolio view | agent-webui | EH-710 | specified | PR/commit, visual and accessibility evidence |
| Shared ChartRenderer and overlays in Finance and Atlas | agent-webui | EH-711 | specified | PR/commit, fixture parity and mobile performance evidence |

## Work packages

- [ ] Capture served gateway capabilities and real provider/permission evidence; select one venue and bounded initial universe.
- [ ] Agree owner API/schema contracts in `plan.md`; resolve links to the corresponding owner-native specs when published.
- [ ] Implement a Finance route through existing shell/permission wiring and a typed browser-safe gateway adapter.
- [ ] Implement the shared ChartRenderer via Atlas registry; certify candles, scalar series, volume, overlays, gaps and keyboard/text access.
- [ ] Implement group/holding, detail, performance, recommendation, alert, DCA and import views as each owner contract lands.
- [ ] Execute `test-spec.md` and record CI, mobile visual, accessibility, performance and owner fixture results.
- [ ] Link merged PRs/commits for each ledger row; reconcile canonical ledger statuses and set this spec to built only when all owner and WebUI acceptance criteria pass.

## Source and related program records

- `plans/finance/recommended_plan.md` — finance workspace architecture and first vertical slice.
- `plans/refactor/proposals/FINANCE-EXTENSION-20260927.md` — T8 finance extension design.
- `plans/refactor/TRAINS-8-9.md` — T8 lanes and dependencies; EH-714 Ghostfolio is T9.
- `plans/refactor/LEDGER.md` — authoritative row state and evidence.
- Owner-native specs in `epistemic-graph`, `agent-connector-sdk`, `agents/emerald-exchange`, `graph-os`, `agent-utilities` and `agents/media-downloader` should cross-reference this spec by `FIN-UI-001`; add direct repository links once those files exist.
