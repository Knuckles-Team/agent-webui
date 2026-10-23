# Browser identity delivery

**States:** SPECIFIED → BUILDING → BUILT (merged source) → ACCEPTED (evidence). Current: **SPECIFIED**; no merged-head acceptance audit has been recorded here.

- [ ] Inventory current identity host, Arbora `identity.*` operation names, elevation operation and auth-mode behavior on current main.
- [ ] Replace local bootstrap bypasses with explicit loopback/ack mode and mode doctor; add refusal tests.
- [ ] Implement server-side session/CSRF/local-auth flow and migration tests without browser token storage.
- [ ] Add MFA enrollment/challenge/recovery flows and adversarial browser tests.
- [ ] Connect admin tabs and mapping-rule preview to the generated identity client; delete duplicate direct routes after contract parity.
- [ ] Reuse the same elevation operation from UI, chat and A2A; test step-up, two-person approval, expiry and revocation.
- [ ] Run `test-spec.md` including hosted browser and accessibility cases on exact merged source; attach commit and evidence before acceptance.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-IDENTITY-R003`, `WEBUI-IDENTITY-R004`, `WEBUI-IDENTITY-R005`, `WEBUI-IDENTITY-R006`, `WEBUI-IDENTITY-R007`, `WEBUI-IDENTITY-R008`, `WEBUI-IDENTITY-R009`, `WEBUI-IDENTITY-R001`, `WEBUI-IDENTITY-R002`.

## Explicit mode delivery and acceptance

- [ ] WEBUI-IDENTITY-R003.1: Implement explicit no-auth mode with bounded anonymous policy with upstream producer bindings and the planned installed-stack evidence; remain SPECIFIED until delivered.
- [ ] WEBUI-IDENTITY-R003.2: Implement built-in eg authentication through arbora with upstream producer bindings and the planned installed-stack evidence; remain SPECIFIED until delivered.
- [ ] WEBUI-IDENTITY-R003.3: Implement external oidc provider interoperability with upstream producer bindings and the planned installed-stack evidence; remain SPECIFIED until delivered.
- [ ] WEBUI-IDENTITY-R010: Implement long-session renewal and mode-transition coherence with upstream producer bindings and the planned installed-stack evidence; remain SPECIFIED until delivered.
