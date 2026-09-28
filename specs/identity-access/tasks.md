# Browser identity delivery

**States:** SPECIFIED → BUILDING → BUILT (merged source) → ACCEPTED (evidence). Current: **SPECIFIED**; no merged-head acceptance audit has been recorded here.

- [ ] Inventory current identity host, Graph OS `identity.*` operation names, elevation operation and auth-mode behavior on current main.
- [ ] Replace local bootstrap bypasses with explicit loopback/ack mode and mode doctor; add refusal tests.
- [ ] Implement server-side session/CSRF/local-auth flow and migration tests without browser token storage.
- [ ] Add MFA enrollment/challenge/recovery flows and adversarial browser tests.
- [ ] Connect admin tabs and mapping-rule preview to the generated identity client; delete duplicate direct routes after contract parity.
- [ ] Reuse the same elevation operation from UI, chat and A2A; test step-up, two-person approval, expiry and revocation.
- [ ] Run `test-spec.md` including hosted browser and accessibility cases on exact merged source; attach commit and evidence before acceptance.
