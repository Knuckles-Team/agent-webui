# WEBUI-DESIGN — Accessible Arbora browser design system

**ID:** WEBUI-DESIGN
**Owner:** agent-webui
**Related ID:** WEBUI-DESIGN-R001
**Delivery:** specified; acceptance audit open
**Acceptance:** open

## Outcome

A contributor builds new Arbora browser surfaces from one documented set of tokens, responsive patterns and interaction states. Chat, Atlas and an operational form remain usable by keyboard, screen reader, touch and reduced-motion users. Visual review compares a stable before/after screenshot set, and new components reuse the existing UI primitives. The design guidance can be used with the universal spec/design/accessibility skills, but this spec is complete without installing any external skill or reading a private document.

## Requirements

| ID | Behavior | Proof |
|---|---|---|
| WEBUI-DESIGN-R002 | Document semantic color, type, spacing, focus, density and state tokens with light/dark contrast targets. Use current `src/index.css` tokens as the source | Token audit and snapshots |
| WEBUI-DESIGN-R003 | Every control has an accessible name and visible focus. Repeated filter rows name their individual clauses. Dialogs trap/restore focus | Chat/Atlas/form keyboard E2E |
| WEBUI-DESIGN-R004 | Responsive patterns cover 320px mobile through desktop without horizontal overflow or hidden required actions | Viewport matrix and screenshot diff |
| WEBUI-DESIGN-R005 | Gestures have click/keyboard alternatives; `prefers-reduced-motion` disables nonessential motion without hiding feedback | Touch and reduced-motion E2E |
| WEBUI-DESIGN-R006 | Loading, empty, stale, denied, error, success and pending states are distinct in text as well as color. Long operations are interruptible where safe | State-fixture rendered tests |
| WEBUI-DESIGN-R007 | No new duplicate UI primitives or unsolicited telemetry. Any third-party idea is paraphrased only after license review | Source diff and dependency audit |
| WEBUI-DESIGN-R008 | Inter font files ship inside the build with `@font-face` and a fallback stack. No remote font or stylesheet import | Browser probe under the served policy |
| WEBUI-DESIGN-R009 | Each HTML document gets a fresh style nonce. Runtime `<style>` injectors carry it or ship bundled CSS. No `'unsafe-inline'` for style elements | Server nonce tests and browser probe |

The review covers one chat flow, Atlas query/filter/result flow, and one operational form with both successful and denied outcomes. It does not declare the entire application WCAG conformant based on those journeys. A new journey must add its own acceptance evidence. The spec's assets are local screenshot fixtures and token documentation under this feature directory or the existing component system; no private host is required.

## Design guidance assimilation

WEBUI-DESIGN-R001 distills useful outside accessibility, responsive, interaction and visual guidance into this component system and the public universal design/accessibility skills. Review each candidate pattern for license, overlap and observable user benefit before adding it. Keep the existing `src/components/ui/` primitives and `src/index.css` tokens as the implementation seams; use a workflow across the current atomic skills if a review spans several disciplines. The review rubric ranks keyboard and screen-reader failure first, then hidden mobile actions, unclear feedback, motion sensitivity and visual polish. It must include a documented before/after review of chat, Atlas and an operational form at phone and desktop widths. Do not install duplicate skill names, copy unlicensed skill text, add a remote critique service, or introduce unsolicited telemetry. A design review is local and reproducible from synthetic fixtures.

## Completion

BUILT requires merged token/interaction guidance and any source adjustments. ACCEPTED requires measured WCAG 2.2 AA checks on the three named journeys, human review of screenshots, responsive/reduced-motion tests and exact commit/CI evidence. The absence of telemetry and duplicate primitives must be verified, not assumed.

Requirement IDs are defined in [requirements.md](requirements.md); delivery state per ID is in `status.json`.

## Strict style policy (WEBUI-DESIGN-R008, WEBUI-DESIGN-R009)

The server sends `style-src-elem 'self'`. The browser blocks any inline `<style>` element without a matching nonce. A probe of the built bundle under that policy found four sources of blocked styles.

| Source | Behavior | Fix |
|---|---|---|
| `src/index.css` | Imports Inter from a remote font service | Self-hosted `src/assets/fonts/InterVariable.woff2` (SIL OFL 1.1) with `@font-face` |
| sonner | `__insertCSS` appends an empty `<style>`, then fills it; this triggers the empty-content hash violation | A pnpm patch removes the call; `src/index.css` imports `sonner/dist/styles.css` |
| Radix Select and ScrollArea | Render a fixed viewport `<style>` element | `src/components/ui/select.tsx` and `scroll-area.tsx` pass the document nonce |
| react-remove-scroll (Radix Dialog, Select, Menu) | Inserts scroll-lock rules through react-style-singleton | `installCspNonce()` sets `__webpack_nonce__`, which get-nonce reads |

The vite `html.cspNonce` option writes a placeholder into `<meta property="csp-nonce">`. `SecurityHeadersMiddleware` buffers each HTML response, replaces the placeholder with a fresh nonce, and adds the nonce to both style directives. It drops `etag` and `last-modified` and sets `cache-control: no-store` on that document. A directive with an acknowledged `'unsafe-inline'` relaxation receives no nonce, because a nonce disables `'unsafe-inline'`. `src/lib/csp-nonce.ts` reads the nonce for client code. The application does not use the next-themes provider, so next-themes injects no script or style.

## Complete responsive Arbora workspace

This extension is SPECIFIED, not an implementation or acceptance claim. It extends the existing owner rather than creating a duplicate redesign specification. The current-state feature inventory and migration obligations are in [the app-surface inventory](../arbora-app-surface/workspace-coverage.md). Every feature remains in scope on mobile and every permitted semantic leaf is directly navigable.

- WEBUI-DESIGN-R002.1: Purposeful density and Arbora visual hierarchy.
- WEBUI-DESIGN-R004.1: Full mobile and arbitrary-aspect feature parity.
- WEBUI-DESIGN-R004.2: Resize, fold and visual viewport continuity.
- WEBUI-DESIGN-R005.1: Accessible interruptible semantic zoom.
- WEBUI-DESIGN-R010: Measured performance under representative load.

## Canopy Glass theme completion path

The original sage/ivory material language extends this specification, not a new
owner or theme API. WEBUI-DESIGN-R002.1.1 defines material and density,
R004.1.1 defines the fully expanded responsive header, and R005.2 defines
meaningful interruptible motion. Their shared-shell and existing Explore journey
slice is WEBUI-APPS-R049.2.1. The current component, token, logo, route, identity
and WebMCP contracts remain authoritative.

The header uses available width and reflows visibly into rows. It never becomes a centered capsule or hides main context navigation/search. Keep a useful resizable
map, dominant center and only real selected-evidence detail. Opaque reading
surfaces and reduced-motion/transparency/forced-color alternatives preserve
information. No decorative panels, invented data or idle visual effects count as
density or dynamism.

Theme completion still includes all Work/Explore/Operate capabilities, graph,
editor, run, administration and authentication surfaces. The existing R002–R006,
R010, WEBUI-APPS-R049.1.2/R049.2/R050 obligations remain open. Source tests,
synthetic rendered screenshots and a polished shell cannot establish full
redesign, accessibility, mobile, performance or served-provider acceptance.
