# FIN-UI-001 — Architecture and implementation design

**Status:** SPECIFIED. Governing requirements: [spec.md](spec.md). This design defines the WebUI contract proposal; paths in the proposed API table do not claim deployed endpoints exist.

## Existing system and reuse

The React app derives route rendering, sidebar, mobile layout and role filtering from `src/lib/nav-registry.ts` and `src/App.tsx`. The server applies its own role ladder in `agent/agent_webui/rbac.py`; hiding a route is not authorization. `src/lib/gateway.ts` already returns `{ok,data,unavailable,error}`, validates optional Zod response schemas and distinguishes HTTP 404/501 from empty results. `src/lib/atlas/types.ts` already recognizes a `series` result shape; `src/lib/atlas/renderers.ts` and `src/components/atlas/renderers/index.ts` own the renderer registry. No financial chart is registered in the inspected base. `src/lib/webmcp/atlas.tsx` shows the browser-controller pattern. These are the required integration points.

Use React Query for server state and component/context state for ephemeral UI state. Add a single finance API adapter using existing browser-safe gateway helpers and Zod schemas. Do not add a parallel router, provider client, auth store, chart registry, or browser-side finance calculation engine.

## Architecture and data flow

```text
Browser Finance route / Atlas series result
  -> shared ChartRenderer and finance view models
  -> validated WebUI API adapter
  -> WebUI FastAPI host with session and RBAC checks
  -> authenticated graph-os gateway
  -> epistemic-graph finance storage/compute
  -> Emerald Exchange + agent-connector-sdk for provider/account ingress and governed effects
```

`agent-utilities` may orchestrate research and backtests but does not own monetary calculations. The WebUI sends bounded read/filter/preset/import-preview requests; it never sends a broker order from a chart or recommendation action. A separate governed owner flow is required for any live effect.

## Proposed browser contract

The gateway and WebUI host should agree these operations before implementation. All lists are bounded and paginated; all writes require CSRF/session protection, authorization and an idempotency key where retryable. Return the existing validated gateway envelope and structured error code, rather than a successful HTTP 200 containing invented defaults.

| Operation | Proposed host route | Request and response contract |
|---|---|---|
| Search/list groups | `GET /api/finance/instruments`, `GET /api/finance/groups` | Query: search, universe/group, venue, assetClass, cursor, limit. Response: stable instrument/listing IDs, labels, venue, quote currency, session calendar, group IDs, coverage and next cursor. |
| Quote and series | `GET /api/finance/quotes`, `GET /api/finance/series` | Query: IDs, source, range, timeframe, priceBasis, cursor, limit. Response: typed scalar or OHLC/volume points, source, revision, currency, session and completeness. Unsupported timeframe returns an explicit error. |
| Portfolio | `GET /api/finance/portfolios`, `GET /api/finance/performance` | Account/group scope, holdings, position/lot references, values and returns as decimal strings, method, benchmark ID, currency, valuation as-of, data quality. |
| Strategy and analysis | `GET /api/finance/analysis` | Instrument/holding ID, immutable snapshot ID, strategy ID/version/parameter hash, evidence IDs, scorecard, action proposal or abstention and reason. No executable order object. |
| Alerts and DCA | `GET/POST /api/finance/alerts`, `GET/POST /api/finance/dca-plans` | Scoped rule/plan ID, cadence and timezone, event ID, dedupe key, due/missed/failed/delivered state, paper/live mode and receipt. Mutations require version precondition. |
| CSV import | `POST /api/finance/imports/preview`, `POST /api/finance/imports` | Multipart file to host only; mapping, per-row validation, source SHA-256 digest, dry-run counts, idempotency key, import receipt. Never put file contents in local storage. |

Define common `SourceStamp = {sourceId, observedAt, effectiveAt, asOf, session, revision, quality, delaySeconds?}`. Times are ISO-8601 UTC on the wire; exchange session and calendar are separate named fields. A money value is `{amount: decimal-string, currency: ISO-4217}`, never a JSON float. `SeriesPoint` carries a stable bar/event ID and timestamp. OHLC points require open/high/low/close and validate low ≤ open/close ≤ high; scalar points carry one value and units. A missing observation is a gap, not a zero or forward fill. `DataStatus` distinguishes valid, warming, stale, partial, unavailable and denied. A source correction increments revision and replaces the affected point by ID.

For trends, `SignalKey` includes instrument, venue, price basis, timeframe/calendar, algorithm version and parameter hash. A flip event has effective and observed times, finalized-bar ID, prior/new direction, source revision and evidence ID. The first computable direction is not fabricated into a flip. Chart, scanner and alerts consume this same event. `StrategySpec` is versioned and emits proposed actions only; DCA supports fixed amount/shares, cadence and value-averaging, and missed contributions remain visible. Backtest evidence includes costs and an out-of-sample/overfitting assessment before a claim enters a recommendation.

