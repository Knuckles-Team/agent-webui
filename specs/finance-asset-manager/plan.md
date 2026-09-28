# Finance Asset Manager — implementation and architecture plan

## Dependency order

1. Inventory the served finance capabilities and provider entitlements. Verify that EH-411–EH-423 finance core and EH-427/EH-653 frontend prerequisites are actually exposed at the gateway; a historical ledger label alone does not prove runtime availability.
2. Agree typed read/write projection contracts with `graph-os`, `epistemic-graph` and Emerald. Build the smallest vertical slice: one venue, persisted candles, a scanner snapshot, a single route and the reusable chart.
3. Add sessions, portfolio groups, performance and account import. Bind each figure to evidence and data-quality metadata before showing it as a fact.
4. Add strategy, DCA, leverage and alert views only after the corresponding owner operations exist. Keep paper, proposed and live states separate.
5. Run owner-contract, accessibility, mobile, visual and performance gates. Reconcile ledger rows with merged evidence and then update spec state.

## Contracts to agree before implementation

The names below are design shapes, not claims that an endpoint exists today. The gateway should expose a single canonical operation for each capability to REST/MCP as appropriate, and the WebUI host should adapt browser-safe requests to those operations.

| Projection | Required fields and semantics | Owner |
|---|---|---|
| Instrument search / group snapshot | Stable instrument and listing IDs, venue, asset class, session calendar, group membership, entitlement, result cap, freshness | EG + gateway |
| Quotes / candles / scalar series | Instrument + venue + source, currency, price basis (adjusted/unadjusted), timeframe, calendar/session, UTC event/as-of times, completeness/gaps, revision, provenance, bounded cursor | Emerald → SDK → EG → gateway |
| Portfolio snapshot | Account/group/holding IDs, quantities and monetary values as fixed-point decimal strings with currency, method and valuation as-of, source and session, benchmark identity and comparison method | EG → gateway |
| Strategy/evidence snapshot | Strategy ID/version/parameter hash, BacktestRun evidence, action proposal or abstention, calibration/scorecard, immutable AnalysisSnapshot ID | EG/Decide + AU → gateway |
| Alerts and DCA plans | Rule/plan ID, cadence and timezone, state, due/missed/failed events, deduplication key, paper/live mode, delivery receipt | EG + Graph OS |
| Account import | Mapping preview, normalized field errors, source-file digest, dry-run counts, idempotent import receipt and authoritative accounting refresh | Emerald/SDK + EG |

Never infer a venue or asset from a ticker alone. Unsupported timeframe, missing permissions, stale source, no holdings and a failing endpoint have different UI states. Display a data-quality explanation and keep the last known as-of visible; do not fabricate zeros. No browser-owned vendor credentials or raw account export persistence.

## Reuse and wiring decisions

- Add the Finance route through the existing route registry, shell and permission filtering. Use the current gateway client and server host authorization; do not create a second direct browser-to-EG path.
- Extend Atlas's `ResultShape='series'` deliberately with a typed series projection. Its renderer registry currently has graph2d, graph3d, table, JSON and raw renderers; register one financial `ChartRenderer` there and reuse its display component in Finance. Candle acceptance requires valid OHLC fields; generic numeric rows do not silently become candles.
- The chart accepts already-computed indicator and event series from EG. Render clipping and server M4 decimation occur after calculation. Persist view presets as versioned user configuration through the gateway; keep chart-library choice behind a component boundary. Evaluate Lightweight Charts as the first candidate, including license attribution and plugin coverage, before pinning a dependency.
- Use WebMCP's existing controller pattern for navigation, instrument/timeframe selection and layer toggles. Tool calls obey the same route permissions and cannot issue orders.
- Route news, earnings/dividend calendar, logos and account reads through qualified connectors and gateway projections. Preserve source license and attribution metadata. Use the existing outbox/delivery channels for alert status.
- Amounts from EG remain decimal strings until formatted for display. Local calculations are limited to visual layout and bounded presentation transforms; authoritative portfolio, return, leverage and recommendation math stays at EG.

## Chart and mobile design

One time axis drives candles, volume and overlays. Preserve gaps, exchange closures, after-hours session color, late corrections and source revisions. Touch crosshair and pinch zoom must coexist with vertical page scroll; keyboard controls and a text/table equivalent expose chart data without pointer use. Present an explicit legend, contrast-safe markers, non-color state labels, reduced-motion behavior and screen-reader summaries.

For a 1,000-instrument universe, do not fetch full history into the browser or run a full-universe scan on route render. Use capped scanner pages, viewport history with cursors and bounded deltas. Record mobile interaction latency, memory and chart frame rate against an agreed device/network profile. Degrade to a smaller range or fewer overlays with a visible explanation rather than silently dropping observations.

## Cross-repository specification map

These are dependency references to be resolved to owner-native specs as the repository-wide spec conversion lands. The canonical source IDs remain in the workspace ledger until each owner spec has a verified implementation link.

| Owner repo | Required spec concern | Rows |
|---|---|---|
| [epistemic-graph](https://github.com/Knuckles-Team/epistemic-graph) | finance-v1 accounts, activities, lots, sessions, accounting, strategy, backtest, Decide, leverage, golden fixtures | EH-698–EH-700, EH-702–EH-704, EH-706, EH-715 |
| [agent-connector-sdk](https://github.com/Knuckles-Team/agent-connector-sdk) / [emerald-exchange](https://github.com/Knuckles-Team/emerald-exchange) | qualified stock/FX/commodity sources, account and CSV import, governed execution | EH-701, EH-709, EH-713; EH-423 |
| [graph-os](https://github.com/Knuckles-Team/graph-os) | browser API projection, DCA scheduling, alerts/outbox and identity | EH-705, EH-712 |
| [agent-utilities](https://github.com/Knuckles-Team/agent-utilities) | agent workflows, scorecards and research orchestration without duplicate finance math | EH-704, EH-705 |
| [media-downloader](https://github.com/Knuckles-Team/media-downloader) / Emerald skills | media-watch intake and gold leverage guide | EH-707, EH-708 |
| [agent-webui](https://github.com/Knuckles-Team/agent-webui) | Markets workspace and shared ChartRenderer | EH-710, EH-711 |

## Design controls

Before adding any component, inventory existing route, chart, gateway, permission and import wiring. Keep one component/operation per responsibility and share typed contracts instead of copying logic. Use CCCC for complexity/readability, jscpd and dupehound for duplicate detection, and KISS review to challenge unnecessary abstractions. Apply the repository's actual CI thresholds; this spec does not invent numerical caps. No new baseline or suppressions may conceal a regression without a reviewed reason.
