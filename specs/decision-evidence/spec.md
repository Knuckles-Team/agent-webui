# Decision evidence and calibration

**ID:** WEBUI-DECIDE-001
**Owner:** agent-webui
**Program IDs:** EH-046, EH-047
**Delivery:** specified; existing source requires current-main and browser acceptance audit
**Acceptance:** open

## Outcome and boundaries

A reader can inspect why a governed decision selected an option, why an alternative lost, which premises and constraints were used, and whether independently evaluated calibration supports a claimed risk or coverage level. The view presents evidence returned by the authenticated Graph OS API; it never recomputes an authoritative decision, invents confidence, or converts a diagnostic into permission to act.

Actors are a tenant reader, an operator investigating a decision, and an accessibility user using keyboard or screen reader. A reader sees only decisions and evaluation receipts authorized for their tenant and purpose. An operator can diagnose unavailable data without receiving hidden premises from another tenant. This spec owns WebUI presentation and browser adaptation; the database owns decision records and evaluation data, and Graph OS owns caller authorization and the read contract.

## User stories and acceptance

1. Given an authorized decision with a certificate, I can select an option and trace selected outcome, premise classes, derivations, constraints, and why-not explanations to stable record identifiers. Missing fields are labeled unavailable, never filled with generated prose.
2. Given a decision with no evaluation or insufficient independently labeled samples, I see an explicit `not evaluated` or `insufficient evidence` state. No coverage or risk bound is displayed.
3. Given a valid evaluation receipt, I can distinguish observed coverage, target coverage, risk, sample count, cohort, evaluation window, method/version and data provenance. A changed decision/model or expired receipt visibly invalidates the prior display.
4. Given denied or cross-tenant reads, I receive a generic access state with no sensitive record body, stack trace or existence leak. Network failure, stale response and empty collection are distinguishable.

## Functional requirements

| Requirement | Behavior | Program ID | Acceptance evidence |
|---|---|---|---|
| DEC-01 | Typed explorer renders chosen and excluded options with cited premise/derivation identifiers, certificate and violations | EH-046 | Contract fixture and rendered route test |
| DEC-02 | Why-not is requested on demand with a bounded solve budget; timeout or refusal is visible without mutating the original decision | EH-046 | Timeout/refusal integration fixture |
| DEC-03 | Evaluation dashboard labels cohort, sample count, source class, window, target/observed coverage, risk and receipt version independently | EH-047 | Independent-label fixture and rendered test |
| DEC-04 | No numeric coverage, calibration or deployment claim appears for synthetic-only, missing or underpowered evaluation | EH-047 | Negative fixtures for each case |
| DEC-05 | Tenant and purpose changes invalidate cached decision/evaluation queries, and stale responses cannot overwrite a newer selection | EH-046, EH-047 | Two-tenant browser test |
| DEC-06 | All explanation structure is usable without color, hover or pointer-only controls | EH-046, EH-047 | Keyboard and accessibility test |

## Completion

`BUILT` requires a merged WebUI commit containing the real route, typed client and tests. `ACCEPTED` additionally requires a browser run against a provisioned Graph OS test service with an independent labeled evaluation fixture and authorized/denied identities, plus recorded exact commit and test evidence in `tasks.md`. Source existing on a branch is not acceptance. Graph OS or database rows must be accepted by their respective owners.
