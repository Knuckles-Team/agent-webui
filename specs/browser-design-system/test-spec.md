# Design-system verification

## Loaded branch browsing regression

`WorkspaceCommandBranches.test.tsx` covers native links, confirmed relationship
grouping, breadcrumb focus and retirement, including retirement while hidden by
search. Run `corepack pnpm exec playwright test --config e2e/workspace-branches.config.ts`
for the rendered Operate journey with synthetic identity and fleet responses.
Check keyboard drill-in, immediate ancestor return, global search and branch restoration.
Check 44 CSS px targets, no horizontal overflow, native surface selection and real Back/Forward. Capture 320-by-740, 740-by-320, 1440-by-900 and 587-by-913
CSS px layouts under both motion preferences.

This is partial OVERSTORY-DESIGN-R005.1 evidence for loaded branches. No camera
animation or scaled screenshot is introduced. Full dynamic depth, real touch,
manual screen-reader, native-device and installed-provider acceptance remain open.

## General verification matrix

| Test | Fixture | Pass |
|---|---|---|
| Token contrast | Light/dark token table | Text and controls meet WCAG 2.2 AA contrast where applicable |
| Keyboard and focus | Chat, Atlas filter/query/result, operational form | Full task completion, visible focus, correct dialog focus restore |
| Accessible names | Repeated Atlas clauses and error forms | Unique names, associated errors, sensible announcements |
| Responsive | 320/375/768/1440px screenshots | No overflow or unreachable primary action |
| Motion and touch | Reduced-motion and touch profile | Equivalent action/feedback without gesture or animation |
| States | Loading/empty/stale/denied/error/success fixtures | Text distinctions, no color-only meaning |
| Reuse/privacy | Source/asset/dependency audit | No duplicate primitive, real-user data or telemetry request |
| Skill distillation | Compare each adopted rule with existing public skill and component ownership | Distinct rule has license record, owner, example and failing/passing UI check; duplicate names and copied text rejected |
| Strict style policy | Built bundle served by `SecurityHeadersMiddleware` in headless Chromium | No `securitypolicyviolation` event for `style-src-elem` or `font-src`; each document nonce differs (OVERSTORY-DESIGN-R008, OVERSTORY-DESIGN-R009) |
| Offline review | Run synthetic journeys with local networking only | Accessibility review completes without remote critique or telemetry |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, and `pre-commit run --config .config/pre-commit.yaml --all-files` on the exact commit. E2E provisions local fixtures and browser; no live hosted environment is required for a PR. CCCC's configured staged rule rejects new functions above cyclomatic 10/cognitive 15 and regressions. Use configured jscpd and Dupehound if available; missing configuration is a gap. KISS requires adapting existing components and tokens before adding a primitive. Record automated accessibility findings plus manual keyboard/screen-reader notes and screenshot artifact digests in `tasks.md`.

## Responsive workspace acceptance matrix

The following are planned tests, not existing receipts. Test every registered static destination and representative authorized/denied dynamic leaves, including nested leaves deeper than three levels. Generate action cases from the shared census rather than hand-picking top-level pages.

| Requirement | Required proof |
|---|---|
| OVERSTORY-DESIGN-R002.1 | Token/layout snapshots and task-completion review at the declared viewport matrix. |
| OVERSTORY-DESIGN-R004.1 | All-route/action coverage at 320 CSS px, narrow/tall, low-height landscape, 4:3,16:9,32:9 and generated intermediate dimensions; no unsupported/mobile-only omission. |
| OVERSTORY-DESIGN-R004.2 | Resize during form editing, stream updates and graph navigation. Test keyboard-open and 200-percent zoom states without lost state or unreachable controls. |
| OVERSTORY-DESIGN-R005.1 | Keyboard/screen-reader/touch and reduced-motion journeys through deepest fixtures, interrupted transition and focus restoration tests. |
| OVERSTORY-DESIGN-R010 | Reproducible load/interaction traces, memory/idle checks and budget assertions plus reduced-motion tests on the exact release candidate. |

Run each relevant journey with loading, empty, stale, denied, unavailable, validation error, success and in-flight cancellation fixtures. Use synthetic tenant data. No auth tokens, private reasoning, real account data or secrets may appear in screenshots, tool results or logs. Existing source and security gates remain mandatory.

## Workspace density regression

