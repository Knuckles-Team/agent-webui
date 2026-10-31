# OVERSTORY — Delivery and evidence tracker

**Spec status:** SPECIFIED. **Implementation status:** UNVERIFIED. **Owner:** `overstory`. The related cross-repository requirement IDs below are stable identifiers, each defined in its owning repository's own `requirements.md`. Status changes only when linked merged code and the tests in [test-spec.md](test-spec.md) prove the behavior.

| Work package | Owner | IDs | Current state | Required evidence |
|---|---|---|---|---|
| Finance ontology, accounting, sessions and golden fixtures | medulla | MEDULLA-FINANCE-PRIMITIVES-R004–MEDULLA-FINANCE-PRIMITIVES-R006, MEDULLA-FINANCE-PRIMITIVES-R013 | PENDING | Merged owner spec/code, fixed-point and provenance fixture output |
| Provider data, account reads and CSV import | agent-connector-sdk / emerald-exchange | SCION-FINANCE-SOURCES-R002, SCION-FINANCE-SOURCES-R003, SCION-FINANCE-SOURCES-R004 | PENDING | Qualified source coverage, entitlement, preview/idempotency contract tests |
| Strategy, backtest, recommendation and leverage | medulla / agent-utilities | MEDULLA-FINANCE-PRIMITIVES-R007–MEDULLA-FINANCE-PRIMITIVES-R009, MEDULLA-FINANCE-PRIMITIVES-R010 | PENDING | Versioned deterministic outputs, abstention, scorecard and risk-policy proof |
| DCA scheduling and alert delivery | arbora / emerald-exchange | ARBORA-DATA-MARKET-R006, MEDULLA-FINANCE-PRIMITIVES-R011 | PENDING | Replay-safe event and delivery receipts |
| Source intake and leverage guide | media-downloader / emerald-exchange | EMERALD-GUIDE-R001, EMERALD-MEDIA-R001 | PENDING | Public citations, source capture time, claims separated from executable rules |
| Responsive Markets route and views | overstory | OVERSTORY-R001 | SPECIFIED | PR/commit, FIN-T01–T04, T07–T14, served-path and visual evidence |
| Shared Finance/Atlas ChartRenderer | overstory | OVERSTORY-R002 | SPECIFIED | PR/commit, FIN-T05–T06, T13–T14 and mobile performance evidence |
| Detail-tab/ChartRenderer/supportedChartMode contracts (PR #59) | overstory | OVERSTORY-R001.1, OVERSTORY-R002.1, OVERSTORY-R008.1 | LANDED | `chart-contract.test.ts`, `detail-support.test.ts` — 11 passed |
| Overlay/performance/strategy/delivery contracts (PR #60) | overstory | OVERSTORY-R010.1, OVERSTORY-R011.1, OVERSTORY-R012.1, OVERSTORY-R013.1 | LANDED | 4 new vitest files — 19 passed |
| CSV import/offline-cache/a11y contracts (PR #61) | overstory | OVERSTORY-R014.1, OVERSTORY-R015.1, OVERSTORY-R016.1 | LANDED | vitest — 13 passed |
| Live wiring of detail-tab/ChartRenderer/supportedChartMode (remaining) | overstory | OVERSTORY-R001.2, OVERSTORY-R002.2, OVERSTORY-R008.2 | SPECIFIED | Live ChartPage/ChartRenderer component wiring, PR pending |
| Live wiring of overlay/performance/strategy (remaining) | overstory | OVERSTORY-R010.2, OVERSTORY-R011.2, OVERSTORY-R012.2 | SPECIFIED | `overlay-wiring.test.ts`, `PerformanceCardView.test.tsx`, `StrategyPanel.test.tsx` — 10 passed, PR pending |
| Live wiring of delivery (remaining) | overstory | OVERSTORY-R013.2 | SPECIFIED | `DeliveryStateList.test.tsx` — 3 passed, PR pending |
| Live wiring of CSV import/offline-cache (remaining) | overstory | OVERSTORY-R014.2, OVERSTORY-R015.2 | SPECIFIED | `CsvImportFlow.test.tsx`, `OfflineCacheView.test.tsx` — 7 passed, PR pending |
| Live wiring of a11y (remaining) | overstory | OVERSTORY-R016.2 | SPECIFIED | `ChartA11ySummary.test.tsx` — 4 passed, PR pending |

## Build sequence

- [ ] Confirm the owner services' actual served capabilities, source entitlements, and account permissions. Start with one venue and a bounded instrument universe; record unavailable paths.
- [ ] Agree and version the API/data shapes in [plan.md](plan.md) with owner repositories. Publish owner-native specs that cite FIN-UI and the relevant cross-repository requirement IDs.
- [ ] Add a Finance route in `src/lib/nav-registry.ts` and use the existing shell, route role filter, FastAPI host checks and gateway validation.
- [ ] Implement one venue → persisted candles → scanner → shared ChartRenderer → finalized flip history. Keep source, as-of, session and quality metadata visible.
- [ ] Add groups, holdings, performance, account import, strategy, DCA, alerts, News and Calendar only as certified owner contracts become available. Use explicit unavailable states meanwhile.
- [ ] Add the accessibility, contract, browser and negative tests listed in [test-spec.md](test-spec.md). Verify import idempotency, offline staleness, denied access and no direct order path.
- [ ] Run all repository gates and report CCCC, jscpd, dupehound and KISS findings. Where jscpd or dupehound lacks a configured command, establish a reviewed command/threshold before claiming green.
- [ ] Record mobile and desktop visual review, provider-backed integration evidence, test results and merged PR/commit links. Reconcile each owner ID independently; update this spec to BUILT only when every owned and dependency gate is proven.

## Evidence log

| Date | Commit/PR | Environment and fixture/service revision | Tests/gates | Decision |
|---|---|---|---|---|
| 2026-10-08 | Port of 0809b6d3ca onto `origin/main` (PR pending) | Local worktree, pnpm/uv toolchain, no live provider | `pytest agent/overstory/__tests__/test_markets_app.py` 14 passed. `vitest run src/apps/markets src/lib/apps` 26 passed. `tsc --noEmit` clean. `node scripts/generate-site-assets.mjs` and `check-site-assets.mjs` pass. `no_fabrication_gate.mjs` OK | OVERSTORY-R006 and OVERSTORY-R003 code merged to a branch off current main. Owner repository dependencies remain PENDING. They are EG finance primitives and SDK sources. This spec stays SPECIFIED. |
| 2026-10-09 | Markets five-destination nav, stacked on the 0809b6d3ca port branch (PR pending) | Local worktree, pnpm toolchain | `vitest run src/apps/markets` 29 passed (new `MarketsNav.test.tsx`). `tsc --noEmit` clean. Site-assets generate and check pass. The no-fabrication gate passes | OVERSTORY-R004 code merged to a branch stacked on the open Markets-app-port PR. News and Portfolio destinations state their PENDING owner dependency. Calendar reuses the macro-events route. The spec stays SPECIFIED. |

## Unreferenced requirement IDs

The build sequence above cites `OVERSTORY-R001` and `OVERSTORY-R002` by work package but does not name `OVERSTORY-R003` or the `OVERSTORY-R004`–`OVERSTORY-R016` sub-requirements individually. Add their coverage to the corresponding build-sequence and evidence-log rows as each is implemented. All IDs are defined in [requirements.md](requirements.md).

## Status rules

`SPECIFIED` means the intended behavior and design are reviewable. `BUILDING` requires a linked implementation PR. `BUILT` requires merged code plus passing served-path and quality evidence for the owned behavior. `BLOCKED` names an unmet dependency or unavailable capability. A mock view or documentation commit does not promote any requirement ID to BUILT. If a dependency remains unavailable, keep its row PENDING/BLOCKED and show the corresponding honest state in the UI.

## Decomposition children (tracked)

- [x] **OVERSTORY-R008:** Detail tabs and range controls expose only supported data (rollup)
- [x] **OVERSTORY-R010:** Chart overlays show strategy version and simulation state (rollup)
- [x] **OVERSTORY-R011:** Performance cards render owner-calculated values verbatim (rollup)
- [x] **OVERSTORY-R012:** Strategy views cite evidence and never submit orders (rollup)
- [ ] **OVERSTORY-R013:** DCA and alert views distinguish delivery states (rollup)
- [ ] **OVERSTORY-R014:** CSV import preview with idempotent receipt (rollup)
- [ ] **OVERSTORY-R015:** Offline PWA shell marks cached data stale (rollup)
