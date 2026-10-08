# Accessible GraphOS browser design system

**ID:** WEBUI-DESIGN-001
**Owner:** agent-webui
**Related ID:** WEBUI-DESIGN-R001
**Delivery:** specified; acceptance audit open
**Acceptance:** open

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
| DS-07 | Inter font files ship inside the build with `@font-face` and a fallback stack; no remote font or stylesheet import | Browser probe under the served policy |
| DS-08 | Each HTML document gets a fresh style nonce; runtime `<style>` injectors carry it or ship bundled CSS; no `'unsafe-inline'` for style elements | Server nonce tests and browser probe |

The review covers one chat flow, Atlas query/filter/result flow, and one operational form with both successful and denied outcomes. It does not declare the entire application WCAG conformant based on those journeys. A new journey must add its own acceptance evidence. The spec's assets are local screenshot fixtures and token documentation under this feature directory or the existing component system; no private host is required.

## Design guidance assimilation

WEBUI-DESIGN-R001 distills useful outside accessibility, responsive, interaction and visual guidance into this component system and the public universal design/accessibility skills. Review each candidate pattern for license, overlap and observable user benefit before adding it. Keep the existing `src/components/ui/` primitives and `src/index.css` tokens as the implementation seams; use a workflow across the current atomic skills if a review spans several disciplines. The review rubric ranks keyboard and screen-reader failure first, then hidden mobile actions, unclear feedback, motion sensitivity and visual polish. It must include a documented before/after review of chat, Atlas and an operational form at phone and desktop widths. Do not install duplicate skill names, copy unlicensed skill text, add a remote critique service, or introduce unsolicited telemetry. A design review is local and reproducible from synthetic fixtures.

## Completion

BUILT requires merged token/interaction guidance and any source adjustments. ACCEPTED requires measured WCAG 2.2 AA checks on the three named journeys, human review of screenshots, responsive/reduced-motion tests and exact commit/CI evidence. The absence of telemetry and duplicate primitives must be verified, not assumed.

Requirement IDs are defined in [requirements.md](requirements.md); delivery state per ID is in `status.json`.

## Strict style policy (DS-07, DS-08)

The server sends `style-src-elem 'self'`. The browser blocks any inline `<style>` element without a matching nonce. A probe of the built bundle under that policy found four sources of blocked styles.

| Source | Behavior | Fix |
|---|---|---|
| `src/index.css` | Imports Inter from a remote font service | Self-hosted `src/assets/fonts/InterVariable.woff2` (SIL OFL 1.1) with `@font-face` |
| sonner | `__insertCSS` appends an empty `<style>`, then fills it; this triggers the empty-content hash violation | A pnpm patch removes the call; `src/index.css` imports `sonner/dist/styles.css` |
| Radix Select and ScrollArea | Render a fixed viewport `<style>` element | `src/components/ui/select.tsx` and `scroll-area.tsx` pass the document nonce |
| react-remove-scroll (Radix Dialog, Select, Menu) | Inserts scroll-lock rules through react-style-singleton | `installCspNonce()` sets `__webpack_nonce__`, which get-nonce reads |

The vite `html.cspNonce` option writes a placeholder into `<meta property="csp-nonce">`. `SecurityHeadersMiddleware` buffers each HTML response, replaces the placeholder with a fresh nonce, and adds the nonce to both style directives. It drops `etag` and `last-modified` and sets `cache-control: no-store` on that document. A directive with an acknowledged `'unsafe-inline'` relaxation receives no nonce, because a nonce disables `'unsafe-inline'`. `src/lib/csp-nonce.ts` reads the nonce for client code. The application does not use the next-themes provider, so next-themes injects no script or style.