`e2e/workspace-density.spec.ts` drives the rendered Explore route with synthetic
identity and unavailable-service fixtures. Its earlier baseline checks a retained unsent query, keyboard disclosure focus, pane overflow and one/two-column geometry. That baseline enforced a 100rem maximum surface width at 320×740, 740×320, 1024×768, 1440×900, 2560×720 and 587×913. A 480px container inside a 1440px viewport proves the
layout depends on available workspace width. Screenshots and geometry are test
attachments. This is density evidence, not all-route parity, real-service
acceptance, screen-reader certification or semantic-zoom acceptance.

Run with `corepack pnpm exec playwright test --config e2e/workspace-layout.config.ts
e2e/workspace-density.spec.ts`. Existing Work, Explore and Operate rendered unit
suites cover retained actions and service states. The Canopy Glass children below
replace the maximum-width assumption for working lists, not bounded reading prose.

## Partial viewport continuity regression

Run `pnpm exec playwright test --config e2e/workspace-viewport.config.ts` for
the rendered Explore query journey. It edits a draft while a synthetic response is pending, then changes viewport dimensions. Keyboard actions inspect results and return to the retained editor. One case uses native Chromium viewport
resize; another simulates visual-viewport occlusion independently of layout
viewport size. Both use reduced motion. Neither establishes native soft-keyboard,
fold hardware, browser zoom or live-provider acceptance.

`WorkspaceViewport.test.tsx` covers retained selection/focus, pinch-zoom reflow
avoidance, fallback without VisualViewport, and listener cleanup. These tests
do not complete OVERSTORY-DESIGN-R004.2; its broader acceptance remains open.

## Native browser zoom regression

Run `pnpm exec playwright test --config e2e/workspace-zoom.config.ts` for actual
200-percent Chromium zoom. A permission-free local extension sets the browser
tab zoom in an isolated temporary profile. This does not simulate zoom through
CSS, device-scale emulation or pinch scaling. The test checks focus visibility
across each control's center and edges, keyboard query execution, result
inspection and retained edits. Window widths are 1280, 640 and 740 pixels.
Each journey uses reduced motion and synthetic identity/API responses.


## Persistent loaded workspace map evidence

Run `pnpm exec playwright test --config e2e/workspace-persistent.config.ts`.
The synthetic journey selects a fleet child and capability through the persistent map.
It checks URL state, Back/Forward, native task focus and retained unsent chat DOM.
Map/list presentation adds no history. Four viewports cover desktop, narrow, landscape and irregular dimensions.
Each viewport checks focused link hit targets with normal and reduced motion.
A separate isolated Chromium profile checks keyboard navigation at actual 200-percent tab zoom.
The browser extension sets native zoom; it does not emulate CSS scaling.
`WorkspaceFrame.test.tsx` checks callback retirement and stable task DOM across map and legacy layout changes.

This evidence supports partial OVERSTORY-APPS-R046, OVERSTORY-APPS-R049 and OVERSTORY-DESIGN-R002.1/R005.1 delivery.
The existing broad requirements and tasks remain open.
The map includes loaded admitted destinations, not every legacy capability or dynamic leaf.
Live authentication, installed providers, manual screen readers and physical fold hardware remain unverified.

The persistent-map keyboard matrix also covers filter, list selection, breadcrumb return and three Back/Forward cycles.
It runs at narrow width and native 200-percent zoom with normal and reduced motion.
Edge hit tests include the fixed assistant trigger and its animated halo.
The outer workspace scrollport reserves focus clearance when the persistent frame is active.
This supplements the existing four-viewport continuity journey, including short landscape.

## Scoped workspace identity evidence

Run `pnpm exec playwright test --config e2e/workspace-identity.config.ts`.
Assert the actual light, dark or glass root class before testing each theme.
Capture desktop and narrow layouts with a loaded selected capability.
Check rendered shell text contrast at 4.5:1 or greater, including the hovered current context.
Check that selected controls remain visible without frame overflow.
Run the persistent-map browser matrix for keyboard, history, reduced motion and native 200-percent zoom continuity.
The synthetic captures cover the owned shell, not a global theme audit or complete migration.
R002.1 and the broader design acceptance remain open.

Fresh 320-by-740 captures occur before focus or scroll, with the map initially closed.
Check at least 340 pixels of initial task height and visible header targets of at least 44 pixels.
Check initial visible readiness controls, then keyboard-reached fleet controls and bottom-scroll controls.
New main readiness content precedes the fleet filter; it is not forced above the fold.
Assert that the workspace viewport ends above the launcher's maximum halo extent.
Check assistant open/close layout and focus restoration, and full-height primary Work.
Expanded map controls retain native-zoom and reduced-motion coverage in the persistent browser matrix.
This evidence covers initial and tested focus/scroll states, not all provider content or manual accessibility.

