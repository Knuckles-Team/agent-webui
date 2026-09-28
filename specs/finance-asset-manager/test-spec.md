# Finance Asset Manager — acceptance and test specification

**Evidence rule:** every test result links to a commit, fixture/source revision, environment and date in `tasks.md`. A passing mock-only WebUI suite does not certify live provider coverage, accounting or execution policy.

## Contract and correctness

| ID | Acceptance case | Expected result |
|---|---|---|
| FIN-T01 | Gateway returns missing, empty, stale, partial, unauthorized and unavailable data for each Finance projection | Distinct, accessible UI state; no invented zero or success; source/as-of/session remains visible where data exists |
| FIN-T02 | Search identical ticker on two venues and quote currencies | Distinct instrument/listing choices; selection and price never cross streams |
| FIN-T03 | Candles cross pre/regular/post sessions, holiday, DST and a late correction | Session and revision shown correctly; chart gap and prior close are not fabricated |
| FIN-T04 | Switch line/candle, range and asset class; request unsupported intervals | One renderer supports valid series; unavailable chart mode explains why; no silent timeframe substitution |
| FIN-T05 | Compare EG trend/strategy fixture to chart and scanner | Identical versioned flips and proposal timestamps; overlays align to finalized bars; M4 viewport decimation cannot change indicator output |
| FIN-T06 | Import CSV twice, with duplicate/malformed/corporate-action rows | Preview reports errors and counts; same digest yields idempotent receipt; UI displays EG's resulting holdings and cost basis, not its own arithmetic |
| FIN-T07 | Portfolio fixture includes fees, dividends, FX, split, multiple lots and benchmark | Displayed totals and returns equal EG golden outputs; every figure has source, as-of, currency, session and method |
| FIN-T08 | DCA due, missed, failed, replayed and paper-filled cases | Plan and event states are distinct; no contribution silently skipped/doubled; paper fill never appears live |
| FIN-T09 | Recommendation has thin history, warmup, drift or missing scorecard | Explicit abstention and evidence reason; no buy/sell command from recommendation view |
| FIN-T10 | Leverage policy absent, approval lease absent, denied approver, prohibited jurisdiction and allowed paper simulation | No live order affordance or request bypass; backend denial remains authoritative; risk levels labeled simulation |
| FIN-T11 | Alert event is redelivered or channel fails | One visible logical alert with delivery/retry status; outbox identity preserved |
| FIN-T12 | Offline PWA opens with cached screen state | Shell works; stale prices, account totals and order status are marked stale and cannot be mistaken for current |

## Interaction and visual acceptance

- Exercise mobile viewport and touch hardware as well as desktop: bottom navigation/side rail, group tabs, Basic/Holdings, detail tabs, chart gestures, keyboard equivalents, range controls and modal focus return.
- Compare each Markets, News, Calendar, Portfolio and detail state against the interaction reference screenshots. Record screenshots and a review decision; use original branding and licensed logos only.
- Run accessibility checks for names/roles, focus order, 200% zoom, reduced motion, contrast, screen reader chart summary and non-color trend labels. Follow EH-653 guidance. Ensure missing data is announced without repeatedly interrupting the user.
- Verify chart performance with representative 1,000-instrument paged scanner data and several months of history on an agreed mobile profile. Record memory, frame rate, response latency and payload size. Failure must be visible and bounded, never a browser freeze.

## Integration and quality gates

Run the repository's prescribed lint, typecheck, unit, browser, accessibility and build gates on changed code. The Finance vertical slice additionally requires provider entitlement/capability evidence and EH-715 owner golden fixtures. Use CCCC, jscpd and dupehound on touched source; inspect reports for new high-complexity or duplicate paths. A KISS review must trace each new adapter/component to a required contract and identify existing wiring reused. Changes to owner APIs need consumer-driven contract tests and backward compatibility review.

No acceptance gate is satisfied by a placeholder Emerald widget, paper quote or fixture masquerading as live data. Record exact provenance for any provider-backed test and keep secrets/account exports out of test artifacts.
