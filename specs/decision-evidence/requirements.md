# WEBUI-DECIDE-001 requirements

Every requirement this specification owns, with the proof that closes it. Delivery state and
public evidence for each ID are recorded in [`status.json`](status.json); this file defines what
each ID means. The design is in [`spec.md`](spec.md) and [`plan.md`](plan.md), the test contract
in [`test-spec.md`](test-spec.md), and the work order in [`tasks.md`](tasks.md).

| ID | Requirement | Verification |
|---|---|---|
| `WEBUI-DECIDE-R001` | **Evaluation dashboard shows calibration and coverage.** A dashboard presents decision evaluation calibration and coverage metrics — cohort, sample count, source class, evaluation window, target versus observed coverage, risk, and receipt version — as independently labeled fields, and shows no numeric coverage, calibration or deployment claim when the evaluation is synthetic-only, missing or underpowered. | Independent-label fixture tests plus negative fixtures for the synthetic-only, missing, and underpowered cases. |
| `DEC-01` | **Decision explorer cites premises, derivations and certificate.** A typed decision explorer renders the chosen and excluded options for a decision, citing the premise and derivation identifiers, the certificate, and any violations that applied. | Contract fixture and rendered route tests. |
| `DEC-02` | **Why-not explanations run on demand within a bounded budget.** A why-not explanation is computed on demand within a bounded solve budget, and a timeout or refusal is shown to the reader without altering the original decision record. | Timeout and refusal integration fixture tests. |
| `DEC-03` | **Dashboard labels each evaluation field independently.** The evaluation dashboard labels cohort, sample count, source class, evaluation window, target and observed coverage, risk, and receipt version as separate, independently sourced fields rather than a single combined claim. | Independent-label fixture and rendered dashboard tests. |
| `DEC-04` | **No coverage claim shown for inadequate evaluation data.** The dashboard shows no numeric coverage, calibration or deployment claim when the underlying evaluation is synthetic-only, missing, or underpowered. | Negative fixture tests for each of the synthetic-only, missing, and underpowered cases. |
| `DEC-05` | **Tenant or purpose change invalidates cached decision queries.** Changing tenant or purpose invalidates any cached decision or evaluation query, and a stale response can never overwrite a result from a newer selection. | Two-tenant browser test exercising cache invalidation and stale-response ordering. |
| `DEC-06` | **Explanation views work without color, hover or pointer.** Every part of the decision explanation structure is usable without relying on color alone, hover-only reveal, or pointer-only controls. | Keyboard and accessibility tests covering the full explanation structure. |
| `WEBUI-DECIDE-R002` | **Decision explorer surfaces premises, derivations and violations.** The decision explorer presents a selected decision's premise classes, derivations, certificate, why-not explanation and violations through the WebUI, backed by typed calls to the Graph OS read API. | Component tests cover the explorer's rendering logic, plus a browser integration test against an authenticated Keycloak-backed Graph OS session. |