The earlier compact-header baseline used the README PNG and one-row desktop geometry.
Canopy Glass supersedes that layout. Check the existing brand artwork loads and full-width header controls stay visible as rows wrap. The center must use released space.
Retain keyboard min/max rail sizing, pointer drag and persisted width checks.
Check reduced-motion animation removal and opaque forced-colors/reduced-transparency fallbacks.
Hit-test command-dialog close and assistant close controls above the shell header.
Unit tests cover retired portal slots, retained task identity and malformed or unavailable preference storage.
These checks do not establish live WebMCP, manual screen-reader, provider or complete migration acceptance.


## Native task contrast regression

Extend the existing identity journey under OVERSTORY-DESIGN-R002 and OVERSTORY-DESIGN-R002.1.
Measure native Operate headings, body text, labels, inputs, links and enabled buttons beside the shell.
Require at least six native task samples and a 4.5:1 contrast ratio for every sample.
Run light, dark and glass at the existing desktop and narrow widths.
This planned check does not establish browser acceptance or repair the reported glass contrast gap.

## Theme class retirement

`ThemeProvider.test.tsx` mounts the provider with a persisted glass preference.
Four cases switch repeatedly to light, dark, system-light and system-dark, then return to glass.
Each case requires exactly one theme class, persistent selection and preservation of unrelated root classes.
These mounted tests prove class retirement, not rendered palette contrast.

## Palette focus return

`WorkspacePaletteFocus.test.tsx` mounts the real Radix dialog and header disclosure.
Mock only layout rectangles because jsdom does not render responsive geometry.
Require native task focus after shortcut Escape and Close.
Require the visible command trigger after the original opener is removed or becomes hidden.
The expanded header must not require reopening More for command access.
A secondary utility disclosure retains its own explicit open state.
Selection must preserve focus assigned by the native destination.
The existing identity browser fixture adds light, dark and glass cancellation cases at 390 and 1440 pixels.
Extend those cases for shortcut, always-visible command trigger and desktop-to-narrow cancellation.
Cancellation preserves explicit utility disclosure state rather than opening a closed menu.
Mounted proof does not replace this pending rendered check or resolve native glass text contrast.

The PR-only `workspace-browser` CI job runs the existing focused identity configuration on Ubuntu Chromium.
It uses locked frontend dependencies, read-only repository permission and synthetic fixtures without live credentials.
The job includes native task readability assertions rather than excluding the known glass gap.
Its eventual rendered result must be recorded separately from local mounted test results.


## Translucent glass muted text

The token audit composites the glass page background over white before checking muted-text contrast at 4.5:1.
It reuses the existing OKLCH conversion and contrast helpers rather than treating the background as opaque.
The hosted identity journey remains the rendered check for native Operate descriptions and controls in each theme.

## Documentation screenshots

OVERSTORY-DESIGN-R011: run `pnpm screenshots:test` for fixture coverage and
manifest rejection of mismatched paths, dimensions, revisions, bytes and partial sets.
Run `pnpm screenshots:refresh` in Chromium, then `pnpm screenshots:check`.
The six captures assert loaded scene content, no alerts and no page overflow.
They reject external and unknown API requests. Inspect all six PNGs.
The provenance binds the source revision, viewport, theme, fixed synthetic fixture
and browser version to each image digest. Hosted artifacts must contain the
PNG files, not only attachment bodies. Full design acceptance remains open.

## Canopy Glass bounded-slice qualification

The following matrix is planned, not a receipt. Extend the existing provider,
workspace component and browser suites before claiming any listed result.

