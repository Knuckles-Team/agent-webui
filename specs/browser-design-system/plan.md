# Design-system architecture

## Reuse

`src/index.css` defines theme tokens. `src/components/ui/` supplies primitives; `src/lib/nav-registry.ts` supplies navigation; `src/components/atlas/` and `src/Chat.tsx` are the first journey surfaces. Reuse their actual components rather than cloning a button, dialog, filter, tooltip or renderer. Keep interaction rules in a concise local design contract and examples in tests/stories. The design contract defines focus ring, control label, touch target, contrast, responsive breakpoint behavior, reduced-motion replacement and status-language conventions. It should describe the visible behavior rather than prescribe a new framework.

## Interaction model

Inputs and actions expose name, role, state and error association. Dynamic results announce concise status through a live region without announcing entire datasets. A dialog receives focus on open and restores it on close. Destructive actions use a confirmation step bound to the selected object. Filter clauses use index/field/operator information in their labels. Keyboard interaction never depends on hidden hover controls. Touch gestures have visible buttons. A progress state has a cancel affordance only if cancellation is safe. Motion is removed or shortened under reduced-motion while state changes remain legible.

## Review evidence

Create synthetic chat, Atlas and operational-form fixtures. Cover viewport widths 320, 375, 768 and 1440px, with light/dark and reduced-motion variants. Commit small baseline/after screenshots only if the repository's artifact policy permits. Otherwise publish CI artifacts and record URLs/digests in `tasks.md`. No screenshot may contain real tenant, personal or secret data. Assess contrast and accessible names automatically, then perform keyboard and screen-reader manual review with a short result record. Check copied patterns and external text against licensing before adoption; do not add a telemetry network call.

## Fresh checkout

Run `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'`; browser tests start local host/API fixtures. Existing `pnpm run dev` and `dev:server` support exploratory review. All required evidence is generated from the checkout and CI fixtures, independent of a shared deployment.

## Free-scaling workspace design

WEBUI-DESIGN-R002.1/R004.1/R004.2/R005.1/R010 extend the current token, accessibility and responsive owners. A single focused pane on small screens retains persistent context and a visible pane switcher; larger screens progressively add related panes. Container/visual viewport constraints, content size and pointer capability determine layout, not a whitelist of device names. Test representative CSS dimensions and generated intermediate sizes; do not invent Galaxy Fold hardware specifications. Internal wide-data regions are labelled and keyboard-scrollable. Every editor, chart, admin action and leaf remains reachable.

Prefer compact native DOM controls and the existing primitives. Coarse-pointer 44 px targets can coexist with compact desktop 32–36 px targets when accessibility requirements allow. Suggested motion ranges are feedback 120 ms, panel 180–240 ms and semantic transition 240–320 ms, subordinate to measured budgets and reduced-motion preferences. Animations use transform/opacity where appropriate, are cancellable, and never become an essential information channel. No perpetual background decoration or continuous idle requestAnimationFrame. Respect CSP nonces and same-origin font requirements.

Reuse table virtualization, graph worker layout and LOD transport rather than adding a second renderer/data pipeline. Cancel superseded requests, bound streams and caches, preserve focus during virtualization and supply readable table/list alternatives to visual graphs. Acceptance reports fixture cardinality, browser/device, network, cold/warm state and measurement method. A failed budget remains open even if screenshots look good. Representative mobile and desktop journeys, not a single fast developer machine, determine release qualification.

## Consolidated workspace acceptance

WEBUI-APPS-R049.1/R049.2 define three primary contexts instead of page-per-feature navigation. Density and responsiveness must serve that redesigned composition. Preserving an old standalone page under a compact rail is not visual acceptance. Reuse accessible domain widgets inside the new context surfaces. Record task navigation and scrolling outcomes alongside performance, focus and viewport evidence.

## Loaded workspace branch navigation

Extend the existing command catalog for partial WEBUI-DESIGN-R005.1 and
WEBUI-APPS-R046.2.2 delivery. Branches and the flat searchable list consume the
same validated, caller-visible destinations. Context roots contain loaded leaves;
confirmed fleet capabilities nest under their server and trace nodes under their
loaded trace. No other relationship is inferred. Drilling changes readable DOM
content without camera travel, scaling text or adding browser-history entries.
Breadcrumbs return to any visible ancestor and restore focus; selecting a leaf
uses the existing typed dispatcher and retained workspace surface. Missing
branches retire immediately with their catalog. Full dynamic-leaf, shared-entity,
installed-provider and manual accessibility acceptance remain open.

The portalled command dialog shares the workspace's existing deferred focus
reveal and listener cleanup. Its height and placement follow the visual viewport
at normal scale. Resizing must keep a retained focused leaf reachable. Pinch zoom
does not reflow the workspace or force focus scrolling. Keyboard occlusion tests
using an overridden viewport height remain simulated evidence.

## Persistent loaded workspace frame

Extend the existing workspace requirements without new decomposition. Keep the
three-context rail and task surfaces. Add a persistent map/list of loaded
caller-visible destinations beside those surfaces. Let the URL select the map
branch. Native links, breadcrumbs and search use the existing typed dispatchers.
Presentation changes add no browser history. Preserve the stable chat instance
and all existing controls during viewport changes. Narrow layouts stack the map
and task surface with explicit focus controls. This bounded shell does not
migrate legacy pages or prove all dynamic leaves and installed providers.

## Scoped Arbora workspace identity

Use local shell tokens for the existing R002.1 hierarchy requirement.
Ivory surfaces, sage toolbar tones and forest selection distinguish the light workspace.
Dark and glass themes use deep green surfaces and pale sage selection.
Bark-colored relationship strokes show only the existing loaded branches.
The context rail, map controls and selected paths share this vocabulary.
Keep task content, assistant styling, global theme tokens and legacy pages unchanged.
Preserve readable type, target sizes, focus clearance and responsive capability access.
Use the exact README-referenced PNG brand asset without redrawing or tracing it.
Keep motion limited to short map reveal and control feedback, with a reduced-motion alternative.

Initially narrow workspaces disclose the map on request and retain that choice across resize.
Keep all map, list, filter and breadcrumb controls available through the keyboard.
Order the selected path by its actual loaded ancestry, with numbered steps and small indentation.
Reserve a narrow launcher dock outside the task scroll viewport while the assistant trigger is enabled.
Keep primary Work at full height and preserve assistant open/close focus behavior.
One context row hosts map and focus controls through owned slots, without a second toolbar.
Compact context and More disclosures retain keyboard access on narrow screens.
A default 14-rem map rail resizes between 12 and 22 rem while preserving center space.
Pointer and keyboard resizing persist a bounded presentation preference, not navigation state.
Natural translucent shell surfaces use modest blur, with opaque reduced-transparency and forced-colors alternatives.
Keep native task palettes and shared assistant components unchanged.


## Glass theme transitions

The existing WEBUI-DESIGN-R002 token owner includes the glass palette in `src/index.css`.
`ThemeProvider` must select one theme class and retire the previous palette when the user changes themes.
The provider must preserve unrelated root classes and resolve system selection from the current color preference.
Mounted transition tests cover repeated glass-to-light, glass-to-dark and glass-to-system changes.
These tests do not establish native task contrast or explain the reported glass screenshot defect.

## Command palette cancellation focus

Under WEBUI-DESIGN-R005.1, capture the actual focused opener when the modal opens.
On cancellation, restore a connected, visible, enabled opener or the visible command trigger.
If responsive layout hides both, focus the enclosing More summary without reopening its disclosure.
Native selection and URL navigation retain destination-owned focus rather than restoring stale context.
