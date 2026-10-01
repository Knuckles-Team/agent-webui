# FIN-UI-001 — Finance Asset Manager

**Status:** SPECIFIED; implementation and deployment unverified. **Owner:** `agent-webui`. Every requirement ID this spec owns, and the cross-repository IDs it depends on, are defined in [requirements.md](requirements.md); their current delivery and acceptance state, with evidence, is recorded in [status.json](status.json). These identifiers support cross-repository tracking; this document contains the complete WebUI requirements. A specification is not evidence that its feature is built.

## Purpose, actors, and priority

The primary actor is an authenticated investor managing personal accounts. They need one place to inspect multi-asset holdings, market context, strategy proposals, alerts, and charts without confusing historical analysis with live execution. A contributor can build the WebUI from this repository and mock the explicit contracts in [plan.md](plan.md); integration with owner services remains a separate acceptance gate.

**P1:** a readable Markets workspace and one reusable financial chart. **P2:** portfolio, import, strategy, alert, and DCA views as the corresponding service contracts become available. **P3:** optional research panels. Release P1 only with honest unavailable states for unfinished P2 capabilities.

## User stories and acceptance scenarios

1. **Browse markets.** From a phone, the user opens Markets, switches among Markets/News/Calendar/Portfolio/Menu, selects a named group and Basic or Holdings, and opens one instrument. Desktop shows the same destinations in a side rail. Keyboard and screen reader users can perform the same actions. The route preserves selected group, instrument, range, and tab across normal navigation and refresh without putting account secrets in the URL.
2. **Understand a price.** An instrument row and detail view identify the listing, venue, quote currency, regular/pre/post session, source, as-of time, and whether the price is stale or delayed. The row has a licensed logo or text fallback, sparkline, previous-close reference, and change with both text and color. A missing quote is labeled unavailable, never displayed as zero.
3. **Inspect one chart.** The detail view offers Chart/Rates/News/Notes/Dividends/Analysis, 1D/5D/1M/6M/1Y/5Y/MAX ranges, and line/candle mode where valid. The same renderer handles Finance and Atlas series. Volume and available overlays align to source bars; unsupported modes explain why they cannot be shown.
4. **Assess holdings.** Portfolio groups have Basic/Holdings views. A performance card supports 1D/1M/YTD/1Y/5Y/ALL and named benchmarks, with return method, currency, cash-flow and tax treatment, as-of, source, and session. A dated real-estate valuation is labeled stale when applicable and has no trade control.
5. **Review proposals safely.** DCA, trend, rebalancing and leverage analysis show strategy version, evidence, paper/live state, and proposed actions. Recommendations are informational: accumulate/hold/de-risk or explicit abstention. A proposal, alert, or chart marker grants no order authority.
6. **Import and monitor.** The user previews CSV column mapping and row errors before import, receives a stable receipt and sees an idempotent re-import result. They can inspect price, trend-flip, DCA-due and margin-threshold alert states, including retries and failures.

## Numbered requirements

