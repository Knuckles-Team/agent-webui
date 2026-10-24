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

WEBUI-DESIGN-R002.1/R004.1/R004.2/R005.1/R010 extend the current token, accessibility and responsive owners. A single focused pane on small screens retains persistent context and a visible pane switcher. Larger screens progressively add related panes. Container/visual viewport constraints, content size and pointer capability determine layout, not a whitelist of device names. Test representative CSS dimensions and generated intermediate sizes; do not invent Galaxy Fold hardware specifications. Internal wide-data regions are labelled and keyboard-scrollable. Every editor, chart, admin action and leaf remains reachable.

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

## Canopy Glass workspace continuation — 2026-10-24

WEBUI-DESIGN-R002.1.1/R004.1.1/R005.2 extend the existing token, responsive
and motion owners. WEBUI-APPS-R049.2.1 owns the bounded shared-shell and
Explore list/detail implementation. This supersedes the earlier compact-header
presentation, not its retained state, map resizing, authority or focus contracts.

Extend `src/index.css`, `WorkspaceFrame.css`, the current `ThemeProvider` and
existing workspace components; do not create another theme provider, router,
primitive library or data layer. The design is original: reference imagery informs
material and hierarchy, not copied artwork, component markup or runtime APIs.
Use the repository's existing Arbora logo without tracing or replacing it and
keep same-origin Inter. Light and glass use calm ivory/sage; dark uses deep green.
Keep shell translucency separate from opaque native reading surfaces. No new
public asset, package or telemetry is required by this slice.

The topbar fills the workspace width, with visibly labelled Work, Explore and
Operate, current context, command/search entry and main actions. It expands into
rows rather than a centered capsule or hidden main-navigation menu. Appearance
and secondary utilities may use a disclosure; primary navigation and search may
not. Retain a keyboard/pointer-resizable map, its bounded persisted width and
explicit narrow-layout access. Give released space to the task center, not an
empty rail or fixed-width outer gutter. A selected evidence record can open useful
detail; no selection must not reserve a placeholder inspector. Long prose remains
bounded for reading while lists and graphs use available width.

Persist compact/comfortable and reduced-motion/opaque appearance choices through
the existing provider. Handle invalid or unavailable storage safely. Coarse-pointer
minimums win over compact spacing; a system reduction request wins over expressive
preferences. Retire previous theme classes on change and preserve unrelated root
classes. Narrow reflow does not remount Chat, discard query drafts, restart streams
or change navigation authority. Keep native links, modified clicks and the shared
manual/WebMCP destination dispatchers.

Use short transition tokens for actual state changes. Commit state immediately;
retarget repeated input instead of queueing full animations or stale completion
callbacks. Limit blur to shell chrome, at most two visible, nonnested layers.
Unsupported blur, reduced transparency, opaque preference and forced colors retain
the same text, states and controls. No moving wallpaper, perpetual shimmer,
ornamental graph activity, fake progress or idle animation loop.

### Rollout and acceptance boundary

First qualify the shared shell and existing Explore search → selection →
properties/relationships/history → collection journey. Reuse actual returned
metadata and readable list rows. Do not fabricate evidence, confidence, activity
or backend relationships to fill space. Keep empty, denied and failed states
honest and actionable. Subsequent graph, editor, run, administration, authentication
and remaining route work stays under R002/R003/R004/R005/R006 and
WEBUI-APPS-R049.1.2/R049.2; this slice cannot complete the redesign.

R010 retains declared device/browser/network/fixture provenance and all existing
budgets. Qualify 10,000 evidence records, a 2,000-node/5,000-edge graph and a
10-event-per-second run stream as initial evaluation fixtures, not supported-load
claims. Measure desktop and constrained-touch journeys; keep virtualization, LOD,
worker, cancellation, bounded-cache and idle-memory work open until proved. A
bounded screenshot or mounted test neither establishes field percentiles nor
accepts performance, all-route mobile parity or manual accessibility.

## Glass theme transitions

The existing WEBUI-DESIGN-R002 token owner includes the glass palette in `src/index.css`.
`ThemeProvider` must select one theme class and retire the previous palette when the user changes themes.
The provider must preserve unrelated root classes and resolve system selection from the current color preference.
Mounted transition tests cover repeated glass-to-light, glass-to-dark and glass-to-system changes.
These tests do not establish native task contrast or explain the reported glass screenshot defect.

## Command palette cancellation focus

