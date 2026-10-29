# Browser identity delivery

**States:** SPECIFIED → BUILDING → BUILT (merged source) → ACCEPTED (evidence). Current: **SPECIFIED**; no merged-head acceptance audit has been recorded here.

- [ ] Inventory current identity host, Arbora `identity.*` operation names, elevation operation and auth-mode behavior on current main.
- [ ] Replace local bootstrap bypasses with explicit loopback/ack mode and mode doctor; add refusal tests.
- [ ] Implement server-side session/CSRF/local-auth flow and migration tests without browser token storage.
- [ ] Add MFA enrollment/challenge/recovery flows and adversarial browser tests.
- [ ] Connect admin tabs and mapping-rule preview to the generated identity client; delete duplicate direct routes after contract parity.
- [ ] Reuse the same elevation operation from UI, chat and A2A; test step-up, two-person approval, expiry and revocation.
- [ ] Run `test-spec.md` including hosted browser and accessibility cases on exact merged source; attach commit and evidence before acceptance.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `OVERSTORY-IDENTITY-R003`, `OVERSTORY-IDENTITY-R004`, `OVERSTORY-IDENTITY-R005`, `OVERSTORY-IDENTITY-R006`, `OVERSTORY-IDENTITY-R007`, `OVERSTORY-IDENTITY-R008`, `OVERSTORY-IDENTITY-R009`, `OVERSTORY-IDENTITY-R001`, `OVERSTORY-IDENTITY-R002`.

## Explicit mode delivery and acceptance

- [ ] OVERSTORY-IDENTITY-R003.1: Implement explicit no-auth mode with bounded anonymous policy with upstream producer bindings and the planned installed-stack evidence; remain SPECIFIED until delivered.
- [ ] OVERSTORY-IDENTITY-R003.2: Implement built-in eg authentication through arbora with upstream producer bindings and the planned installed-stack evidence; remain SPECIFIED until delivered.
- [ ] OVERSTORY-IDENTITY-R003.3: Implement external oidc provider interoperability with upstream producer bindings and the planned installed-stack evidence; remain SPECIFIED until delivered.
- [ ] OVERSTORY-IDENTITY-R010: Implement long-session renewal and mode-transition coherence with upstream producer bindings and the planned installed-stack evidence; remain SPECIFIED until delivered.

## Source-only delivery and open integration children

- [ ] OVERSTORY-IDENTITY-R003.1.1: Explicit anonymous source refusal boundary. Source mode tests cover anonymous provenance, policy refusal and ambient-authority cleanup. This does not deliver full no-auth journeys.
- [ ] OVERSTORY-IDENTITY-R003.1.2: Complete installed anonymous journeys. Installed positive and adversarial anonymous-policy journeys and native effect qualification remain required.
- [ ] OVERSTORY-IDENTITY-R003.2.1: EG boundary configuration source refusal. Source factory tests reject missing and untyped EG callbacks without provisioning credentials.
- [ ] OVERSTORY-IDENTITY-R003.2.2: Installed EG identity journeys. Installed real producer/browser qualification remains required; source configuration refusal is not login support.
- [ ] OVERSTORY-IDENTITY-R003.3.1: OIDC configuration source refusal. Source factory tests reject incompatible owners and incomplete browser OIDC configuration.
- [ ] OVERSTORY-IDENTITY-R003.3.2: External provider interoperability qualification. Protocol fixtures and each claimed live provider remain required; configuration tests do not qualify provider interoperability.

## Workspace account source and remaining session acceptance

- [ ] OVERSTORY-IDENTITY-R004.1: Deliver the shared workspace account menu and its rendered source regressions. Keep fixture identity and mocked HTTP evidence separate from installed acceptance.
- [ ] OVERSTORY-IDENTITY-R004.2: Qualify all original local account flows, session fixation, CSRF, logout/replay and credential-storage guarantees on the exact installed stack.

The parent OVERSTORY-IDENTITY-R004 remains incomplete while its installed child is open. Source component checks do not close OVERSTORY-IDENTITY-R009 accessibility acceptance.