| Requirement | Proof seam | Required checks |
|---|---|---|
| OVERSTORY-DESIGN-R002.1.1 | `design-tokens.test.ts`, `ThemeProvider.test.tsx`, rendered identity/Explore journeys | Check light/dark/glass native and composited contrast. Cover hover/selected/focus states, higher-opacity glass reading surfaces and original logo. Test compact/comfortable persistence and invalid/blocked storage fallback. |
| OVERSTORY-DESIGN-R004.1.1 | `WorkspaceContextRail.test.tsx`, `WorkspaceFrame.test.tsx`, rendered identity/density journeys | Use one full-width header. Keep labelled contexts, current context, search and main actions visible without opening More. Reject capsule/max-width working gutters, overflow and duplicate navigation. Check useful map resizing and optional selected detail. |
| OVERSTORY-DESIGN-R005.2 | Provider/frame/palette tests and actual rendered motion checks | Check system reduced motion from first render and in-app reduction precedence. Exercise immediate state on repeated input and close/cancel during transition. Reject stale callback focus and idle decoration. Retain all text. |
| OVERSTORY-APPS-R049.2.1 | `ExploreWorkspace.test.tsx`, shell/query/palette suites and rendered Explore journey | Retain query/results through each detail tool. Cover return, real Back/Forward and resize. Reject placeholder inspectors and auth/tool authority changes. |

Cover 320×740, 390×844, 844×390, 768×1024, 1024×768, 1440×900,
1920×1080, 2560×720 and generated intermediate dimensions. Include a constrained
container, low-height viewport, actual 200-percent browser zoom, 200-percent text
enlargement and 400-percent zoom/reflow. Do not replace these with CSS transforms.
Inspect initial paint before focus/scroll and resize during draft editing, pending
responses and selection. Main navigation stays visible; narrow map disclosure is
allowed. Preserve safe-area/visual-viewport and focus clearance above the assistant.
Record physical keyboard/fold/touch gaps separately from synthetic viewport tests.

Inspect all theme/density combinations, coarse-pointer 44 px targets, unsupported
blur, opaque preference, reduced transparency and forced colors. Contrast targets
remain 4.5:1 for normal text and 3:1 for meaningful boundaries/focus. Check actual
compositing, not just token values. Capture and review real rendered shell, list,
selected detail, errors and keyboard focus. Image provenance names exact source,
fixture, viewport and browser; old documentation captures are not new theme proof.

R010 performance acceptance stays open. Before traces, declare device/browser,
network, fixture and measurement method. Initial evaluation loads are 10,000
records, 2,000 graph nodes/5,000 edges and 10 stream events/second. Exercise scroll,
select, resize, navigation and reduced effects on desktop and constrained touch.
Retain p75 INP ≤200 ms, LCP ≤2.5 s, CLS ≤0.1, p95 visible local feedback ≤100 ms
and p95 frame interval ≤16.7 ms on the declared 60 Hz reference. Report unsupported
metrics; lab samples are not field p75. Check bounded memory, cancellation, idle
work and blur costs. Scoped fixtures do not prove these loads or broader budgets.

Manual screen-reader and full-route state/accessibility review remain open. Live-update pause, stable selection and graph/editor/run/administration/authentication rollout need separate evidence. All-leaf WebMCP equivalence and composed provider qualification remain open.
No result in this bounded matrix alone accepts the full redesign.


### Cross-view semantic fill safety

The Canopy palette also changes existing semantic-fill consumers outside Explore.
Cover the unsecured-install warning, destructive Badge, calendar marker and shared disabled controls.
Check paired foregrounds at rest and over 90% hover fills on each reading surface.
Disabled controls retain their disabled semantics and use solid muted text/background pairs, not reduced text opacity.
The hosted fixture must capture the dark security warning and disabled send control.
In both forced-color palettes, check the visible Arbora word uses CanvasText on Canvas.
Assert the brand link and its text color, contrast and actual screenshot appearance.

Preserve keyboard focus and scroll reachability beside the in-flow native assistant.
At short heights, keyboard-focus and hit-test the final relationship action.
Check 200% text enlargement separately from the existing native 200% browser-zoom journey.
Enlarged navigation must wrap without local or document overflow. These checks do not accept all-route accessibility.

### Hosted feedback regressions

Repeat the integrated Explore composition under StrictMode, including close and
reselection, rather than qualifying only the inner evidence component. Browser
coverage must retain the same focus assertions. Use accessible combobox names
for appearance controls. Capture fresh narrow entry, top-entry after resize,
explicitly expanded map and focused selected evidence separately. Assert the
header starts at the viewport top in entry captures. Automatic narrow map
collapse must leave visible task content. Explicit map expansion must stay
keyboard reachable without consuming the entire short viewport. The legacy
glass class must resolve the same light palette. Opaque and reduced-motion
assertions independently prove material and behavior rather than filename labels.

Narrow evidence interaction must click an actual result, then assert the selected
heading is focused and in the viewport. Close from that visible detail and assert
the retained search is focused and visible. Do not first click a lower inspector
control: Playwright scrolls it and mask missing application focus reveal.

