# Design-system delivery

**States:** SPECIFIED → BUILDING → BUILT → ACCEPTED. Current: **SPECIFIED**; no full three-journey acceptance evidence is recorded.

- [ ] Inventory tokens and primitives on current main; publish the local token/interaction contract with light/dark values.
- [ ] Build synthetic chat, Atlas and operational-form fixtures and capture baseline viewport matrix.
- [ ] Audit WCAG 2.2 AA, keyboard, screen reader, responsive and reduced-motion behavior; rank defects by user impact.
- [ ] Repair defects by reusing existing components, including distinct repeated-filter labels and mobile wrapping.
- [ ] Run tests/quality gates and capture after screenshots on exact commit; verify no telemetry, duplicate primitives or unlicensed text.
- [ ] Attach merged commit, CI artifact digests and manual review, then mark ACCEPTED only if every listed test passes.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-DESIGN-R001`, `WEBUI-DESIGN-R002`, `WEBUI-DESIGN-R003`, `WEBUI-DESIGN-R004`, `WEBUI-DESIGN-R005`, `WEBUI-DESIGN-R006`, `WEBUI-DESIGN-R007`, `WEBUI-DESIGN-R008`, `WEBUI-DESIGN-R009`.

## Duplicate-primitive and telemetry audit (WEBUI-DESIGN-R007)

- [x] Add `src/components/ui/__tests__/no-duplicate-primitives.test.ts`: every exported primitive name in `src/components/ui/` resolves to exactly one file. Also assert that no telemetry/analytics/session-replay dependency is declared in `package.json` (WEBUI-DESIGN-R007).

## Strict style policy (WEBUI-DESIGN-R008, WEBUI-DESIGN-R009)

- [x] Self-host Inter and remove the remote font import (WEBUI-DESIGN-R008).
- [x] Add a per-document style nonce to `SecurityHeadersMiddleware` with tests (WEBUI-DESIGN-R009).
- [x] Pass the nonce to Radix Select and ScrollArea, and to react-remove-scroll through `__webpack_nonce__` (WEBUI-DESIGN-R009).
- [x] Patch out the sonner runtime style injection and import its bundled stylesheet (WEBUI-DESIGN-R009).
- [x] Add the browser probe as an e2e test that fails on any `securitypolicyviolation` event (WEBUI-DESIGN-R008, WEBUI-DESIGN-R009).
- [ ] Open a dialog, a select and a toast under the probe; the shell-only probe covers load-time injectors only.
- [x] Remove the `script-src` `eval` violation in the `api-validation` chunk; this is outside WEBUI-DESIGN-R009 scope.
- [ ] Rebuild the served bundle on the deployment host after merge.

## Responsive workspace extension: implementation and evidence open

- [x] Add container-width panes and bounded reading widths to Work, Explore and Operate under WEBUI-DESIGN-R002.1. Add keyboard-operable optional context disclosures. This is partial delivery.
- [ ] WEBUI-DESIGN-R002.1: Complete screenshot/task review and attach merged-revision acceptance evidence.
- [ ] WEBUI-DESIGN-R004.1: Implement full mobile and arbitrary-aspect feature parity. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.
- [x] Add retained workspace visual-viewport sizing, safe-area padding and deferred focused-control reveal under WEBUI-DESIGN-R004.2. This is partial delivery.
- [ ] WEBUI-DESIGN-R004.2: Complete fold, native keyboard, 200-percent browser zoom, stream and graph acceptance. Attach the exact merged revision and evidence.
- [ ] WEBUI-DESIGN-R005.1: Implement accessible interruptible semantic zoom. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.
- [ ] WEBUI-DESIGN-R010: Implement measured performance under representative load. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.

## Workspace density validation

On the topic worktree based on `4879ff7c79c4ff2ff84722ae61c717d423fe425e`:

- Workspace component regression suite: 12 files, 93 tests passed.
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed, including regeneration of packaged frontend assets.
- `workspace-density.spec.ts`: passed in Chromium with reduced motion, six
  viewport screenshots and constrained container geometry.
- `mkdocs build --strict`: passed.

These receipts cover partial layout work under WEBUI-DESIGN-R002.1. The full
requirement remains open. They do not establish all-route mobile parity, real-service task completion, manual
screen-reader acceptance, semantic zoom, or release acceptance. The generated
status remains authoritative after merge; no status file is hand-edited.

## Partial viewport continuity evidence

The retained workspace boundary sizes to the visual viewport at normal scale.
It preserves mounted editors and reveals focus after resized scroll areas settle.
Pinch zoom keeps the existing layout. Short viewports can scroll the workspace
chrome and task area instead of reducing the task area to zero.

Validation on the topic branch based on `3d49ff399e1653c8b68689544a1b5f1699e7b4b4`:

- Workspace component suite: 13 files, 95 tests passed.
- Two rendered query journeys passed in Chromium with reduced motion.
  Native viewport resize and simulated keyboard occlusion retain drafts and pending results.
- Three existing Work browser journeys passed, including task inspection and cancellation review.
- Typecheck, focused ESLint, production asset regeneration and strict documentation build passed.

This is partial WEBUI-DESIGN-R004.2 evidence. Native soft-keyboard, fold-device,
200-percent browser zoom, stream and graph journeys, manual accessibility and
live-provider acceptance remain open. Synthetic identity and API responses do
not establish authenticated service acceptance.

## Browser zoom and keyboard continuation

- [x] Reserve scroll range and focus clearance for the former floating assistant trigger in Explore and Operate. The native-assistant continuation supersedes that exclusion with normal document flow.
- [ ] Complete WEBUI-DESIGN-R004.2 acceptance across all workspace journeys and native devices.

The native Chromium zoom regression reproduces a partially obscured Run Query
button before this repair. It uses Tab, Shift+Tab, Enter and Space to edit,
submit, inspect results and return to the retained draft. Browser zoom is set
to 200 percent in a fresh profile. The test records the browser zoom value,
doubled pixel ratio, halved CSS viewport width and unchanged visual-viewport scale.
This is partial evidence; the full requirement remains open. It does not establish physical fold-device, native soft-keyboard, manual screen-reader or live-service acceptance.

## Loaded destination branch delivery

- [x] Present the existing validated command catalog as native DOM branches and a flat searchable list.
- [x] Nest only confirmed fleet capabilities and selected-trace nodes beneath their loaded parents.
- [x] Restore breadcrumb focus, retain the branch while searching, and retire unavailable entries.
- [ ] Complete WEBUI-APPS-R046.2.2 and WEBUI-DESIGN-R005.1 acceptance across deepest dynamic leaves, real touch, manual screen readers and installed providers.

This bounded source implementation uses main `c5c8ce0a3b5b9a09f30c5f9098a83407be396c22`.
Branch drill-in is instantaneous native DOM navigation, not camera animation.
It adds no browser-history entries until a destination is selected. The existing
catalog bounds and typed dispatchers remain authoritative. It does not migrate
legacy pages, infer backend relationships or complete the broad parent rows.


Validation on this branch:

- Workspace component suite: 14 files, 101 tests passed.
- Branch browser journeys: 2 passed, with normal and reduced motion across four viewport shapes.
- Existing viewport continuity journeys: 2 passed, including simulated keyboard occlusion.
- Native Chromium 200-percent zoom journeys: 3 passed at 1280, 640 and 740 physical pixels.
- Production asset regeneration, TypeScript compilation and strict documentation build passed.

The browser fixtures supply synthetic identity and API responses. They are not
live-provider or manual screen-reader acceptance. Earlier runs exposed hidden
focus after dialog resize and animation settling. The shared viewport hook now
repairs both cases. The final browser chain ran on unchanged source.

Rendered captures use synthetic fleet data. The desktop capture is
`branches-1440x900.png`, SHA-256 `1a697b1fe14272569417f50929f08d02d6b62ed0b8aa6b5a15624b1eb481480d`.
The narrow capture is `branches-320x740.png`, SHA-256
`31e22b9af6b865d0b056c13e8a4ab15161cbafe1e38328172122c9d5f4873ad3`.
The browser test writes these files into its configured output directory.


## Glass class retirement

- [x] Add glass to the provider theme type and retire its root class when selection changes.
- [x] Exercise repeated light, dark and both system-preference transitions with four mounted regression cases.
- [ ] Resolve the reported native glass task contrast gap with rendered regression evidence.

All four mounted cases failed before class cleanup and passed after it.
This result does not prove native task contrast or complete WEBUI-DESIGN-R002 acceptance.

## Palette cancellation focus

- [x] Reproduce shortcut Escape, shortcut Close and desktop-to-narrow hidden-trigger failures in mounted Radix tests.
- [x] Restore a reachable opener or visible More summary without reopening the compact disclosure.
- [x] Cover removed opener and native destination focus preservation in mounted tests.
- [x] Run the focused three-theme rendered cancellation cases on a supported browser runner.

The three original mounted cases failed before the repair and passed afterward.
All six new mounted cases and thirteen existing command tests passed locally.
This evidence leaves native glass text contrast and broader design acceptance open.


## Hosted palette and native contrast evidence

The Ubuntu Chromium job on source `07138071486168669dbc7887591a08a4eaec630e` passed all three palette cancellation cases.
Its light and dark identity journeys passed. Glass failed the native route description at 4.3300:1 against a 4.5:1 target.
An alpha-aware token regression reproduced the insufficient glass muted-text contrast locally before the token change.
The repair brightens only the glass muted-text token; dark and light palettes remain unchanged.
Rendered confirmation of this repair remains pending. No whole-theme or full accessibility acceptance follows from this focused evidence.


## Hosted drag actionability

The hosted run on `db91e9ad7aecdc25ca85c2c6d56b134aea455a4c` passed glass identity and native text readability.
Dark identity and all three palette cancellation cases also passed.
Light stopped at the pointer-resize assertion: the expected 14-rem width remained 22 rem.
The fixture now waits for a stable, actionable separator after keyboard resizing before beginning the raw drag.
It retains the same 14-rem result and preference-persistence assertions. Fresh full-matrix confirmation remains pending.

## Documentation screenshot refresh

- [x] WEBUI-DESIGN-R011: qualify all six synthetic workspace captures in hosted Chromium and inspect the actual pixels.
- [x] WEBUI-DESIGN-R011: import the six reviewed PNGs and provenance; update README/docs images and pass the integrity command.
- [x] WEBUI-DESIGN-R011: qualify the published asset head with hosted lint, tests, hooks and browser verification.

Hosted [run 40120522758](https://github.com/Knuckles-Team/agent-webui/actions/runs/40120522758)
passed all six captures, the screenshot contract tests, and the existing identity/catalog browser journeys.
The downloaded artifact passed archive digest verification. Pixel review covered all six PNGs before import.
The clean rendered source is `167797965f7942f6849e44201fbb081f93ed37f1`, the Actions merge of `caf326ad` onto `99c31995`.
The light-theme images use Linux Chromium 156.0.8078.4 and the fixed `workspace-docs-v1` fixture.
Visible text and controls were readable with no unexpected overlap, horizontal clipping, loading state or error alert.
Narrow views show their initial viewport; scrollable panels continue below it.
The manifest and six image digests pass `pnpm screenshots:check`.

Local Chromium cannot start in this environment. Full local ESLint hit the memory limit; hosted qualification was explicitly approved.
Asset head `033e3154911e595f7bf899cc6274cdee8a97964c` passed
[run 40121492380](https://github.com/Knuckles-Team/agent-webui/actions/runs/40121492380), including full lint/typecheck, PR tests, hooks, Python compatibility and browser verification.
A second artifact reproduced five PNGs byte-for-byte. Operate wide differed only at 20 border pixels by one RGB level, with no content or layout change.
Pixel review confirmed the second output. No bit-exact cross-run rasterization guarantee is made.
Only R011 qualifies for delivery; final PR validation and review remain merge requirements.
This bounded workflow does not complete the earlier design requirements.

## Canopy Glass continuation — 2026-10-24

- [x] Define WEBUI-DESIGN-R002.1.1/R004.1.1/R005.2 and the original material, expanded-header, density, motion and fallback contract before runtime changes.
- [ ] R002.1.1: Implement shared token/material and compact/comfortable appearance behavior; qualify actual contrast, coarse-pointer sizing and storage fallback.
- [ ] R004.1.1: Implement full-width visible context/search/action rows and optional real detail; qualify resize, map sizing, focus, zoom and retained drafts.
- [ ] R005.2: Implement interruptible state-linked motion and system/in-app reduced effects; qualify initial paint, repeated input, cancellation and idle behavior.
- [ ] Record exact source, scoped validation results and reviewed rendered artifacts for WEBUI-APPS-R049.2.1. Never mark a planned browser test as passed.
- [ ] R002/R003/R004/R005/R006: Complete graph, editor, run, administration, authentication and remaining route theme/state/accessibility rollout.
- [ ] R004.1/R004.2/R005.1: Complete all-route mobile, arbitrary-aspect, native zoom/keyboard/fold, touch and manual screen-reader acceptance.
- [ ] R010: Qualify declared representative loads, interaction/frame budgets, memory/idle behavior and constrained-device fallback.
- [ ] WEBUI-APPS-R049.1.2/R049.2/R050: Complete capability migration, measured redesign and composed-provider acceptance.

This section records specification work only. Local implementation and synthetic
source/browser results must be recorded separately when available. Earlier hosted
screenshots and compact-header receipts remain historical, not Canopy Glass
acceptance. No broader completion follows from the shared-shell/Explore slice.

## Viewport continuity evidence partition

- [x] WEBUI-DESIGN-R004.2.1: Retain the existing bounded viewport and query source evidence.
- [ ] WEBUI-DESIGN-R004.2.1: Qualify compact native chat after the enlarged-text clipping repair; retain actual browser captures.
- [ ] WEBUI-DESIGN-R004.2.2: Complete every remaining parent obligation with exact-candidate browser and native-device evidence.

R004.2 remains open until both children meet their complete criteria.
The residual child retains fold, native keyboard, safe-area, stream, graph and all-surface continuity acceptance.
Do not infer that authored test bindings complete those journeys.

## Retained acceptance ledger correction — 2026-10-24

- [ ] WEBUI-DESIGN-R002.1.2: Complete the remaining density, hierarchy, token documentation and contrast acceptance inherited from R002/R002.1.
- [ ] WEBUI-DESIGN-R004.1.2: Complete the remaining all-route/action responsive acceptance inherited from R004.1.

The original parent obligations and qualified source-child receipts remain intact.
The generated ancestor state must remain open while either retained acceptance child remains open.
Metadata guard tests preserve this distinction; they are not feature-acceptance evidence.

## Context-aware wallpaper delivery

- [ ] WEBUI-DESIGN-R005.3: Add context/manual scene selection through the existing provider and shared frame. Qualify Canopy/Fluid first, then evidence-bound connector roots, harness trunk and knowledge branches/leaves.
- [ ] WEBUI-DESIGN-R005.4: Add wallpaper motion controls and lifecycle safeguards. Prove reduction, interruption, contrast and static fallback through real controls. Record exact-candidate R010 resource evidence without closing broader acceptance.
- [ ] WEBUI-DESIGN-R005.5: Add opt-in weather following and labelled manual previews after the scene proof. Qualify provider/location scope, freshness states and glass-safe effects. Keep default idle tests and all broader acceptance open.

## Named palette source continuation

- Extended R002.1.1 before implementation; reused the colorizer and legacy accent
  storage rather than adding another theme wrapper or preference store.
- Added seven named Settings choices, bounded shared state/focus tokens, green
  reset and material/accessibility fallbacks. Semantic statuses stay independent.
- Scoped deterministic token, colorizer, Settings/provider and consent tests pass.
  Exact-candidate browser gallery and aggregate gates remain outstanding; this
  bounded implementation does not close parent design acceptance.

### Route-derived scene follow-on

- [x] Extend R005.3 through the existing appearance selector and canonical route ID, preserving manual overrides and Off by default.
- [x] Add scoped mapping, static lifecycle and manual override coverage.
- [ ] Qualify exact-head rendered navigation, draft retention and unchanged default glass in hosted browser CI before merge.
- [ ] Keep evidence-bound activity and broader R010 performance acceptance open; page selection alone supplies neither.

- [x] WEBUI-DESIGN-R005.3.1: Implement route-derived selection and manual overrides; exact-head hosted qualification remains required.
- [ ] WEBUI-DESIGN-R005.3.2: Connect current Arbora evidence before adding activity or topology; qualify all rejection cases.

## Overstory documentation capture refresh — 2026-10-25

- WEBUI-DESIGN-R011: Import the six successful synthetic browser captures from
  CI run `40230399141`, artifact `12613176256`. The recorded clean source is
  `aeb9d63307a363027d6c0f022297232f1bdac632`, the tested merge of final naming
  head `8cb5d30ae7490fa5cf25e7b8630c723d0505b395` with `e310d997`.
- Review all six initial viewports. Preserve shared README/gallery asset paths,
  original PNG digests and the lossless Knowledge WebP delivery receipt.
  All delivered images remain below one million bytes and match captured pixels.
- This refresh illustrates the branded interface. It does not establish live
  provider availability or close broader design acceptance.
