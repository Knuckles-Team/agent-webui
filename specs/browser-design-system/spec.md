# Accessible GraphOS browser design system

**ID:** WEBUI-DESIGN-001
**Owner:** agent-webui
**Related ID:** WEBUI-DESIGN-R001
**Delivery:** specified; acceptance audit open
**Acceptance:** open

Every requirement ID in this spec is defined in [requirements.md](requirements.md); its current delivery and acceptance state, with evidence, is recorded in [status.json](status.json).

## Outcome

A contributor builds new GraphOS browser surfaces from one documented set of tokens, responsive patterns and interaction states. Chat, Atlas and an operational form remain usable by keyboard, screen reader, touch and reduced-motion users. Visual review compares a stable before/after screenshot set, and new components reuse the existing UI primitives. The design guidance can be used with the universal spec/design/accessibility skills, but this spec is complete without installing any external skill or reading a private document.

## Requirements

| ID | Behavior | Proof |
|---|---|---|
| DS-01 | Document semantic color, type, spacing, focus, density and state tokens with light/dark contrast targets; use current `src/index.css` tokens as the source | Token audit and snapshots |
| DS-02 | Every control has an accessible name and visible focus; repeated filter rows name their individual clauses; dialogs trap/restore focus | Chat/Atlas/form keyboard E2E |
| DS-03 | Responsive patterns cover 320px mobile through desktop without horizontal overflow or hidden required actions | Viewport matrix and screenshot diff |
| DS-04 | Gestures have click/keyboard alternatives; `prefers-reduced-motion` disables nonessential motion without hiding feedback | Touch and reduced-motion E2E |
| DS-05 | Loading, empty, stale, denied, error, success and pending states are distinct in text as well as color; long operations are interruptible where safe | State-fixture rendered tests |
| DS-06 | No new duplicate UI primitives or unsolicited telemetry; any third-party idea is paraphrased only after license review | Source diff and dependency audit |

The review covers one chat flow, Atlas query/filter/result flow, and one operational form with both successful and denied outcomes. It does not declare the entire application WCAG conformant based on those journeys. A new journey must add its own acceptance evidence. The spec's assets are local screenshot fixtures and token documentation under this feature directory or the existing component system; no private host is required.

## Design guidance assimilation

WEBUI-DESIGN-R001 distills useful outside accessibility, responsive, interaction and visual guidance into this component system and the public universal design/accessibility skills. Review each candidate pattern for license, overlap and observable user benefit before adding it. Keep the existing `src/components/ui/` primitives and `src/index.css` tokens as the implementation seams; use a workflow across the current atomic skills if a review spans several disciplines. The review rubric ranks keyboard and screen-reader failure first, then hidden mobile actions, unclear feedback, motion sensitivity and visual polish. It must include a documented before/after review of chat, Atlas and an operational form at phone and desktop widths. Do not install duplicate skill names, copy unlicensed skill text, add a remote critique service, or introduce unsolicited telemetry. A design review is local and reproducible from synthetic fixtures.

## Completion

BUILT requires merged token/interaction guidance and any source adjustments. ACCEPTED requires measured WCAG 2.2 AA checks on the three named journeys, human review of screenshots, responsive/reduced-motion tests and exact commit/CI evidence. The absence of telemetry and duplicate primitives must be verified, not assumed.