## Viewport continuity evidence partition

OVERSTORY-DESIGN-R004.2.1 binds the existing viewport, query and native-assistant tests.
Preserve their draft, identity, focus, wheel-scroll and real-control hit assertions.
A compact assistant must not compress its composer into a hidden nested scrollport.
Keep actual candidate screenshots and failed cases visible until qualification passes.

OVERSTORY-DESIGN-R004.2.2 requires the full parent matrix, not another source-only fixture.
Exercise native keyboards, fold and orientation changes, safe areas and visual viewports.
Include interrupted streams and graph navigation across every applicable surface.
Check selection, history, drafts, progress and focus, plus readable 200-percent browser zoom.
Record exact revisions, device/browser conditions, results and remaining gaps.

## Retained acceptance verification

OVERSTORY-DESIGN-R002.1.2 retains the original density/hierarchy verification matrix and outstanding token/contrast review.
OVERSTORY-DESIGN-R004.1.2 retains the complete registered-route/action and dynamic-leaf matrix from R004.1.
Run the outstanding journeys with actual keyboard, touch, state and viewport coverage before claiming their acceptance.
The scoped Canopy shell, evidence and Work diagram fixtures do not replace those journeys.

The gate-wrapper metadata tests keep broad ancestor rollups open and preserve qualified source receipts.
Those data-only guards do not establish product acceptance.

### Intrinsic compact draft sizing

The retained two-line draft measures 229 CSS pixels in the 320-by-740 fixture.
Its working pane remains 300 pixels high, with no overlay or reserved launcher band.
Do not force that content into the old 224-pixel fixture cap.
Instead, require a useful working pane larger than the compact assistant and at least 200 pixels high.
Require adjacent task and assistant edges, ordinary scrolling, complete composer hit targets and retained draft text.
Enlarged-text cases retain their full keyboard and wheel reachability checks without fixed-height assumptions.

The 200-percent-text journey must inspect the remaining Message options label,
not only its accessible name. Preserve text bounds and keyboard reachability.
OVERSTORY-APPS-R005.4.1 removes the obsolete Ask, Plan and Code selector.
This presentation must not change action handlers or authority.

## Liquid Glass reference correction acceptance

R002.1.1/R004.1.1/R005.2: inspect actual alpha and backdrop-filter on the
header, map, collection, inspector and native assistant. Check transparent
ancestors, a static multihued field, 20–24 px framing and luminous edges.
Composite each authored material over the field's bounded darkest/lightest
colors for normal and muted text. Keep native controls/focus readable.

At 1440×900, the full-width inset header stays thin. The evidence region uses the released assistant width.
The idle assistant reserves no strip or third column. Capture selected list/detail and unselected card grid,
320 px mobile, dark, opaque and forced-color states. Record one short native
selection/disclosure video with normal motion and check reduced motion separately.
Review pixels against both references before claiming fidelity; fixtures do not
prove live-provider completeness or close broader parent requirements.


The 2026-10-25 desktop material baseline is approved at source `9478612`.
`design-tokens.test.ts` pins its palette and original wallpaper digest.
The next owner-requested refinement reduces the five light glass fill alphas by about 15 percent relative to that baseline.
The composited contrast tests remain unchanged; dark and accessibility fallback materials remain unchanged.
The real preview run `40157438929` records desktop/mobile, collection/detail and Agent disclosure with synthetic records.
Keep product-language clarity, all-route accessibility and required checks separate from this bounded visual approval.

The next synthetic capture uses plain-language Chat, Knowledge and Tools destinations.
Capture the actual visible default composer and first-use guidance at desktop and narrow widths.
Knowledge records use project documentation, setup notes and task results, not research-specific product labels.
Keep Settings and advanced data tools available through their native disclosures.
Keyboard-only skip controls must reveal with visible focus, without reserving idle header cells.
At 200-percent text, text-bearing header controls reflow rather than overflow fixed icon columns.
An expanded secondary assistant must remain reachable by ordinary wheel scrolling as well as focus.
These cases do not claim live-provider execution or full-route acceptance.

## Context-aware wallpaper acceptance

These cases describe future evidence, not existing implementation or accepted recordings.
Tests enter real appearance controls and the shared frame, not an isolated renderer demonstration.

