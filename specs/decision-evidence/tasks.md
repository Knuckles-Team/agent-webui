# Decision evidence delivery

**State legend:** SPECIFIED means design reviewed. BUILDING means an implementation branch exists. BUILT means exact source is merged. ACCEPTED means every acceptance gate has evidence. Current state: **SPECIFIED**. No acceptance receipt is asserted.

- [ ] Inventory current decision UI and generated Arbora read methods on current main. Document the exact operation names here before implementation.
- [ ] Add typed decision and evaluation adapters with validation, scoped cache keys and race cancellation.
- [ ] Render selected/why-not/certificate/premises and calibration states using existing view and renderer components.
- [ ] Add fixture, FastAPI/contract, rendered, browser tenant-isolation and accessibility tests from `test-spec.md`.
- [ ] Run all specified quality/build gates on the exact implementation commit and fix attributable findings.
- [ ] Record merged commit and CI/browser evidence, then independently review each requirement and change state to ACCEPTED only when complete.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `OVERSTORY-DECIDE-R001`, `OVERSTORY-DECIDE-R002`, `OVERSTORY-DECIDE-R003`, `OVERSTORY-DECIDE-R004`, `OVERSTORY-DECIDE-R005`, `OVERSTORY-DECIDE-R006`, `OVERSTORY-DECIDE-R007`, `OVERSTORY-DECIDE-R008`.

## Why-not on demand (OVERSTORY-DECIDE-R004)

- [x] Add `DecisionsTransport.getWhyNotOnDemand` plus a bounded-budget request helper in `DecisionDetailPanel.tsx`. An abort past the caller's budget resolves `{ kind: 'timeout' }` instead of rejecting, and a server refusal resolves `{ kind: 'refused', reason }` — neither path mutates the rendered `DecisionRecord` (OVERSTORY-DECIDE-R004). Fixture-level success/timeout/refusal coverage: `src/components/decisions/__tests__/DecisionDetailPanel.test.tsx`. No production Arbora transport is wired up yet (see `decisions-transport.ts`'s file doc). Wiring one is future work.
