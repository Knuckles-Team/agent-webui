# Browser identity, administration and elevation

**ID:** WEBUI-IDENTITY-001
**Owner:** agent-webui
**Program IDs:** EH-405, EH-543, EH-544, EH-545, EH-546, EH-621
**Delivery:** specified; current source requires audit
**Acceptance:** open

## Outcome and actors

A visitor can understand the configured sign-in mode, authenticate or use an explicitly local bootstrap mode, manage their session and MFA, and an authorized administrator can manage identity policy through the Graph OS identity API. A permitted user can request elevation and see an auditable approve/revoke state. Browser controls never grant a role or capability by changing local state alone.

Actors are visitor, authenticated member, identity administrator, elevation requester and separate approver. The same protected route rules apply to REST, streaming and WebSocket entry points. Local bootstrap is allowed only on loopback with explicit operator acknowledgment and visible banner; all non-loopback modes require verified identity. MFA is configurable globally and by group, not imposed unconditionally on all administrators.

## Requirements and acceptance

| ID | Required behavior | Program IDs | Acceptance |
|---|---|---|---|
| IDUI-01 | Mode wizard shows configured OIDC, local or loopback bootstrap and doctor result; no invisible auth bypass | EH-543, EH-546 | Mode-specific rendered + server tests |
| IDUI-02 | Local register/login/logout/forgot/reset/change-password use server sessions and anti-CSRF; no credential or bearer is stored in browser persistence | EH-544 | End-to-end session/fixation/CSRF probes |
| IDUI-03 | MFA enrollment, challenge and recovery cover TOTP and WebAuthn, with one-time recovery code handling | EH-545 | Positive, replay, lost-device tests |
| IDUI-04 | Admin tabs cover users, roles, groups, auth modes and mapping-rule dry run through typed `identity.*` operations | EH-546, EH-621 | Authorized/denied generated-client tests |
| IDUI-05 | Elevation request, approval and revocation display scope, reason, expiry and receipt; confirmation and step-up bind to the same caller and action | EH-405 | A2A/chat/UI parity and adversarial tests |
| IDUI-06 | Identity mode, tenant or session change invalidates cached protected data and closes active privileged interactions | EH-543–EH-546 | Two-principal browser test |
| IDUI-07 | All forms, errors, tab panels and modal confirmations are keyboard and screen-reader usable, with equivalent mobile behavior | all | Accessibility E2E |

Errors must avoid disclosing whether a username, tenant or protected record exists. A failed step-up never turns into a successful action after retry unless a new valid confirmation and receipt are obtained. The UI's role labels are explanatory; authorization comes from Graph OS and its delegated database scopes.

## Completion

BUILT requires merged WebUI source for each applicable requirement. ACCEPTED requires a fresh-checkout test identity service, real browser positive/negative probes, server/Graph OS contract tests and exact-commit CI evidence. If a backend operation is not available, that requirement remains open; a mock screen does not count as delivered. State and receipts belong in `tasks.md`.
