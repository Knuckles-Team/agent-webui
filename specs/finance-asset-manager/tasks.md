# FIN-UI-001 — Delivery and evidence tracker

**Spec status:** SPECIFIED. **Implementation status:** UNVERIFIED. **Owner:** `agent-webui`. The related cross-repository requirement IDs below are stable identifiers, each defined in its owning repository's own `requirements.md`. Status changes only when linked merged code and the tests in [test-spec.md](test-spec.md) prove the behavior.

| Work package | Owner | IDs | Current state | Required evidence |
|---|---|---|---|---|
| Finance ontology, accounting, sessions and golden fixtures | epistemic-graph | EG-FINANCE-PRIMITIVES-R004–EG-FINANCE-PRIMITIVES-R006, EG-FINANCE-PRIMITIVES-R013 | PENDING | Merged owner spec/code, fixed-point and provenance fixture output |
| Provider data, account reads and CSV import | agent-connector-sdk / emerald-exchange | SDK-FINANCE-SOURCES-R002, SDK-FINANCE-SOURCES-R003, SDK-FINANCE-SOURCES-R004 | PENDING | Qualified source coverage, entitlement, preview/idempotency contract tests |
| Strategy, backtest, recommendation and leverage | epistemic-graph / agent-utilities | EG-FINANCE-PRIMITIVES-R007–EG-FINANCE-PRIMITIVES-R009, EG-FINANCE-PRIMITIVES-R010 | PENDING | Versioned deterministic outputs, abstention, scorecard and risk-policy proof |
| DCA scheduling and alert delivery | graph-os / emerald-exchange | GRAPHOS-DATA-MARKET-R006, EG-FINANCE-PRIMITIVES-R011 | PENDING | Replay-safe event and delivery receipts |
| Source intake and leverage guide | media-downloader / emerald-exchange | EMERALD-GUIDE-R001, EMERALD-MEDIA-R001 | PENDING | Public citations, source capture time, claims separated from executable rules |
| Responsive Markets route and views | agent-webui | FIN-UI-R001 | SPECIFIED | PR/commit, FIN-T01–T04, T07–T14, served-path and visual evidence |
| Shared Finance/Atlas ChartRenderer | agent-webui | FIN-UI-R002 | SPECIFIED | PR/commit, FIN-T05–T06, T13–T14 and mobile performance evidence |
| Detail-tab/ChartRenderer/supportedChartMode contracts (PR #59) | agent-webui | FIN-UI-R001.1, FIN-UI-R002.1, FUI-05.1 | LANDED | `chart-contract.test.ts`, `detail-support.test.ts` — 11 passed |
| Overlay/performance/strategy/delivery contracts (PR #60) | agent-webui | FUI-07.1, FUI-08.1, FUI-09.1, FUI-10.1 | LANDED | 4 new vitest files — 19 passed |
| CSV import/offline-cache/a11y contracts (PR #61) | agent-webui | FUI-11.1, FUI-12.1, FUI-13.1 | LANDED | vitest — 13 passed |
| Live wiring of detail-tab/ChartRenderer/supportedChartMode (remaining) | agent-webui | FIN-UI-R001.2, FIN-UI-R002.2, FUI-05.2 | SPECIFIED | Live ChartPage/ChartRenderer component wiring, PR pending |
| Live wiring of overlay/performance/strategy (remaining) | agent-webui | FUI-07.2, FUI-08.2, FUI-09.2 | SPECIFIED | `overlay-wiring.test.ts`, `PerformanceCardView.test.tsx`, `StrategyPanel.test.tsx` — 10 passed, PR pending |
| Live wiring of delivery (remaining) | agent-webui | FUI-10.2 | SPECIFIED | `DeliveryStateList.test.tsx` — 3 passed, PR pending |
| Live wiring of CSV import/offline-cache (remaining) | agent-webui | FUI-11.2, FUI-12.2 | SPECIFIED | `CsvImportFlow.test.tsx`, `OfflineCacheView.test.tsx` — 7 passed, PR pending |
| Live wiring of a11y (remaining) | agent-webui | FUI-13.2 | SPECIFIED | Live component wiring, PR pending |

## Build sequence

- [ ] Confirm the owner services' actual served capabilities, source entitlements, and account permissions. Start with one venue and a bounded instrument universe; record unavailable paths.
- [ ] Agree and version the API/data shapes in [plan.md](plan.md) with owner repositories. Publish owner-native specs that cite FIN-UI-001 and the relevant cross-repository requirement IDs.
- [ ] Add a Finance route in `src/lib/nav-registry.ts` and use the existing shell, route role filter, FastAPI host checks and gateway validation.
- [ ] Implement one venue → persisted candles → scanner → shared ChartRenderer → finalized flip history. Keep source, as-of, session and quality metadata visible.
- [ ] Add groups, holdings, performance, account import, strategy, DCA, alerts, News and Calendar only as certified owner contracts become available. Use explicit unavailable states meanwhile.
- [ ] Add the accessibility, contract, browser and negative tests listed in [test-spec.md](test-spec.md). Verify import idempotency, offline staleness, denied access and no direct order path.
- [ ] Run all repository gates and report CCCC, jscpd, dupehound and KISS findings. Where jscpd or dupehound lacks a configured command, establish a reviewed command/threshold before claiming green.
- [ ] Record mobile and desktop visual review, provider-backed integration evidence, test results and merged PR/commit links. Reconcile each owner ID independently; update this spec to BUILT only when every owned and dependency gate is proven.

## Evidence log

| Date | Commit/PR | Environment and fixture/service revision | Tests/gates | Decision |
|---|---|---|---|---|
| 2026-10-08 | Port of 0809b6d3ca onto `origin/main` (PR pending) | Local worktree, pnpm/uv toolchain, no live provider | `pytest agent/agent_webui/__tests__/test_markets_app.py` 14 passed; `vitest run src/apps/markets src/lib/apps` 26 passed; `tsc --noEmit` clean; `node scripts/generate-site-assets.mjs` + `check-site-assets.mjs` pass; `no_fabrication_gate.mjs` OK | FUI-03 and FIN-UI-R003 code merged to a branch off current main; owner repository dependencies (EG finance primitives, SDK sources) remain PENDING, so this spec stays SPECIFIED overall |
| 2026-10-09 | Markets five-destination nav, stacked on the 0809b6d3ca port branch (PR pending) | Local worktree, pnpm toolchain | `vitest run src/apps/markets` 29 passed (new `MarketsNav.test.tsx`); `tsc --noEmit` clean; site-assets generate/check and no-fabrication gate pass | FUI-01 code merged to a branch stacked on the still-open Markets-app-port PR; News and Portfolio destinations state their PENDING owner dependency honestly; Calendar reuses the existing macro-events route; spec stays SPECIFIED overall |

## Unreferenced requirement IDs

The build sequence above cites `FIN-UI-R001` and `FIN-UI-R002` by work package but does not name `FIN-UI-R003` or the `FUI-01`–`FUI-13` sub-requirements individually; add their coverage to the corresponding build-sequence and evidence-log rows as each is implemented. All IDs are defined in [requirements.md](requirements.md).

## Status rules

`SPECIFIED` means the intended behavior and design are reviewable. `BUILDING` requires a linked implementation PR. `BUILT` requires merged code plus passing served-path and quality evidence for the owned behavior. `BLOCKED` names an unmet dependency or unavailable capability. A mock view or documentation commit does not promote any requirement ID to BUILT. If a dependency remains unavailable, keep its row PENDING/BLOCKED and show the corresponding honest state in the UI.

## Decomposition children (tracked)

- [x] **FUI-05:** Detail tabs and range controls expose only supported data (rollup)
- [x] **FUI-07:** Chart overlays show strategy version and simulation state (rollup)
- [x] **FUI-08:** Performance cards render owner-calculated values verbatim (rollup)
- [x] **FUI-09:** Strategy views cite evidence and never submit orders (rollup)
- [ ] **FUI-10:** DCA and alert views distinguish delivery states (rollup)
- [ ] **FUI-11:** CSV import preview with idempotent receipt (rollup)
- [ ] **FUI-12:** Offline PWA shell marks cached data stale (rollup)