| Requirement | Future proving tests | Positive and negative cases |
|---|---|---|
| OVERSTORY-DESIGN-R005.3 | Extend `WorkspaceFrame.test.tsx` and `canopy-glass.browser.ts`. | Follow context and manual override preserve Chat/Knowledge/Tools labels, navigation, drafts and identity. Assert Canopy/Fluid first. Assert Roots=connectors, Trunk=harness, Branches/leaves=knowledge and Light=workspace. Require matching supplied relationships/events for activity. Reject missing, stale, duplicate, unrelated and out-of-order events. Preserve the actual task graph. |
| OVERSTORY-DESIGN-R005.4 | Extend `ThemeProvider.test.tsx`, `WorkspaceFrame.test.tsx` and `canopy-glass.browser.ts`. | Assert Off/Subtle/Expressive, invalid/blocked storage, initial reduction and preference changes during motion. Interrupt repeated input and hide/show cycles without stale callbacks or replay. Exercise unavailable battery signals, resource fallback, unsupported rendering and context loss. Preserve text, focus, controls and contrast. |
| OVERSTORY-DESIGN-R005.5 | Extend `ThemeProvider.test.tsx`, `WorkspaceFrame.test.tsx` and `canopy-glass.browser.ts`. | Prove explicit provider/location opt-in, manual-preview labels and all seven conditions. Reject automatic GPS/network lookup, secret location, expired or mismatched responses and requests after disable. Cover unknown, stale, offline and unsupported states. Assert droplets/fog/snow spare content; heat preserves UI coordinates. |

Capture wide and 320px layouts in light/dark, opaque, reduced-motion, reduced-transparency and forced-color states.
Review brightest/darkest animation frames against existing 4.5:1 text and 3:1 control/focus targets.
Compare normal-motion recordings with separate reduced-motion evidence at the exact candidate revision.
Assert one shared renderer after opening panels, changing scenes or navigating repeatedly.
Assert zero wallpaper animation work while Off, reduced or hidden.
Without explicit ambience opt-in, settled scenes must schedule no continuous animation.
Expressive selection alone must never enable weather requests or ambient playback.
Effects must never add audio, sharp flashes, independent status announcements or pointer interception.

R010 evidence must name numeric frame-work, backing-pixel, allocation and memory-growth budgets before capture.
Retain all existing R010 latency, load and provenance targets; wallpaper tests do not replace them.
Measure identical Off/Subtle/Expressive runs, including streaming, selection, typing, resize and repeated scene replacement.
Run five-minute samples with ambience off/on and 25 scene replacements; record memory and live-resource counts before and after.
Missing measurement support remains an explicit acceptance gap, not a passing result.
Event/provider fixtures prove browser mapping only; served evidence remains necessary before claiming real activity or current-weather support.

## Named palette continuation

OVERSTORY-DESIGN-R002.1.1 adds deterministic per-palette light/dark action and neutral
state contrast, persistence, green reset and semantic-token isolation checks.
Mount Settings to exercise labelled palette selection and remount persistence.
Qualify real-browser light/dark, opaque, reduced-transparency and forced-colors
galleries separately; source tests do not establish composited pixel acceptance.

### Default frost regression

The R005.4 default must retain the accepted backdrop, not only its computed blur.
A 120-by-150 pixel crop starts at (1250, 600) in the approved 1440-by-900 desktop capture from runtime `83d52c8`.
This text-free inspector region compares exact pixels with motion disabled.
Active scenes use separate reviewed captures; their moving pixels do not use this static golden.

### Route-derived scene slice (R005.3)

Cover canonical route mapping, unknown-context neutral fallback, persisted manual
override and unchanged default zero-work photo. Verify Off remains static and route changes clean up effects. Exercise the actual workspace navigation and retained draft
with Follow workspace enabled in the existing browser suite. Keep the accepted
default pixel golden and reduced-motion coverage. No live-event acceptance claim.

R005.3.1 owns the route/manual tests above. R005.3.2 retains the parent event and
topology journeys, including stale, duplicate, unrelated and out-of-order rejection.
That evidence seam is not implemented or covered by the route selection tests.

### Subtle by default, with explicit opt-out (R005.4)

Test absent and invalid preferences, persisted Off, saved manual scenes and immediate opt-out.
Verify that mounting does not persist a default or overwrite any valid choice.
Default animation remains capped at 12 FPS; reductions and constrained resources remain static.
Keep hidden/offscreen cleanup, opaque/forced-color hiding and renderer fallback coverage.
The original glass golden explicitly selects Off and Canopy; new-default captures receive separate visual review.