| ID | Observable requirement | Related IDs |
|---|---|---|
| FUI-01 | Responsive five-destination navigation uses a bottom bar on narrow viewports and a side rail on desktop; selected route and focus remain coherent. | FIN-UI-R001 |
| FUI-02 | User-defined instrument groups and Basic/Holdings mode preserve selection and distinguish loading, genuinely empty, stale, partial, denied, and unavailable results. | EG-FINANCE-PRIMITIVES-R004, FIN-UI-R001 |
| FUI-03 | Search keys selection by stable instrument and listing IDs, venue and quote basis; ticker text alone never identifies an instrument. | EG-FINANCE-PRIMITIVES-R006, SDK-FINANCE-SOURCES-R002 |
| FUI-04 | Rows and details show price/session/provenance, previous close, change, sparkline, licensed logo or fallback, and separate after-hours value where supplied. | EG-FINANCE-PRIMITIVES-R006, SDK-FINANCE-SOURCES-R002, FIN-UI-R001 |
| FUI-05 | Detail tabs, range controls, line/candle toggle and separate volume pane expose only supported intervals and data types. | FIN-UI-R001, FIN-UI-R002 |
| FUI-06 | One typed ChartRenderer is shared with Atlas. It draws scalar line/area and complete OHLC candles, preserves gaps and revisions, and computes no authoritative indicators. | FIN-UI-R002 |
| FUI-07 | Available overlays include trend line/flips, DCA buys, cost basis and margin/liquidation levels; each displays strategy/source version and simulation status. | EG-FINANCE-PRIMITIVES-R005, EG-FINANCE-PRIMITIVES-R007, EG-FINANCE-PRIMITIVES-R010, FIN-UI-R002 |
| FUI-08 | Performance and benchmark cards render owner-calculated fixed-point values with method, currency, source, as-of, session and explicit unavailable states. | EG-FINANCE-PRIMITIVES-R005, EG-FINANCE-PRIMITIVES-R013 |
| FUI-09 | Strategy and recommendation views cite versioned evidence and scorecards, show abstention reasons, and never directly submit orders. | EG-FINANCE-PRIMITIVES-R007–EG-FINANCE-PRIMITIVES-R010 |
| FUI-10 | DCA and alert views distinguish due, missed, failed, replayed, paper-filled and delivered states. | GRAPHOS-DATA-MARKET-R006, EG-FINANCE-PRIMITIVES-R011 |
| FUI-11 | CSV import previews mapping and validation, shows source digest and idempotent receipt, and reads authoritative accounting after import. | SDK-FINANCE-SOURCES-R004 |
| FUI-12 | PWA offline shell marks cached financial facts stale; it cannot imply current market, account or order state. | FIN-UI-R001, EG-FINANCE-PRIMITIVES-R013 |
| FUI-13 | Every chart and control works with keyboard, screen reader summary, 200% zoom, reduced motion and non-color state labels. | WEBUI-DESIGN-R001, FIN-UI-R001, FIN-UI-R002 |

## Boundaries and failure behavior

The WebUI draws and adapts data; it does not calculate lots, cost basis, P&L, benchmark returns, strategies, leverage, signal flips, or provider history. `epistemic-graph` is the durable data and compute authority; Emerald Exchange and `agent-connector-sdk` transport market/account data and governed effects; `graph-os` authenticates and projects APIs, schedules and delivers; `agent-utilities` orchestrates workflows. The browser uses its own FastAPI host and authenticated gateway path. No vendor credential, broker export, approval lease, or raw account data enters browser storage.

Missing permission, route absence, stale data, partial coverage, bad contract shape, network failure and empty account are distinct states. No fabricated quote, timeframe, logo, account total, recommendation, or success message is allowed. A live leveraged order requires a separate per-instrument policy, pre-trade checks and authorized approval in the owner service; WebUI controls must remain incapable of bypassing it. CFDs unavailable to a US retail account are refused by the owner service and labeled unavailable in the UI. News or video claims never become deterministic strategy rules without a versioned evaluation and evidence.

## Success and completion criteria

- Every FUI requirement has the corresponding passing test in [test-spec.md](test-spec.md) and a linked merged commit/PR in [tasks.md](tasks.md).
- Scanner, chart and alert views agree on the same finalized, versioned trend event; viewport decimation cannot change an indicator output.
- Mobile and desktop visual review, accessibility checks, owner contract fixtures, build, and applicable quality gates pass. Performance is recorded for a 1,000-instrument paged universe on the agreed device profile; no target is declared passed without a measured baseline and published threshold.
- A demo or mock is labeled as such. The feature is **BUILT** only when the served, authenticated path and negative cases pass, not when this document or a mock UI merges.

## Scope exclusions

This release does not implement a broker, investment-adviser service, proprietary TradingView studies, direct browser-to-provider connections, automatic live trading, trading of manually valued real estate, a Ghostfolio database, or a new frontend shell. A future public product requires separate data-display licensing and regulatory decisions.
