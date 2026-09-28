# Finance Asset Manager — WebUI product specification

**Spec ID:** FIN-UI-001
**Owner:** `agent-webui`
**State:** specified; implementation unverified
**Source baseline:** `plans/finance/recommended_plan.md` and `plans/refactor/proposals/FINANCE-EXTENSION-20260927.md` (2026-09-27)
**Program:** train 8 `fin-app`, EH-710 and EH-711; consumer coverage for EH-698–EH-709, EH-712, EH-713 and EH-715.

This is the owner-native contract for the browser presentation of Finance. A spec is a build request, not evidence that a feature has landed. The source ledger marked all 17 T8 rows **QUEUED** on 2026-09-27. A maintainer must reconcile that state with merged code and passing acceptance evidence before changing any row to **BUILT**. `tasks.md` tracks that distinction.

## User outcomes

1. An authenticated user sees a mobile-first Markets workspace for a selected universe, account and currency. They can move among Markets, News, Calendar, Portfolio and Menu without losing their selection. Desktop uses the same information architecture in a side rail.
2. They can browse user-defined instrument groups in Basic or Holdings mode, search by instrument and venue, distinguish regular from pre/post-market prices, and see data freshness, source and session on each displayed figure.
3. An instrument detail view presents Chart, Rates, News, Notes, Dividends and Analysis tabs, a 1D/5D/1M/6M/1Y/5Y/MAX range selector, and line/candle display where the underlying data permits it. Charts expose volume, trend flips, DCA events, cost basis, margin levels and provenance where authorized and available.
4. Portfolio performance compares 1D/1M/YTD/1Y/5Y/ALL returns with explicitly named benchmarks. A benchmark comparison says how cash flows, currency, taxes, missing prices and corporate actions were treated.
5. The user can inspect and configure alerts and DCA proposals. Recommendations are labeled informational, cite evidence and strategy version, and display an explicit abstention state. No browser control can turn a proposal or signal into an order without the existing governed execution path.
6. CSV import provides a column-mapping preview, validation errors and a stable import receipt. Re-import of the same source has an idempotent outcome. The UI never computes authoritative holdings or cost basis from imported rows.

## Scope and ownership

`agent-webui` owns route composition, accessible interactions, chart drawing, browser-safe adapters and display state. Reuse its existing application shell, route/permission model, gateway client, Atlas renderer registry and WebMCP controller pattern. `graph-os` owns authenticated API projection and delivery. `epistemic-graph` owns finance-v1 ontology, time-series, reference data, fixed-point accounting, strategies, backtests, recommendations, leverage calculations and evidence. `agent-connector-sdk` and Emerald Exchange own provider and account transport and governed effects. Agent Utilities owns orchestration. The WebUI must not duplicate provider clients, money math, strategy evaluation, alert schedulers or order policy.

The screen references are interaction inspiration; do not copy Stoxy branding or unlicensed imagery. Logos require a licensed source and an accessible text fallback. Real estate holdings show dated valuations and staleness, with no trade affordance. Ghostfolio is optional T9 import EH-714, outside this spec's completion criteria.

## Functional requirements

| ID | Required behavior | Primary ledger row |
|---|---|---|
| FUI-01 | Responsive bottom navigation/desktop rail, accessible keyboard and touch behavior, durable route and selection state | EH-710 |
| FUI-02 | Group tabs and Basic/Holdings toggle with explicit empty, loading, stale and unavailable states | EH-698, EH-710 |
| FUI-03 | Instrument rows show licensed logo or fallback, venue, ticker, session clock, sparkline, prior close, change pill and separate post-market line where applicable | EH-700, EH-701, EH-710 |
| FUI-04 | Detail tabs, range selector, line/candle toggle and volume pane; disable unsupported chart modes with a reason | EH-710, EH-711 |
| FUI-05 | One reusable ChartRenderer draws typed series for all asset classes in Finance and Atlas; indicators are computed before display decimation | EH-711 |
| FUI-06 | Chart overlays align to their own versioned source bars: trend line/flips, DCA buys, cost basis and margin/liquidation levels | EH-699, EH-702, EH-706, EH-711 |
| FUI-07 | Portfolio return and benchmark card displays method, period, currency, as-of, source and session; unavailable comparisons are explicit | EH-699, EH-700, EH-710, EH-715 |
| FUI-08 | Strategy/recommendation panels show proposed actions, version, scorecard and evidence or abstention; paper/live status is unmistakable | EH-702–EH-706 |
| FUI-09 | Alerts support price, trend flip, DCA due and margin threshold through existing finance outbox channels | EH-712 |
| FUI-10 | Account read and CSV import UI show mapping preview, digest, per-row errors and idempotent receipt | EH-713 |
| FUI-11 | PWA install and offline shell never present cached prices, portfolio totals, alerts or orders as current data | EH-710, EH-715 |

## Completion rule

The spec becomes **built** only after the T8 dependencies have landed, the WebUI and owner-contract tests in `test-spec.md` pass, mobile and desktop visual review is recorded, and a merged commit/PR is linked in `tasks.md`. Individual ledger rows retain their own owner and evidence; this UI spec cannot mark an EG or Emerald row built merely because a screen renders.
