# Browser design system

Arbora shares one set of tokens, primitives and interaction rules across browser surfaces. Each view extends this common system. This page documents tokens from [`src/index.css`](https://github.com/Knuckles-Team/agent-webui/blob/main/src/index.css) and their contrast targets.
The `src/components/ui/` primitives consume these tokens. The token audit
(`src/__tests__/design-tokens.test.ts`) mirrors the documented defaults and checks
stylesheet values and contrast pairs. Source checks do not replace rendered
contrast, screenshot or assistive-technology review.

## Color tokens

Canopy Glass uses the sRGB hex defaults below. `:root` defines the light
sage/ivory palette; `.dark` overrides it with deep green. `.glass` inherits the
light palette as a compatibility alias. The appearance picker shows Canopy light
for either stored value, not a duplicate palette option. Glass framing/Opaque
framing independently controls shell translucency, never reading surfaces.
Existing custom accent hues remain an optional override through the current
provider, with theme-specific lightness and bounded chroma. Legacy blue has ambiguous provenance: it may have been saved automatically or chosen explicitly.
Without a choice marker, it uses Canopy defaults while retaining the stored base color.
New explicit choices receive a marker; nondefault saved hues also remain custom.
Chat submission and the favicon use the same effective action accent.
The provider reports the effective choice and its default/custom mode, not the ambiguous stored blue as active.
Custom palettes still require rendered contrast review. Normal text targets
**4.5:1** contrast against its background; large text, icons and meaningful
control boundaries or focus indicators target **3:1**, per
[WCAG 2.2 success criteria 1.4.3 and 1.4.11](https://www.w3.org/TR/WCAG22/).
Color is never the only signal for a state; see [State tokens](#state-tokens-status-language).

| Role (pairing) | Light / glass | Dark | Contrast target |
|---|---|---|---|
| Foreground on Background | `#111111` on `#E9EDE5` | `#F1F5EB` on `#121C17` | 4.5:1 |
| Card-foreground on Card | `#111111` on `#F7F8F2` | `#F1F5EB` on `#1C2A22` | 4.5:1 |
| Popover-foreground on Popover | `#111111` on `#FFFFFF` | `#F1F5EB` on `#27372D` | 4.5:1 |
| Primary-foreground on Primary | `#FFFFFF` on `#3E634F` | `#16251A` on `#ADC99F` | 4.5:1 |
| Secondary-foreground on Secondary | `#111111` on `#E6EBE1` | `#D0DBCB` on `#16231C` | 4.5:1 |
| Muted-foreground on Background | `#111111` on `#E9EDE5` | `#AABAA5` on `#121C17` | 4.5:1 |
| Muted-foreground on Card | `#111111` on `#F7F8F2` | `#AABAA5` on `#1C2A22` | 4.5:1 |
| Accent-foreground on Accent | `#111111` on `#DDE9D8` | `#E4EEDC` on `#314A35` | 4.5:1 |
| Destructive-foreground on Destructive | `#FFFFFF` on `#963F37` | `#381914` on `#F0B0A6` | 4.5:1 |
| Destructive text on Background | `#963F37` on `#E9EDE5` | `#F0B0A6` on `#121C17` | 4.5:1 |
| Input boundary on Card | `#738170` on `#F7F8F2` | `#829680` on `#1C2A22` | 3:1 |
| Ring (focus indicator) on Background | `#245F70` on `#E9EDE5` | `#9ACFE1` on `#121C17` | 3:1 |

`--surface-raised` matches the popover fill; `--text-secondary` matches the
secondary foreground. Decorative `--border` is `#C5CFC1` in light/glass and
`#405344` in dark; it does not replace `--input` for meaningful control outlines.

### Material and glass

The shared workspace uses an original same-origin botanical wallpaper, with bounded sage/blue/ivory light.
The WebP asset is an encoding-only optimization of generated background artwork, not a UI mockup.
Lighten blending prevents image channels falling below the authored contrast floor. Header and map
framing transmit that field through 32% ivory and sage glass; primary panels
use 41% white glass, with 51% reading-card fills and 61% neutral-control fills. The independent material
preference applies to light and the legacy glass alias. Dark uses 72–88% deep
surfaces. Text never inherits container opacity. `--glass-muted` is `#111111` in
light and `#E1EBDC` in dark. Contrast tests composite every material over the
authored field floor and white; real browser pixel review remains necessary.

Light-theme labels use black, with hierarchy expressed by size and weight.
Controls stay slightly milkier than their supporting glass, not solid white.
Only sibling framing panels use backdrop blur. Nested cards and controls use
alpha fills without more blur. Unsupported blur starts opaque; reduced
transparency, the in-app opaque choice and forced colors remove effects. Forced
colors use system surfaces and text. All modes retain the same capabilities.
The existing Arbora artwork and same-origin fonts remain the product identity.

A thin full-width floating header keeps labelled Work/Explore/Operate, context,
search/commands and main actions visible. It wraps into useful rows rather than
becoming a capsule. The resizable map yields space to the evidence center.
Explore shows real selected detail or a collection without a placeholder rail.
The Agent entry lives in existing chrome and expands the mounted conversation
in place. It reserves no idle column or bottom bar and is not a floating bubble.
Running and approval cues come from the real conversation state. These are
bounded shell/Explore changes, not evidence of an all-route redesign.

### Approved visual baseline

The owner approved the desktop theme on 2026-10-25.

Source: [`9478612`](https://github.com/Knuckles-Team/agent-webui/commit/9478612117a32ec497a71c9ab6fff451804c0486).
Keep this palette, wallpaper and material hierarchy while adapting real product content and context.
This approval does not accept synthetic research vocabulary, all-route parity or unfinished accessibility checks.

| Material | Light value |
|---|---|
| Header | `rgb(241 246 231 / 38%)`, 16px blur, 125% saturation |
| Secondary map | `rgb(218 234 220 / 38%)`, 16px blur, 120% saturation |
| Primary panels | `rgb(248 250 243 / 48%)`, 16px blur, 115% saturation |
| Nested reading cards | `rgb(255 255 250 / 60%)`, no extra blur |
| Neutral controls and active highlights | `rgb(255 255 252 / 72%)`, no extra blur |
| Text and secondary labels | `#111111` |
| Luminous edge | `rgb(255 255 255 / 76%)` |
| Contrast floor | `#45685B`, with lighten background blending |
| Frame and card radii | 24px panels, 16px cards, 14px controls |

The wallpaper is `src/assets/arbora-canopy-wallpaper.webp`: 1672×941 pixels and 290892 bytes.
Its SHA-256 is `df3bfb3775c406c2eacdd8e1fc5c4daf7e86af69b8fcf74d8e9a79153f56544a`.
The owner then requested about 15% less opacity, relative to the approved fills.
Current light fills are 32%, 32%, 41%, 51% and 61% for header, map, panels, cards and neutral controls.
The token audit pins that calculation, the unchanged palette and the asset digest.
Dark, opaque and accessibility fallbacks remain unchanged. Semantic action colors retain their readable foreground pairs.
Other theme changes require a new explicit visual review.
The hosted run retains real desktop/mobile screenshots and a short transition recording.

Capture: [preview run](https://github.com/Knuckles-Team/agent-webui/actions/runs/40157438929).

This fixture uses synthetic records; it does not represent a connected research project or live provider.

## Typography

The body font is Inter, loaded in `src/index.css` with a system-UI fallback. Its fallback stack is `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`. Text remains visible before the webfont loads. `index.css` adds `--text-tiny` for readable metadata and badges. Its size is `0.75rem`, or 12px at the default root size. Required information must not be
shrunk to fit. Other sizes use the existing Tailwind scale; keep readable line
heights, wrapping and user text enlargement. Inter is bundled with the build,
not fetched from a remote font service.

## Spacing and density

`--radius` is `0.75rem` (12px at the default root size). The `-sm`, `-md`,
`-lg` and `-xl` corner tokens derive from it, giving 8px, 10px, 12px and 16px
respectively. Workspace glass panels use 20–24px corners. Use aligned rows, modest padding and fewer nested containers for
density, not tiny text or fixed-height boxes that clip wrapping content.

| Workspace density token | Compact (default) | Comfortable | Coarse pointer |
|---|---|---|---|
| `--control-height` | `2.25rem` / 36px | `2.75rem` / 44px | At least `2.75rem` / 44px |
| `--record-height` (two-line row) | `3.25rem` / 52px | `4rem` / 64px | `4rem` / 64px |
| `--panel-padding` | `0.75rem` / 12px | `1rem` / 16px | Selected density padding |

These are minimum sizing tokens, not limits on wrapped content. Existing
component-specific sizes may be larger; legacy controls still need their own
route-level target review. No actionable control should fall below 24px,
consistent with [WCAG 2.2 2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum).
Coarse-pointer usability takes priority over compact presentation. Required
actions wrap at narrow widths instead of being clipped or hidden.

### Appearance preferences

The existing `ThemeProvider` exposes `theme`/`setTheme`, `density`/`setDensity`,
`motion`/`setMotion` and `transparency`/`setTransparency`, alongside its existing
base-color controls. There is no second preference provider.

| Preference | Values | Default | Persistence |
|---|---|---|---|
| Theme | `system`, `light`, `dark`, `glass` | `system` | `vite-ui-theme` unless the provider supplies another storage key |
| Density | `compact`, `comfortable` | `compact` | `agent-webui.density` |
| Motion | `system`, `reduce` | `system` | `agent-webui.motion` |
| Transparency | `glass`, `opaque` | `glass` | `agent-webui.transparency` |

The provider applies one theme class and root `data-density`, `data-motion` and
`data-transparency` attributes. System theme follows color-scheme changes.
Invalid stored values use safe defaults; unavailable storage leaves the current
controls usable without promising persistence. A system reduction request is
never overridden by a more expressive in-app choice.

## Focus

`src/index.css` defines one global focus style:

```css
:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

Every interactive primitive in `src/components/ui/` inherits this outline by
being a real `button`/`a`/form control, so a new component gets a visible
keyboard focus indicator for free as long as it reuses those primitives
instead of a bare `div`. Components that need a stronger in-context ring (for
example `ChatHeader`'s icon buttons) layer Tailwind's `focus-visible:ring-2
focus-visible:ring-ring` on the same `--ring` token rather than inventing a
new color.

## State tokens (status language)

Loading, empty, stale, denied, error, success and pending states are each
written out in text; color reinforces but never carries the distinction alone
(WEBUI-DESIGN-R006). `src/components/ui/status-message.tsx` (`StatusMessage`) is the
shared primitive for exactly this seven-state vocabulary, covering the one
case `BlockedState.tsx` does not (whole-panel/integration availability) —
the outcome of a single item, field or operation. Each state's label is
fixture-tested in `src/components/ui/__tests__/status-message.test.tsx` to
confirm every state renders text distinct from every other state. The
existing convention, used by `StatusMessage`, `BlockedState.tsx` and the view
loading/error fallbacks:

| State | Color cue | Required text |
|---|---|---|
| Loading | `muted-foreground` + spinner icon | An explicit "Loading…" (or equivalent) label stays in the DOM even when the spinner's motion is removed |
| Empty | `muted-foreground` | An explicit "No results" / "Nothing here yet" message, not a blank area |
| Stale | `amber`/warning utility | The word "stale" (or equivalent) next to the data |
| Denied | `destructive` | An explicit "denied" / "not permitted" message, not just a red border |
| Error | `destructive` | The actual error message text, associated to its field via `aria-describedby` where it is a form error |
| Success | `emerald`/success utility | An explicit "saved" / "succeeded" message |
| Pending | `muted`/amber | The word "pending" (or equivalent) next to the item |

## Reduced motion

State-linked transitions use `--motion-fast: 110ms`, `--motion-context: 180ms`,
`--motion-panel: 220ms` and `--motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1)`.
Current uses include control color feedback, map selection feedback and an 8px
map reveal. These token durations are not measured interaction/frame budgets.
State changes must not wait for an animation to finish; newer input retargets or
interrupts it. Never use idle visual activity or fabricated progress to make the
workspace appear dynamic.

`src/index.css` disables nonessential animation and transitions when the user requests reduced motion. All text, icons and layout remain visible:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

The in-app `motion: reduce` preference applies the same global floor through
`data-motion='reduce'`; `motion: system` leaves the operating-system media query
in force. Workspace map reveal is explicitly removed for either reduction path.
Text, status and available actions remain visible. First-paint behavior, repeated
input, cancellation and focus still require rendered qualification.

Components that need an explicit reduced-motion alternative beyond this
global floor (for example the chat drawer's open/close transition and its
decorative ping/pulse) also use Tailwind's `motion-reduce:` variant,
documented alongside the components it touches in
[`specs/browser-design-system/interaction-contract.md`](https://github.com/Knuckles-Team/agent-webui/blob/main/specs/browser-design-system/interaction-contract.md).
Every gesture-driven action in the reviewed journeys also has a plain click or
keyboard equivalent — see the same interaction contract.

## Reuse

Build new surfaces from `src/components/ui/` and these tokens; do not add a
parallel button, dialog, filter, tooltip, renderer or color system. A pattern
borrowed from an outside source is paraphrased in original wording only after
its license is checked, and never pulled in as a live or copied dependency.

## Qualification boundary

Canopy Glass extends `WEBUI-DESIGN-R002.1.1`, `WEBUI-DESIGN-R004.1.1` and `WEBUI-DESIGN-R005.2`. The shared-shell/Explore slice extends `WEBUI-APPS-R049.2.1`. This page documents source defaults
and interaction requirements, not full theme acceptance. Complete graph, editor,
run, administration and authentication review, all-route mobile parity, manual
accessibility, measured performance and installed-provider evidence remain open
under the existing specifications. A passing token audit or screenshot alone
cannot establish those outcomes.

### Quiet selection and aligned controls

Workspace navigation and selected records use a pale translucent fill without dark partial inset borders. Shared controls use 14px text, a 20px line height and aligned icons; selected navigation uses medium weight. Section and record titles retain a restrained hierarchy. Keyboard focus keeps its complete 2px perimeter outline, while semantic submit actions retain their contrasting colors. Forced colors use system selection and focus indicators.

Ordinary buttons, including attachment, microphone and options controls, share `--button-neutral` (translucent sage), hover and pressed fills, with no resting outline. Primary submit uses the stronger `--button-primary` fill and its semantic foreground. Keyboard focus remains outlined; destructive, disabled, opaque and forced-color states retain distinct accessible treatment. These button tokens refine controls only, not the approved panel or wallpaper values.