## Layout and chart design

The Markets workspace uses bottom navigation at mobile widths and the existing shell's side rail on desktop. Group tabs scroll horizontally; Basic/Holdings is an explicit mode. Instrument rows pair text with color, a licensed logo fallback, session clock, sparkline and prior-close line. Detail tabs are Chart, Rates, News, Notes, Dividends and Analysis. Portfolio ranges are 1D/1M/YTD/1Y/5Y/ALL; detail ranges are 1D/5D/1M/6M/1Y/5Y/MAX. Do not copy third-party branding.

Build one typed `ChartRenderer` component and register its Atlas wrapper in the existing registry. It draws line/area for scalar portfolios, funds and indices and candles for tradables only when complete OHLC exists. Volume is a separate pane. Trend, DCA, cost-basis and margin overlays share the time axis but retain their own evidence and simulation labels. A touch crosshair and pinch zoom must coexist with page scroll; keyboard navigation and a text/table representation expose equivalent facts. Keep the chart library behind the component; Lightweight Charts is a candidate, subject to attribution and capability review. Advanced Charts and Pine compatibility are separate products.

Indicators are computed by the owner from full required history before viewport clipping or EG M4 display decimation. The browser requests capped pages and bounded deltas, never full-universe history. A 1,000-instrument scanner loads pages rather than one request per symbol. Presets are versioned user configuration; migrate or reject incompatible versions explicitly.

## Failure, security and compatibility

The host refuses cross-account access even if a user edits a URL. The UI handles 401/403, 404/501 capability absence, malformed payload, stale/partial data, unsupported interval, empty account, interrupted import and disconnected stream separately. Retain the last trustworthy as-of and mark it stale. A cached PWA shell disables current-data and effect claims offline. Logos, news and market data must carry source rights/attribution; unlicensed assets use text fallback. Real estate is a manually valued holding with valuation date and no trade action. Live leverage remains paper-only in this UI until a separately certified per-instrument policy and approver flow exists.

Compatibility: add new typed routes and Atlas projection without changing existing row/graph renderers. Preserve the current `GatewayResult` behavior. Version wire schemas, strategy IDs and presets; validate unknown values rather than coercing them. No database migration belongs to this repository.

## Local setup and reproducible checks

Use Python 3.12–3.14, Node from `.node-version`, pnpm from `package.json`, and `uv`. From this repository root:

```bash
pnpm install --frozen-lockfile
uv venv --python 3.12
source .venv/bin/activate
uv pip install -e '.[test]'
cp .env.example .env
pnpm run dev:server
```

In a second terminal run `pnpm run dev`. `pnpm run dev:server` listens on port 38001; the Vite config listens on port 9000 and proxies `/api` to that backend. An authenticated Graph OS backend and provider entitlements are required for live integration; contract/UI tests use deterministic fixtures without credentials. Do not commit `.env`.

## Quality and delivery gates

Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, `uv run --all-extras pytest agent/agent_webui/__tests__`, and `pre-commit run --config .config/pre-commit.yaml --all-files` for a source implementation. For this documentation-only change, run the normal commit hooks and validate links/forbidden references. The local hook `complexity-staged` calls `python3 scripts/check_complexity_staged.py` on staged supported source and uses CCCC. jscpd and dupehound are required design-review concepts but no command or numeric threshold is configured in this repository; define approved tooling and thresholds before claiming those gates pass. KISS review must name reused route, gateway, renderer and auth wiring and justify every new abstraction. Do not install a self-calibrating baseline or suppress a finding to manufacture green.

## Cross-repository ownership

| Repository | Owner-native deliverable; interface consumed here | IDs |
|---|---|---|
| [epistemic-graph](https://github.com/Knuckles-Team/epistemic-graph) | finance-v1 accounts, activities, lots, reference sessions, fixed-point accounting, strategy/backtest/recommendation/leverage outputs and golden fixtures | EH-698–EH-700, EH-702–EH-704, EH-706, EH-715 |
| [agent-connector-sdk](https://github.com/Knuckles-Team/agent-connector-sdk) and [emerald-exchange](https://github.com/Knuckles-Team/emerald-exchange) | qualified stock/FX/commodity source and account/import transport; governed effect boundary | EH-701, EH-709, EH-713 |
| [graph-os](https://github.com/Knuckles-Team/graph-os) | authenticated finance projection, replay-safe DCA scheduling and outbox alert delivery | EH-705, EH-712 |
| [agent-utilities](https://github.com/Knuckles-Team/agent-utilities) | workflow orchestration without a duplicate finance math authority | EH-704, EH-705 |
| [media-downloader](https://github.com/Knuckles-Team/media-downloader) and Emerald skills | source intake, claim/evidence separation and leveraged-trading guide | EH-707, EH-708 |
| [agent-webui](https://github.com/Knuckles-Team/agent-webui) | this Markets workspace and shared chart | EH-710, EH-711 |
