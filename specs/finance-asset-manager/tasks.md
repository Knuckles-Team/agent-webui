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
| Pending | Pending | Pending | Pending | No implementation verified |

## Unreferenced requirement IDs

The build sequence above cites `FIN-UI-R001` and `FIN-UI-R002` by work package but does not name `FIN-UI-R003` or the `FUI-01`–`FUI-13` sub-requirements individually; add their coverage to the corresponding build-sequence and evidence-log rows as each is implemented. All IDs are defined in [requirements.md](requirements.md).

## Status rules

`SPECIFIED` means the intended behavior and design are reviewable. `BUILDING` requires a linked implementation PR. `BUILT` requires merged code plus passing served-path and quality evidence for the owned behavior. `BLOCKED` names an unmet dependency or unavailable capability. A mock view or documentation commit does not promote any requirement ID to BUILT. If a dependency remains unavailable, keep its row PENDING/BLOCKED and show the corresponding honest state in the UI.
