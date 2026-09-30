# Design-system delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **BUILDING**; component integration evidence exists, but full three-journey acceptance remains open.

- [x] Publish the existing token/interaction contract with light/dark values in [interaction-contract.md](interaction-contract.md).
- [ ] Build synthetic chat, Atlas and operational-form fixtures and capture baseline viewport matrix.
- [ ] Audit WCAG 2.2 AA, keyboard, screen reader, responsive and reduced-motion behavior; rank defects by user impact.
- [x] Repair component defects by reusing existing components, including distinct repeated-filter labels, mobile wrapping, linked form errors, drawer focus and reduced motion.
- [ ] Run tests/quality gates and capture after screenshots on exact commit; verify no telemetry, duplicate primitives or unlicensed text.
- [ ] Attach merged commit, CI artifact digests and manual review, then mark ACCEPTED only if every listed test passes.
