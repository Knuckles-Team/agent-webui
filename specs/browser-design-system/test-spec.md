# Design-system verification

## Loaded branch browsing regression

`WorkspaceCommandBranches.test.tsx` covers native links, confirmed relationship
grouping, breadcrumb focus and retirement, including retirement while hidden by
search. Run `corepack pnpm exec playwright test --config e2e/workspace-branches.config.ts`
for the rendered Operate journey with synthetic identity and fleet responses.
Check keyboard drill-in, immediate ancestor return, global search and branch restoration.
Check 44 CSS px targets, no horizontal overflow, native surface selection and real Back/Forward. Capture 320-by-740, 740-by-320, 1440-by-900 and 587-by-913
CSS px layouts under both motion preferences.

This is partial WEBUI-DESIGN-R005.1 evidence for loaded branches. No camera
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
| Strict style policy | Built bundle served by `SecurityHeadersMiddleware` in headless Chromium | No `securitypolicyviolation` event for `style-src-elem` or `font-src`; each document nonce differs (WEBUI-DESIGN-R008, WEBUI-DESIGN-R009) |
| Offline review | Run synthetic journeys with local networking only | Accessibility review completes without remote critique or telemetry |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, and `pre-commit run --config .config/pre-commit.yaml --all-files` on the exact commit. E2E provisions local fixtures and browser; no live hosted environment is required for a PR. CCCC's configured staged rule rejects new functions above cyclomatic 10/cognitive 15 and regressions. Use configured jscpd and Dupehound if available; missing configuration is a gap. KISS requires adapting existing components and tokens before adding a primitive. Record automated accessibility findings plus manual keyboard/screen-reader notes and screenshot artifact digests in `tasks.md`.

## Responsive workspace acceptance matrix

The following are planned tests, not existing receipts. Test every registered static destination and representative authorized/denied dynamic leaves, including nested leaves deeper than three levels. Generate action cases from the shared census rather than hand-picking top-level pages.

| Requirement | Required proof |
|---|---|
| WEBUI-DESIGN-R002.1 | Token/layout snapshots and task-completion review at the declared viewport matrix. |
| WEBUI-DESIGN-R004.1 | All-route/action coverage at 320 CSS px, narrow/tall, low-height landscape, 4:3,16:9,32:9 and generated intermediate dimensions; no unsupported/mobile-only omission. |
| WEBUI-DESIGN-R004.2 | Resize during form editing, stream updates and graph navigation. Test keyboard-open and 200-percent zoom states without lost state or unreachable controls. |
| WEBUI-DESIGN-R005.1 | Keyboard/screen-reader/touch and reduced-motion journeys through deepest fixtures, interrupted transition and focus restoration tests. |
| WEBUI-DESIGN-R010 | Reproducible load/interaction traces, memory/idle checks and budget assertions plus reduced-motion tests on the exact release candidate. |

Run each relevant journey with loading, empty, stale, denied, unavailable, validation error, success and in-flight cancellation fixtures. Use synthetic tenant data. No auth tokens, private reasoning, real account data or secrets may appear in screenshots, tool results or logs. Existing source and security gates remain mandatory.

## Workspace density regression

`e2e/workspace-density.spec.ts` drives the rendered Explore route with synthetic
identity and unavailable-service fixtures. It checks a retained unsent query,
keyboard disclosure focus, no pane overflow, one/two-column geometry, and the
100rem maximum surface width at 320×740, 740×320, 1024×768, 1440×900,
2560×720 and 587×913. A 480px container inside a 1440px viewport proves the
layout depends on available workspace width. Screenshots and geometry are test
attachments. This is density evidence, not all-route parity, real-service
acceptance, screen-reader certification or semantic-zoom acceptance.

Run with `corepack pnpm exec playwright test --config e2e/workspace-layout.config.ts
e2e/workspace-density.spec.ts`. Existing Work, Explore and Operate rendered unit
suites cover retained actions and service states. No extra spec child is created.

## Partial viewport continuity regression

Run `pnpm exec playwright test --config e2e/workspace-viewport.config.ts` for
the rendered Explore query journey. It edits a draft while a synthetic response is pending, then changes viewport dimensions. Keyboard actions inspect results and return to the retained editor. One case uses native Chromium viewport
resize; another simulates visual-viewport occlusion independently of layout
viewport size. Both use reduced motion. Neither establishes native soft-keyboard,
fold hardware, browser zoom or live-provider acceptance.

`WorkspaceViewport.test.tsx` covers retained selection/focus, pinch-zoom reflow
avoidance, fallback without VisualViewport, and listener cleanup. These tests
do not complete WEBUI-DESIGN-R004.2; its broader acceptance remains open.

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

This evidence supports partial WEBUI-APPS-R046, WEBUI-APPS-R049 and WEBUI-DESIGN-R002.1/R005.1 delivery.
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

The compact header reuses the exact README PNG and checks that the browser loads its pixels.
Desktop checks cover one-row height, keyboard min/max rail sizing, pointer drag and persisted width.
Check reduced-motion animation removal and opaque forced-colors/reduced-transparency fallbacks.
Hit-test command-dialog close and assistant close controls above the shell header.
Unit tests cover retired portal slots, retained task identity and malformed or unavailable preference storage.
These checks do not establish live WebMCP, manual screen-reader, provider or complete migration acceptance.


## Native task contrast regression

Extend the existing identity journey under WEBUI-DESIGN-R002 and WEBUI-DESIGN-R002.1.
Measure native Operate headings, body text, labels, inputs, links and enabled buttons beside the shell.
Require at least six native task samples and a 4.5:1 contrast ratio for every sample.
Run light, dark and glass at the existing desktop and narrow widths.
This planned check does not establish browser acceptance or repair the reported glass contrast gap.

## Theme class retirement

`ThemeProvider.test.tsx` mounts the provider with a persisted glass preference.
Four cases switch repeatedly to light, dark, system-light and system-dark, then return to glass.
Each case requires exactly one theme class, persistent selection and preservation of unrelated root classes.
These mounted tests prove class retirement, not rendered palette contrast.
