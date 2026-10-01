# Decision evidence delivery

**State legend:** SPECIFIED means design reviewed; BUILDING means an implementation branch exists; BUILT means exact source is merged; ACCEPTED means every acceptance gate has evidence. Current state: **SPECIFIED**. No acceptance receipt is asserted.

- [ ] Inventory current decision UI and generated Graph OS read methods on current main; document the exact operation names here before implementation.
- [ ] Add typed decision and evaluation adapters with validation, scoped cache keys and race cancellation.
- [ ] Render selected/why-not/certificate/premises and calibration states using existing view and renderer components.
- [ ] Add fixture, FastAPI/contract, rendered, browser tenant-isolation and accessibility tests from `test-spec.md`.
- [ ] Run all specified quality/build gates on the exact implementation commit and fix attributable findings.
- [ ] Record merged commit and CI/browser evidence, then independently review each requirement and change state to ACCEPTED only when complete.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-DECIDE-R001`, `WEBUI-DECIDE-R002`, `DEC-01`, `DEC-02`, `DEC-03`, `DEC-04`, `DEC-05`, `DEC-06`.
