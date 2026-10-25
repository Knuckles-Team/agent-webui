# Browser interaction contract

Use the existing `src/components/ui/` primitives and `src/index.css` theme tokens.
This contract covers the shared shell and Canopy Glass continuation. It also covers the repaired chat drawer, Atlas filter rows and schema form. It does not certify
all routes or all WCAG criteria.

## Tokens and review targets

`src/index.css` remains the numeric source for native light, dark and glass
tokens; `WorkspaceFrame.css` owns shell-specific aliases. Do not import a proposal
file as a runtime token API or duplicate values in a separate theme system.
Measure actual composited foreground/background pairs, including hover, selection,
input placeholders and overlays, before claiming contrast compliance.

| Purpose / token | Light and glass | Dark |
|---|---|---|
| Canvas `--background` | `#E9EDE5` | `#121C17` |
| Native text `--foreground` | `#1F2A24` | `#F1F5EB` |
| Reading `--card` | `#F7F8F2` | `#1C2A22` |
| Raised `--popover`, `--surface-raised` | `#FFFFFF` | `#27372D` |
| Secondary `--secondary`, `--muted` | `#E6EBE1` | `#16231C` |
| Secondary text `--secondary-foreground`, `--text-secondary` | `#46544A` | `#D0DBCB` |
| Muted text `--muted-foreground` | `#59665C` | `#AABAA5` |
| Action `--primary` | `#3E634F` | `#ADC99F` |
| On action `--primary-foreground` | `#FFFFFF` | `#16251A` |
| Selection `--accent` | `#DDE9D8` | `#314A35` |
| On selection `--accent-foreground` | `#274C36` | `#E4EEDC` |
| Meaningful boundary `--input` | `#738170` | `#829680` |
| Focus `--ring` | `#245F70` | `#9ACFE1` |
| Failure `--destructive` | `#963F37` | `#F0B0A6` |
| Shell fill `--shell-alpha` | `92%` | `90%` |

These are the default source values, not a rendered acceptance receipt. Card and
popover text use the native foreground; shell fill composites the card surface,
not text. Glass inherits the light palette with translucent chrome only. Custom
accent overrides need separate contrast review. Do not use the decorative border
as the only meaningful control boundary.

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
- The assistant is a visible named region in workspace flow, never a floating
  launcher, backdrop or modal drawer. Write focuses the existing composer;
  Expand/Restore changes only the dock size. An unhandled Escape within an
  expanded assistant restores its size without hiding the assistant. Keep focus
  on a surviving control. Move focus to the persistent composer if restore or
  resize hides the focused transcript or option control.
  Nested controls retain their own Escape behavior. Navigation and resizing
  preserve the existing Chat instance, draft and selected conversation. Fresh
  secondary-dock entry does not autofocus or scroll to the composer. Write and
  explicit conversation selection retain their existing focus behavior.
- Modal interactions use the existing Dialog primitive and its focus trap. Do
  not apply modal semantics or trap focus in a nonmodal complementary region.
- Every action has a keyboard and click alternative. Chat header controls use
  44px targets; filter actions use 32px targets. Keep visible focus styles.
- Reduced motion removes drawer transitions and decorative ping/pulse animation
  while preserving text, controls and state changes.

## Local review

Run `corepack pnpm exec playwright test --config e2e/accessibility.config.ts`.
The fixture imports the actual three components and substitutes only the networked
Chat content with a labeled input. It blocks non-loopback requests, including the
existing external font import. This is component integration evidence. It does not prove streaming chat, a complete Atlas query/result journey, permission enforcement or operational execution. Those journeys and manual assistive-technology review
remain acceptance work in [tasks.md](tasks.md).

The changes introduce no dependency, UI primitive, telemetry client or externally
copied guidance. Screenshot review and measured contrast are still required.

## Canopy Glass composition and density

WEBUI-DESIGN-R002.1.1/R004.1.1 and WEBUI-APPS-R049.2.1 apply to one shared
full-width header, not an additional shell. Work/Explore/Operate, current context, command/search entry and main actions stay visible and labelled. The header wraps into useful rows. Never shrink them to an icon-only capsule or place main
navigation behind More. Secondary appearance utilities may use a disclosure.
Keep the existing logo, route semantics and same-origin font; the material
language is new, not a replacement identity.

Use one useful resizable map and give all remaining space to the main task.
Without a selected record, Explore uses the available working width rather than
an empty inspector. Selected detail renders actual properties, relationships and
history. On narrow screens stack or focus panes with named return controls and
preserve query, selection and focus. No decorative status cards, invented counts
or always-empty rails. Bounded prose width is intentional readability, not wasted
space; dense lists and meaningful splits may use the rest.

Retain compact, comfortable and touch usability. Compact spacing must not shrink
required text below 12 CSS px: `--text-tiny` is `0.75rem`. Working text normally
uses 13–14 px, readable line height and wrapping. `--radius: 0.75rem` yields
8–16 px control corners; the workspace material uses 20–24 px panel corners. Use a 4 px spacing rhythm and minimum rather than fixed
content heights. Compact controls/two-line records use `2.25rem`/`3.25rem`
(36px/52px); comfortable uses `2.75rem`/`4rem` (44px/64px). Coarse-pointer records
use 64px and controls retain a 44px floor in both density modes. Never meet a
visible-row target by clipping labels or focus. At 1440×900, evaluate about 20 single-line or 11 two-line records after
local chrome; record actual results and allow user enlargement to reduce counts.

The continuous atmospheric field must remain visible through the header, map and
primary panels. Primary evidence cards use higher-opacity white glass; secondary
framing uses quieter sage/blue glass. Use background alpha only, never container
opacity over text. Blur sibling framing surfaces only; nested cards and controls
use alpha fills without another backdrop blur. No opaque ancestor may flatten
the workspace field. Verify actual composited text and focus contrast. Unsupported blur, reduced transparency, opaque preference and
forced colors remove effects without changing capability. Forced colors use
system surfaces, text, selection and focus rather than preserving branded paint.

## Canopy Glass motion and preferences

WEBUI-DESIGN-R005.2 builds on the existing reduced-motion contract. Runtime tokens
are `--motion-fast: 110ms`, `--motion-context: 180ms`, `--motion-panel: 220ms`
and `--motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1)`. A genuine data update
may highlight once for at most 600 ms and keeps its textual state afterward.
These are source durations and design limits, not measured performance results.
Do not move reading text, animate full-screen blur, or use perpetual shimmer,
ambient drift and fake activity. Further semantic-zoom choreography remains R005.1 acceptance work.

New input immediately interrupts or retargets motion. Navigation and state do not
wait for transitionend; cancel/close and newer selection cannot be undone by a
late callback. System reduced motion applies from the first render and overrides
expressive appearance. The in-app reduction control can only reduce effects;
state, keyboard focus and status announcements remain present. Persist bounded
appearance preferences through the existing provider, with safe storage fallback.
It exposes theme, compact/comfortable density, system/reduce motion and
glass/opaque transparency choices through the existing `useTheme` context.
The root data attributes apply effects without changing navigation or identity.
Live-update buffering/pause, stable selection under streaming, and full-route
motion review remain mandatory broader rollout work, not inferred from this slice.
