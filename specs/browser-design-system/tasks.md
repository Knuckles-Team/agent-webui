# Design-system delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **SPECIFIED**; no full three-journey acceptance evidence is recorded.

- [ ] Inventory tokens and primitives on current main; publish the local token/interaction contract with light/dark values.
- [ ] Build synthetic chat, Atlas and operational-form fixtures and capture baseline viewport matrix.
- [ ] Audit WCAG 2.2 AA, keyboard, screen reader, responsive and reduced-motion behavior; rank defects by user impact.
- [ ] Repair defects by reusing existing components, including distinct repeated-filter labels and mobile wrapping.
- [ ] Run tests/quality gates and capture after screenshots on exact commit; verify no telemetry, duplicate primitives or unlicensed text.
- [ ] Attach merged commit, CI artifact digests and manual review, then mark ACCEPTED only if every listed test passes.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-DESIGN-R001`, `WEBUI-DESIGN-R002`, `WEBUI-DESIGN-R003`, `WEBUI-DESIGN-R004`, `WEBUI-DESIGN-R005`, `WEBUI-DESIGN-R006`, `WEBUI-DESIGN-R007`, `WEBUI-DESIGN-R008`, `WEBUI-DESIGN-R009`.

## Duplicate-primitive and telemetry audit (WEBUI-DESIGN-R007)

- [x] Add `src/components/ui/__tests__/no-duplicate-primitives.test.ts`: every exported primitive name in `src/components/ui/` resolves to exactly one file. Also assert that no telemetry/analytics/session-replay dependency is declared in `package.json` (WEBUI-DESIGN-R007).

## Strict style policy (WEBUI-DESIGN-R008, WEBUI-DESIGN-R009)

- [x] Self-host Inter and remove the remote font import (WEBUI-DESIGN-R008).
- [x] Add a per-document style nonce to `SecurityHeadersMiddleware` with tests (WEBUI-DESIGN-R009).
- [x] Pass the nonce to Radix Select and ScrollArea, and to react-remove-scroll through `__webpack_nonce__` (WEBUI-DESIGN-R009).
- [x] Patch out the sonner runtime style injection and import its bundled stylesheet (WEBUI-DESIGN-R009).
- [x] Add the browser probe as an e2e test that fails on any `securitypolicyviolation` event (WEBUI-DESIGN-R008, WEBUI-DESIGN-R009).
- [ ] Open a dialog, a select and a toast under the probe; the shell-only probe covers load-time injectors only.
- [x] Remove the `script-src` `eval` violation in the `api-validation` chunk; this is outside WEBUI-DESIGN-R009 scope.
- [ ] Rebuild the served bundle on the deployment host after merge.
