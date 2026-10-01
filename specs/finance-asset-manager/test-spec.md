# FIN-UI-001 — Test and acceptance specification

**Status:** SPECIFIED. Requirements: [spec.md](spec.md). Tests use deterministic public/synthetic fixtures with no credentials or private account exports. Live integration evidence must identify commit, service versions, environment class, date and provider entitlement without disclosing secrets.

| Test | Requirement | Level and setup | Expected observation |
|---|---|---|---|
| FIN-T01 | FUI-01, FUI-13 | Browser at 375px, 768px, 1440px; keyboard, touch and screen reader | Mobile bottom bar/desktop rail offer five destinations; selected group/tab/range persists; focus and labels are coherent. |
| FIN-T02 | FUI-02 | Component and API fixture for loading, empty, stale, partial, 401/403, 404/501 and network failure | Each is distinct and announced; unavailable or denied never appears as an empty portfolio. |
| FIN-T03 | FUI-03 | Two identical tickers on different venues and quote currencies | Search and detail retain stable listing/venue IDs; no mixed quote, candle or account association. |
| FIN-T04 | FUI-04 | Quote fixtures for regular/pre/post, delayed, missing and licensed/unlicensed logos | Session/as-of/source and previous close remain correct; after-hours value is separate; unlicensed logo has text fallback; missing price is not zero. |
| FIN-T05 | FUI-05, FUI-06 | Unit and browser fixture with scalar, complete OHLC, invalid OHLC, gaps, corrections and unsupported timeframe | One renderer works in Finance and Atlas; candle mode only accepts valid OHLC; gaps persist; revised bar replaces by ID; unsupported mode states why. |
| FIN-T06 | FUI-06, FUI-07 | Owner fixture with finalized trend flip, DCA buy, cost basis and simulated margin level; compare full-resolution and decimated display views | Markers align to bar IDs and versions; trend output does not change with viewport decimation; simulation is labeled. |
| FIN-T07 | FUI-08 | Contract fixture with multi-currency cash flows, dividend, split, fees, stale property valuation, and two named benchmarks | UI equals owner decimal-string outputs; no JS finance recomputation; method/currency/source/as-of/session and stale label visible. |
| FIN-T08 | FUI-09 | Recommendation fixture: calibrated proposal, thin history, warmup, drift and missing scorecard | Evidence/strategy version shown; abstention reason explicit; no order request can originate from panel. |
| FIN-T09 | FUI-10 | DCA and alert fixtures: due, missed, failed, replayed, paper fill, channel retry | States and receipts are distinct; duplicate event ID appears once logically; paper fill is never live. |
| FIN-T10 | FUI-11 | CSV fixture with mapped/unmapped columns, malformed row and duplicate digest; preview then retry import | Preview reports counts/errors; same digest returns same logical receipt; holdings refresh from owner response, not UI math. |
| FIN-T11 | FUI-12 | Offline PWA shell after a previously valid finance view | Cached quote, account and alert state marked stale; current-data actions unavailable. |
| FIN-T12 | FUI-09, FUI-13 | Authenticated/unauthenticated and wrong-account requests, malformed wire payload, invalid decimal, prohibited instrument and missing approval lease | Host denies unauthorized scope; UI handles shape failure; no client path bypasses governed execution. |
| FIN-T13 | FUI-01–FUI-13 | 200% zoom, reduced motion, keyboard-only chart, high contrast and screen reader inspection | No clipped controls, focus traps or color-only meaning; chart has text/table equivalent and accessible summary. |
| FIN-T14 | FUI-01, FUI-05, FUI-06 | Paged 1,000-instrument fixture and multi-month series on an agreed mobile device/network | Capture payload, memory, interaction latency and frame rate; no full-universe history fetch or frozen UI. Threshold and device profile must be approved before calling this pass. |

## Fixtures and contract rules

Place small synthetic fixtures under normal test directories, with stable IDs and ISO UTC times. Cover exchange holidays and DST, pre/post sessions, source correction revision, duplicate/out-of-order bars, unsupported intervals, missing history, same ticker on two venues, decimal money, CSV idempotency, and unavailable provider capability. Owner golden fixtures certify accounting, futures rolls, leveraged-ETF decay and broker statement parity; the WebUI tests assert only faithful display and refusal to fabricate. No fixture is presented as live data.

Consumer contract tests validate the exact Zod schemas and structured errors in [plan.md](plan.md). The served-path suite must exercise browser → FastAPI host → authenticated gateway projection with a test tenant; mock-only component tests cannot satisfy this gate. Record the owner revision and fixture ID used by both sides.

## Visual, accessibility and security review

Review Markets, News, Calendar, Portfolio, group Basic/Holdings and instrument detail on phone and desktop. Use the interaction layout described in [spec.md](spec.md). Capture screenshots and a reviewer decision in a PR. Verify a real touch device or emulator for crosshair/pinch/scroll interaction. Check keyboard focus, role/name, 200% zoom, reduced motion, non-color trend labels, chart table summary and polite status announcements.

Exercise denial at both route and host, cross-account URL editing, hostile strings in news/notes, import errors, stream disconnect/reconnect, stale cache and no credential leakage. A service denial must remain authoritative even if the UI state is manipulated.

## Commands and evidence

For implementation, run from the repository root:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:e2e
pnpm run build
uv run --all-extras pytest agent/agent_webui/__tests__
pre-commit run --config .config/pre-commit.yaml --all-files
```

Run `python3 scripts/check_complexity_staged.py` through the staged hook for supported source changes. Record CCCC output. jscpd and dupehound have no configured repository command or threshold at this revision; document the agreed command/threshold and result before marking source implementation green. KISS review records which existing route, gateway, Atlas renderer and auth mechanisms were reused. Tests or gates omitted because a capability is absent remain PENDING, with a reason and owner in [tasks.md](tasks.md). Every pass must link a commit/PR and output artifact; no self-updating baseline or suppression substitutes for a fix.
