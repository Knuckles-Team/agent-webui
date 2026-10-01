# Browser interaction contract

Use the existing `src/components/ui/` primitives and `src/index.css` theme tokens.
This contract describes the repaired chat drawer, Atlas filter rows and schema
form. It does not certify all routes or all WCAG criteria.

## Tokens and review targets

These values come from `src/index.css`; update this table when those tokens change.
Values are OKLCH. Measure the rendered foreground/background combination, including
opacity and overlays, before claiming contrast compliance.

| Purpose | Light | Dark |
|---|---|---|
| Background | `0.988 0.002 280` | `0.13 0.02 260` |
| Foreground | `0.145 0.012 265` | `0.96 0.005 260` |
| Muted text | `0.50 0.02 280` | `0.64 0.02 260` |
| Primary / focus ring | `0.52 0.16 260` | `0.62 0.16 260` |
| Destructive text | `0.58 0.24 27` | `0.70 0.19 22` |

Normal text targets 4.5:1 contrast; large text and meaningful control boundaries
or focus indicators target 3:1 against adjacent colors. Color alone cannot convey
failure, permission denial, success or pending work. Existing compact text and
spacing utilities remain the source of density; keep primary actions visible at
320px and use wrapping instead of clipping required controls.

## Interaction rules

- Name each repeated filter and its field, operator, value and remove action by
  its visible position. Preserve the existing Select keyboard behavior.
- Associate schema help and validation errors with their input through
  `aria-describedby`; keep `aria-invalid` aligned with validation state. Boolean
  controls have a separate accessible label so help text is not part of the name.
- The chat drawer is a complementary region, not a modal dialog. Opening focuses
  Close chat; closing by its button or Escape restores the launcher. The closed
  drawer is inert, and the hidden launcher is disabled. Switching to primary chat
  must preserve navigation focus and the existing Chat instance.
- Modal interactions use the existing Dialog primitive and its focus trap. Do
  not apply modal semantics or trap focus in a nonmodal complementary region.
- Every action has a keyboard and click alternative. Chat header controls use
  40px targets; filter actions use 32px targets. Keep visible focus styles.
- Reduced motion removes drawer transitions and decorative ping/pulse animation
  while preserving text, controls and state changes.

## Local review

Run `corepack pnpm exec playwright test --config e2e/accessibility.config.ts`.
The fixture imports the actual three components and substitutes only the networked
Chat content with a labeled input. It blocks non-loopback requests, including the
existing external font import. This is component integration evidence, not proof
of streaming chat, a complete Atlas query/result journey, permission enforcement,
or operational execution. Those journeys and manual assistive-technology review
remain acceptance work in [tasks.md](tasks.md).

The changes introduce no dependency, UI primitive, telemetry client or externally
copied guidance. Screenshot review and measured contrast are still required.
