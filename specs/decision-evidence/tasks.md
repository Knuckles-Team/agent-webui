# Decision evidence delivery

**State legend:** SPECIFIED means design reviewed; BUILDING means an implementation branch exists; BUILT means exact source is merged; ACCEPTED means every acceptance gate has evidence. Current state: **SPECIFIED**. No acceptance receipt is asserted.

- [ ] Inventory current decision UI and generated Graph OS read methods on current main; document the exact operation names here before implementation.
- [ ] Add typed decision and evaluation adapters with validation, scoped cache keys and race cancellation.
- [ ] Render selected/why-not/certificate/premises and calibration states using existing view and renderer components.
- [ ] Add fixture, FastAPI/contract, rendered, browser tenant-isolation and accessibility tests from `test-spec.md`.
- [ ] Run all specified quality/build gates on the exact implementation commit and fix attributable findings.
- [ ] Record merged commit and CI/browser evidence, then independently review each requirement and change state to ACCEPTED only when complete.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-DECIDE-R001`, `WEBUI-DECIDE-R002`, `DEC-01`, `DEC-02`, `DEC-03`, `DEC-04`, `DEC-05`, `DEC-06`.

## Why-not on demand (DEC-02)

- [x] Add `DecisionsTransport.getWhyNotOnDemand` plus a bounded-budget request helper in `DecisionDetailPanel.tsx`; an abort past the caller's budget resolves `{ kind: 'timeout' }` instead of rejecting, and a server refusal resolves `{ kind: 'refused', reason }` — neither path mutates the rendered `DecisionRecord` (DEC-02). Fixture-level success/timeout/refusal coverage: `src/components/decisions/__tests__/DecisionDetailPanel.test.tsx`. No production Graph OS transport is wired up yet (see `decisions-transport.ts`'s file doc); wiring one is future work.
