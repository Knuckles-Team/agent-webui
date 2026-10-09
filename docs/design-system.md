# Browser design system

Graph OS builds every browser surface from one set of tokens, primitives and
interaction rules rather than inventing new ones per view. This page documents
the current tokens sourced from [`src/index.css`](https://github.com/Knuckles-Team/agent-webui/blob/main/src/index.css)
and the `src/components/ui/` primitives that consume them, including the
contrast targets a new surface must meet. A token audit test
(`src/__tests__/design-tokens.test.ts`) checks this page's values against the
live stylesheet and computes the real contrast ratio for every pairing below,
so this document cannot silently drift from the source of truth.

## Color tokens

Values are [OKLCH](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch);
`:root` defines the light theme and `.dark` overrides it (a `.glass` theme
layers translucency on the dark palette for optional use). Normal text targets
**4.5:1** contrast against its background; large text, icons and meaningful
control boundaries or focus indicators target **3:1** — per
[WCAG 2.2 success criteria 1.4.3 and 1.4.11](https://www.w3.org/TR/WCAG22/).
Color is never the only signal for a state; see [State tokens](#state-tokens-status-language).

| Role (pairing) | Light | Dark | Contrast target |
|---|---|---|---|
| Foreground on Background | `oklch(0.145 0.012 265)` on `oklch(0.988 0.002 280)` | `oklch(0.96 0.005 260)` on `oklch(0.13 0.02 260)` | 4.5:1 |
| Primary-foreground on Primary | `oklch(0.98 0.005 260)` on `oklch(0.52 0.16 260)` | `oklch(0.10 0.015 260)` on `oklch(0.62 0.16 260)` | 4.5:1 |
| Secondary-foreground on Secondary | `oklch(0.22 0.01 280)` on `oklch(0.96 0.004 280)` | `oklch(0.96 0.005 260)` on `oklch(0.22 0.015 260)` | 4.5:1 |
| Muted-foreground on Background | `oklch(0.50 0.02 280)` on `oklch(0.988 0.002 280)` | `oklch(0.64 0.02 260)` on `oklch(0.13 0.02 260)` | 4.5:1 |
| Accent-foreground on Accent | `oklch(0.22 0.01 280)` on `oklch(0.95 0.04 260)` | `oklch(0.96 0.005 260)` on `oklch(0.20 0.04 260)` | 4.5:1 |
| Destructive text on Background | `oklch(0.58 0.24 27)` | `oklch(0.70 0.19 22)` | 4.5:1 |
| Ring (focus indicator) on Background | `oklch(0.52 0.16 260)` | `oklch(0.62 0.16 260)` | 3:1 |

## Typography

The body font is Inter, loaded in `src/index.css` with a system-UI fallback
stack (`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
sans-serif`) so text never disappears before the webfont loads. `index.css`
adds one custom size token, `--text-tiny` (`0.625rem` / 10px), for the
smallest captions and badges; every other size comes from Tailwind's default
type scale so it stays consistent with the rest of the ecosystem's tooling.

## Spacing and density

`--radius` (`0.625rem`) is the one spacing primitive in `index.css`; `-sm`,
`-md`, `-lg` and `-xl` are derived from it (`calc(var(--radius) ± Npx)`) so
corner rounding stays proportional across control sizes. Interactive density
follows the existing components rather than a separate scale: header and
launcher controls (`ChatHeader`, the chat FAB) use a 40px (`size-10`) touch
target, compact inline controls (Atlas filter clauses) use a 32px (`size-8`/
`h-8`) target, and no actionable control drops below 24px — consistent with
[WCAG 2.2 2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum).
Required actions wrap onto additional lines at narrow widths instead of being
clipped or hidden (see `FilterBar`'s `flex-wrap`/`min-w-0` layout).

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
(DS-05). `src/components/ui/status-message.tsx` (`StatusMessage`) is the
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

`src/index.css` disables nonessential animation and transition motion for
every element when the user has requested it, while leaving all text, icons
and layout fully visible:

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
