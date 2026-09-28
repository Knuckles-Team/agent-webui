# Browser identity verification

| Case | Fixture / level | Expected result |
|---|---|---|
| Bootstrap on loopback with ack | Host + browser | Banner and doctor visible; no public bind |
| Bootstrap off loopback or no ack | Host negative | Startup/request fails closed; no protected route access |
| Local sign-in and sign-out | Browser + disposable identity store | New opaque session, old ID invalid, logout revokes |
| CSRF/malicious Origin/Host | Host adversarial | Mutations denied; no token or protected body returned |
| Password reset and unknown user | API/browser | Uniform user-facing response; successful token one-use and bounded |
| TOTP/WebAuthn/recovery | Browser/test authenticator | Correct challenge works; replay, wrong origin and consumed code fail |
| Admin policy and mapping preview | Generated API contract + browser two principals | Admin permitted, member denied, preview has no write side effect |
| Elevation request/approve/revoke | Browser plus Graph OS contract | Two-person/step-up requirements, scope and expiry enforced; revocation visible |
| Session/tenant change during request | Browser race fixture | Prior tenant cache and privileged controls cleared |
| Accessibility | Playwright keyboard and screen-reader assertions | Focus management, labels, errors and tabs usable |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, `uv run --all-extras pytest agent/agent_webui/__tests__` and exact-head CI. Browser jobs provision the local store or test OIDC provider; a live shared realm is optional evidence, not a prerequisite for an external PR. Run `pre-commit run --config .config/pre-commit.yaml --all-files`; CCCC permits no new function above cyclomatic 10/cognitive 15 and no regression. Run configured jscpd and Dupehound if present and record their configured thresholds; otherwise track the missing gate. KISS forbids parallel auth/approval policy paths. Record fixtures, command exit codes and merged commit in `tasks.md`.
