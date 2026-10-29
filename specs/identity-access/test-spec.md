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
| Elevation request/approve/revoke | Browser plus Arbora contract | Two-person/step-up requirements, scope and expiry enforced; revocation visible |
| Session/tenant change during request | Browser race fixture | Prior tenant cache and privileged controls cleared |
| Accessibility | Playwright keyboard and screen-reader assertions | Focus management, labels, errors and tabs usable |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, `uv run --all-extras pytest agent/agent_webui/__tests__` and exact-head CI. Browser jobs provision the local store or test OIDC provider. A live shared realm is optional evidence, not a prerequisite for an external PR. Run `pre-commit run --config .config/pre-commit.yaml --all-files`. CCCC permits no new function above cyclomatic 10/cognitive 15 and no regression. Run configured jscpd and Dupehound if present and record their configured thresholds. Otherwise track the missing gate. KISS forbids parallel auth/approval policy paths. Record fixtures, command exit codes and merged commit in `tasks.md`.

## No-auth, EG and external OIDC acceptance

These are planned cases, not passing receipts. Record exact installed WebUI/Arbora/EG versions, browser and mode configuration with secrets redacted.

| Requirement | Required proof |
|---|---|
| OVERSTORY-IDENTITY-R003.1 | The installed no-auth stack completes declared anonymous-policy journeys. It rejects out-of-scope/identity-required operations, cross-origin requests and accidental public exposure. UI/tool results identify the same anonymous scope. |
| OVERSTORY-IDENTITY-R003.2 | Test real composed EG login/session/use/logout with valid, invalid, expired, revoked and wrong-tenant sessions. Check HTTP/WebSocket parity and token protection. |
| OVERSTORY-IDENTITY-R003.3 | Test OIDC protocol fixtures and each claimed live provider. Reject wrong issuer/audience/state, replay, unavailable discovery/JWKS and incomplete configuration. Unavailable live-provider evidence remains explicit. |
| OVERSTORY-IDENTITY-R010 | Test long-running HTTP/stream/WebSocket and manual/WebMCP flows across renewal, expiry, revocation/logout, multiple tabs and mode changes. Reject privilege carryover, duplicate effects and hidden downgrade. |

Test public shell reachability, unauthorized API refusal in authenticated modes, authorized API success and expired/revoked sessions. Cover tenant separation, CSRF, login fixation, logout, WebSocket context binding, renewal and attended browser-control restrictions. Run manual and native WebMCP parity against the same mode/role fixtures. No-auth must pass genuine declared anonymous operations without inventing authenticated identity; disabled identity-dependent actions remain visibly explained. A startup-only fake-boundary test, browser fixture or successful upstream no-auth call alone does not qualify the installed browser stack. Provider-specific live evidence is required before claiming Keycloak or Okta production qualification; protocol fixtures remain useful but separately labelled.

Exercise real enhanced file/config/editor handlers in no-auth: the interim implementation must refuse direct effects. Full R003.1 acceptance requires positive and adversarial tests of migrated canonical operations. Cover containment, exact target/action binding, confirmation and native consume-once/CAS. R003.2/R010 require installed caller propagation across real awaits/dispatch, expired/revoked sessions and WebSocket renewal. A denied inactive adapter proves safety, not functional completion.

## Source configuration children

| Child | Source evidence or remaining acceptance |
|---|---|
| OVERSTORY-IDENTITY-R003.1.1 | `tests/test_explicit_auth_modes.py` checks explicit anonymous policy and refusal, not positive governed effects. Register probe routes through `application_composer` before the SPA mount so the same checks run against installed candidate wheels with packaged assets. |
| OVERSTORY-IDENTITY-R003.1.2 | Installed anonymous journeys, UI/WebMCP parity and native effects remain open. |
| OVERSTORY-IDENTITY-R003.2.1 | `tests/test_explicit_auth_modes.py` refuses missing or untyped EG owners. |
| OVERSTORY-IDENTITY-R003.2.2 | Installed EG login/session/logout and HTTP/WebSocket qualification remain open. |
| OVERSTORY-IDENTITY-R003.3.1 | `tests/test_explicit_auth_modes.py` refuses incompatible EG ownership and incomplete browser OIDC setup. |
| OVERSTORY-IDENTITY-R003.3.2 | OIDC protocol fixtures and live provider acceptance remain open. |

The source markers cover only configuration and refusal behavior. R003.1, R003.2 and R003.3 retain every original parent requirement. R010 renewal and mode-transition acceptance remains open.

For the bounded R010 HTTP expiry repair, exercise `/auth/session` through the same session resolver as API traffic. An expired session with no usable renewal must report unauthenticated. Both session-status and API responses must expire its browser cookie chunks. Successful renewal must return the refreshed status and persist the renewed cookies. This does not close the full R010 concurrency, stream, WebSocket or mode-transition acceptance.
For bounded R010 mounted identity revalidation, share one in-flight session read across mounted consumers. Revalidate on expiry, focus, reconnect and visibility. API authentication refusal and cross-tab logout hints immediately retire displayed authority and CSRF. Revalidate hints with the server; never trust identity data from browser storage. Discard responses that began before invalidation. Test successful renewal, refusal and stale responses with mounted consumers. Keep full provider, streaming, native-effect and concurrent producer-renewal acceptance open.

Session reads have a ten-second deadline. A hung or refused read retires cached
identity and CSRF. A later focus or reconnect recovers from a fresh server
answer. Broker logout broadcasts only after success. Standalone redirect logout
keeps its server navigation. Authenticated tabs schedule a read within sixty
seconds, even if an earlier read preceded logout completion. Request deadlines
add up to ten seconds. Background browser throttling may extend this delay.
A click-time hint does not prove completed server logout.

Reproduce installed-candidate evidence with `tests/qualification/run_installed.py`.
Its prerequisites and source mappings are in `tests/qualification/README.md`.
Opt-in skips are not acceptance. Synthetic protocol and browser results do not close live-provider or native EG acceptance.

The qualification files must retain collected items when opt-in is absent.
A diff-scoped run must report explicit skips instead of no tests.
Runner regressions check source/config isolation and propagate protocol failures, including empty collection.
Explicit opt-in with missing prerequisites must fail, not skip.

## Workspace account evidence boundaries

| Child | Required proof |
|---|---|
| OVERSTORY-IDENTITY-R004.1 | Render the real Work entry with the existing account menu. Verify its labeled compact trigger, keyboard opening, Escape and focus restoration. With fixture identity and mocked HTTP responses, verify sign-out posts with same-origin credentials and CSRF, redirects only after success and visibly reports refusal. |
| OVERSTORY-IDENTITY-R004.2 | Exercise every original parent account flow against installed browser and native producer versions. Prove session-fixation resistance, CSRF refusal, logout and cookie replay refusal, bounded one-use recovery and no browser-persisted credentials. |

The R004.1 source tests are in `UserMenu.test.tsx` and `AppWorkspaceEntry.test.tsx`. They do not establish native session revocation, installed authentication, measured mobile layout or full screen-reader/accessibility acceptance. The R004 parent and R009 retain those separate obligations.
