# OVERSTORY — Test and acceptance specification

**Status:** SPECIFIED. Requirements: [spec.md](spec.md). Tests use deterministic public/synthetic fixtures with no credentials or private account exports. Live integration evidence must identify commit, service versions, environment class, date and provider entitlement without disclosing secrets.

| Test | Requirement | Level and setup | Expected observation |
|---|---|---|---|
| FIN-T01 | OVERSTORY-R004, OVERSTORY-R016 | Browser at 375px, 768px, 1440px. Keyboard, touch and screen reader | Mobile bottom bar/desktop rail offer five destinations. Selected group/tab/range persists. Focus and labels are coherent. |
| FIN-T02 | OVERSTORY-R005 | Component and API fixture for loading, empty, stale, partial, 401/403, 404/501 and network failure | Each is distinct and announced. Unavailable or denied never appears as an empty portfolio. |
| FIN-T03 | OVERSTORY-R006 | Two identical tickers on different venues and quote currencies | Search and detail retain stable listing/venue IDs. No mixed quote, candle or account association. |
| FIN-T04 | OVERSTORY-R007 | Quote fixtures for regular/pre/post, delayed, missing and licensed/unlicensed logos | Session, as-of, source and previous close stay correct. The after-hours value is separate. An unlicensed logo has a text fallback. A missing price is not zero. |
| FIN-T05 | OVERSTORY-R008, OVERSTORY-R009 | Unit and browser fixture with scalar, complete OHLC, invalid OHLC, gaps, corrections and unsupported timeframe | One renderer works in Finance and Atlas. Candle mode accepts only valid OHLC. Gaps persist. Revised bar replaces by ID. Unsupported mode states why. |
| FIN-T06 | OVERSTORY-R009, OVERSTORY-R010 | Owner fixture with finalized trend flip, DCA buy, cost basis and simulated margin level. Compare full-resolution and decimated display views | Markers align to bar IDs and versions. Trend output does not change with viewport decimation. Simulation is labeled. |
| FIN-T07 | OVERSTORY-R011 | Contract fixture. It has multi-currency cash flows, a dividend, a split and fees. It has a stale property valuation and two named benchmarks. | The UI equals the owner decimal-string outputs. No JS code recomputes finance values. The UI lists method, currency, source, as-of and session. It also lists the stale label. |
| FIN-T08 | OVERSTORY-R012 | Recommendation fixture: calibrated proposal, thin history, warmup, drift and missing scorecard | Evidence/strategy version shown. Abstention reason explicit. No order request can originate from panel. |
| FIN-T09 | OVERSTORY-R013 | DCA and alert fixtures: due, missed, failed, replayed, paper fill, channel retry | States and receipts are distinct. Duplicate event ID appears once logically. Paper fill is never live. |
| FIN-T10 | OVERSTORY-R014 | CSV fixture with mapped/unmapped columns, malformed row and duplicate digest. Preview then retry import | Preview reports counts/errors. Same digest returns same logical receipt. Holdings refresh from owner response, not UI math. |
| FIN-T11 | OVERSTORY-R015 | Offline PWA shell after a previously valid finance view | Cached quote, account and alert state marked stale; current-data actions unavailable. |
| FIN-T12 | OVERSTORY-R012, OVERSTORY-R016 | Authenticated, unauthenticated and wrong-account requests. A malformed wire payload and an invalid decimal. A prohibited instrument. A missing approval lease. | The host denies unauthorized scope. The UI handles shape failure. No client path bypasses governed execution. |
| FIN-T13 | OVERSTORY-R004–OVERSTORY-R016 | 200% zoom, reduced motion, keyboard-only chart, high contrast and screen reader inspection | No control is clipped. No focus trap exists. No meaning relies on color alone. The chart has a text or table equivalent and an accessible summary. |
| FIN-T14 | OVERSTORY-R004, OVERSTORY-R008, OVERSTORY-R009 | Paged 1,000-instrument fixture and multi-month series on an agreed mobile device/network | Capture payload, memory, interaction latency and frame rate. No full-universe history fetch occurs. The UI does not freeze. Approve the threshold and device profile before calling this a pass. |

## Fixtures and contract rules

Place small synthetic fixtures under normal test directories, with stable IDs and ISO UTC times. Cover exchange holidays and DST, pre/post sessions, source correction revision, duplicate/out-of-order bars, unsupported intervals, missing history, same ticker on two venues, decimal money, CSV idempotency, and unavailable provider capability. Owner golden fixtures certify accounting, futures rolls, leveraged-ETF decay and broker statement parity; the WebUI tests assert only faithful display and refusal to fabricate. No fixture is presented as live data.

Consumer contract tests validate the exact Zod schemas and structured errors in [plan.md](plan.md). The served-path suite must exercise browser → FastAPI host → authenticated gateway projection with a test tenant. Mock-only component tests cannot satisfy this gate. Record the owner revision and fixture ID used by both sides.

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

Run `python3 scripts/check_complexity_staged.py` through the staged hook for supported source changes. Record CCCC output. jscpd and dupehound have no configured repository command or threshold at this revision. Document the agreed command/threshold and result before marking source implementation green. KISS review records which existing route, gateway, Atlas renderer and auth mechanisms were reused. Tests or gates omitted because a capability is absent remain PENDING, with a reason and owner in [tasks.md](tasks.md). Every pass must link a commit/PR and output artifact. No self-updating baseline or suppression substitutes for a fix.