Under WEBUI-DESIGN-R005.1, capture the actual focused opener when the modal opens.
On cancellation, restore a connected, visible, enabled opener or the visible command trigger.
The expanded header keeps the command trigger reachable through reflow.
If an opener is removed, choose a connected, visible fallback without opening a utility disclosure.
Native selection and URL navigation retain destination-owned focus rather than restoring stale context.

## Documentation screenshot refresh — 2026-10-24

WEBUI-DESIGN-R011 owns repeatable visual documentation of the workspace.
Capture the actual Work, Explore and Operate routes at existing narrow and wide sizes.
Use fixed synthetic responses, time, theme and reduced motion.
Wait for scene content, local fonts and layout. Refuse live backend traffic.
Persist PNG files and source/fixture/viewport provenance independently of reporters.
Update stable documentation paths only after the complete capture succeeds.
A read-only CI job publishes review artifacts, never repository writes.
Human review precedes committing refreshed images. The six documentation views
are not full responsive, provider, accessibility or design-system acceptance.

## Hosted Canopy feedback — 2026-10-24

R004.1.1 preserves a useful task region after narrow reflow: only the automatic
wide-screen map default collapses at narrow widths. Explicit Map/Focus map choices
and focused map controls remain available in a bounded scrollable region. Capture
top-entry and focused-task states separately; scrolling the task into view is not
evidence that the top header is clipped. The floating chat launcher's reserved
band remains a separate native-chat composition obligation until replaced.

R002.1.1 treats the stored `glass` theme as a compatibility alias for light. Show Canopy
light for either stored value, not two identical palette choices. Keep the existing
independent Glass framing/Opaque framing material control.
Assert effective classes, surface transparency and motion preferences in browsers.

### Work diagram scrollport integration

R004.1.1 must reveal an entire focused diagram scrollport. The expanded header
exposed clipping in the legacy equal-row Work composition. Size containment on
the graph-bearing route measures its actual grid/flex allocation. Cap only the
diagram viewport against that task height and the screen, retaining the existing
20rem maximum. An intrinsic 16rem block-size fallback prevents collapse in auto-height
embeddings. Keep internal pan, the equivalent dependency list and outer
workspace scrolling when content exceeds the screen. This is a bounded
integration correction, not native-chat composition acceptance.

### Forced-color selection readability

R002.1.1 must preserve readable selected labels under forced colors. Hosted pixels
exposed white text backplates over selected navigation labels. Use system Canvas
and CanvasText for selected content, with Highlight borders and existing weight
to mark selection. Keep automatic forced-color adjustment and recapture both
light and dark system palettes. Computed contrast alone cannot detect backplate
painting defects; actual screenshot review remains required.

### Work focus clearance correction (2026-10-24)

Hosted geometry isolated the remaining graph clipping to false launcher clearance.
Work already places chat in flow, but inherited a six-rem bottom scroll inset.
Native focus centered the diagram above its task scrollport edge.
Remove that inset only for Work; retain clearance where the floating launcher exists.
Require full diagram visibility after native focus, before browser-test reveal.
Keep responsive sizing, keyboard pan, and the equivalent dependency list unchanged.

The follow-up geometry check confirmed full native diagram visibility.
A nearly full-height details card still intersected the one-rem scroll inset.
Work now applies that clearance to focused controls through scroll margins instead.
Its unobstructed scrollport can show physically fitting content edge to edge.
Original wide and narrow whole-card visibility checks remain unchanged.
All viewport cases must expose every details field through keyboard scrolling.
Oversized low-height and enlarged-text cards require complete reachability, not simultaneous visibility.

### Retain the full viewport continuity obligation

R004.2 now separates bounded source continuity from complete device and surface acceptance.
R004.2.1 owns the retained implementation and current workspace tests.
R004.2.2 preserves every unfulfilled parent criterion, including native keyboard and fold behavior.
The canonical generator must leave R004.2 and its responsive ancestor open while that child is unspecified by implementation.
Preserve every acceptance criterion. Regenerate status with the canonical tool.

### Acceptance rollup correction — 2026-10-24

The source-delivery children did not exhaust their original parent acceptance criteria.
Explicit retained-acceptance children now preserve those obligations in canonical generated rollups.
Parent requirement text and qualified child evidence remain unchanged.
Regenerate every spec status and audit ancestor states after source and receipt commits.
The metadata regression must not create feature-acceptance bindings for retained work.
