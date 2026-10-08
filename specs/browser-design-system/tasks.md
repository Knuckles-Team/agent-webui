# Design-system delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **SPECIFIED**; no full three-journey acceptance evidence is recorded.

- [ ] Inventory tokens and primitives on current main; publish the local token/interaction contract with light/dark values.
- [ ] Build synthetic chat, Atlas and operational-form fixtures and capture baseline viewport matrix.
- [ ] Audit WCAG 2.2 AA, keyboard, screen reader, responsive and reduced-motion behavior; rank defects by user impact.
- [ ] Repair defects by reusing existing components, including distinct repeated-filter labels and mobile wrapping.
- [ ] Run tests/quality gates and capture after screenshots on exact commit; verify no telemetry, duplicate primitives or unlicensed text.
- [ ] Attach merged commit, CI artifact digests and manual review, then mark ACCEPTED only if every listed test passes.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-DESIGN-R001`, `DS-01`, `DS-02`, `DS-03`, `DS-04`, `DS-05`, `DS-06`, `DS-07`, `DS-08`.

## Strict style policy (DS-07, DS-08)

- [x] Self-host Inter and remove the remote font import (DS-07).
- [x] Add a per-document style nonce to `SecurityHeadersMiddleware` with tests (DS-08).
- [x] Pass the nonce to Radix Select and ScrollArea, and to react-remove-scroll through `__webpack_nonce__` (DS-08).
- [x] Patch out the sonner runtime style injection and import its bundled stylesheet (DS-08).
- [ ] Add the browser probe as an e2e test that fails on any `securitypolicyviolation` event (DS-07, DS-08).
- [ ] Open a dialog, a select and a toast under the probe; the shell-only probe covers load-time injectors only.
- [ ] Remove the `script-src` `eval` violation in the `api-validation` chunk; this is outside DS-08 scope.
- [ ] Rebuild the served bundle on the deployment host after merge.
