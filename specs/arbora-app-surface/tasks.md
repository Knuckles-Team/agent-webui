# Arbora shell and app delivery

No exact-head publication receipt is recorded.

- [ ] Inventory current brand identifiers, package consumers, generated assets, site links, consent keys and tool IDs on main.
- [x] Make browser title, metadata, web manifest, docs site name and README consistently present the Arbora brand, with a `site:brand:check` gate (part of `pnpm run build`) proving it. (WEBUI-APPS-R038; index.html/webmanifest already said "Arbora"; this fixes `mkdocs.yml` `site_name`/ecosystem entry and `README.md`'s heading, overview line and license line, and is deliberately scoped to brand copy only — no package, import or environment rename.)
- [ ] Add `apps` navigation and one typed `AppSurface` contract using existing route, contribution, WebMCP and renderer seams.
- [ ] Integrate Markets as first native consumer and add valid/invalid contributed-app fixtures.
- [x] Perform atomic public-name package and consumer cutover; regenerate assets and digests; document browser migration. (WEBUI-APPS-R039, WEBUI-APPS-R043, WEBUI-APPS-R002's remaining theme-token/asset-regeneration surface, WEBUI-APPS-R003: source commit 677a27e0f701eca99cad20887a0b5c4b8ec9734e exists on local branch feat/eh427-retire-review-20260926 but conflicts heavily with main — rename touches package.json, pyproject.toml, uv.lock, pnpm-lock.yaml and deletes files main already restructured; needs a fresh, smaller port, not a direct cherry-pick. The operator has not yet confirmed this package-identity rename; do not attempt it without that confirmation.)
- [ ] Run all test-spec gates, installed wheel and Pages build on exact commit; record consumer and publication evidence.
- [ ] Review every requirement after attaching browser, package and public-site evidence.
- [ ] **WEBUI-APPS-R004:** Run harness surface (rollup of 1 to 6)
- [ ] **WEBUI-APPS-R004.1:** Run read goes through the arbora read operations.
- [ ] **WEBUI-APPS-R004.2:** Applied harness configuration is shown.
- [ ] **WEBUI-APPS-R004.3:** Context use is shown against the budget.
- [ ] **WEBUI-APPS-R004.4:** Current plan is shown read-only.
- [ ] **WEBUI-APPS-R004.5:** Each termination reason has a distinct state.
- [ ] **WEBUI-APPS-R004.6:** Absent operation shows an honest state.
- [ ] **WEBUI-APPS-R030.1:** Graph edit types.
- [ ] **WEBUI-APPS-R030.2:** Send edits to arbora.
- [ ] **WEBUI-APPS-R030.3:** Wire graph handlers to the engine.
- [ ] **WEBUI-APPS-R030.4:** Show refusals on unauthorized edits.
- [ ] **WEBUI-APPS-R030.5:** Semantic filters and persona modes.
- [ ] **WEBUI-APPS-R030.6:** Edit log with verdicts.
- [ ] **WEBUI-APPS-R030.7:** Graph edit hot-path proof.
- [ ] **WEBUI-APPS-R031.1:** Memory file types.
- [ ] **WEBUI-APPS-R031.2:** Memory file operations.
- [ ] **WEBUI-APPS-R031.3:** Files tab in the memory view.
- [ ] **WEBUI-APPS-R031.4:** Authorized retained conflicts and head-free refusals.
- [ ] **WEBUI-APPS-R031.5:** Sync state labels.
- [ ] **WEBUI-APPS-R031.6:** Save evidence.
- [ ] **WEBUI-APPS-R031.7:** Memory files hot-path proof.

No task above names a requirement ID individually; together they must close every ID in [requirements.md](requirements.md) — `WEBUI-APPS-R038`, `WEBUI-APPS-R039`, `WEBUI-APPS-R040`, `WEBUI-APPS-R041`, `WEBUI-APPS-R042`, `WEBUI-APPS-R043`, `WEBUI-APPS-R044`, `WEBUI-APPS-R001`, `WEBUI-APPS-R002`, `WEBUI-APPS-R003`, `WEBUI-APPS-R004`.
- [ ] **WEBUI-APPS-R005:** Navigation and dashboards follow the signed-in user's role (rollup).
- [ ] **WEBUI-APPS-R005.1:** Nav entry declares a minimum role.
- [ ] **WEBUI-APPS-R005.1.1:** Registry role contract.
- [ ] **WEBUI-APPS-R005.1.2:** Rendered role filtering.
- [ ] **WEBUI-APPS-R005.2:** Layout saved per user.
- [ ] **WEBUI-APPS-R005.3:** Operate renders tiles for returned fleet children with source regression coverage. Complete connector catalog and connection-state acceptance remain open.
- [ ] **WEBUI-APPS-R005.4:** One chat session list.
- [ ] **WEBUI-APPS-R005.5:** Every route renders.
- [ ] **WEBUI-APPS-R005.5.1:** Census detects a throwing view.
- [ ] **WEBUI-APPS-R005.5.2:** Complete route render acceptance.
- [ ] **WEBUI-APPS-R005.6:** Each view states its purpose.
- [ ] **WEBUI-APPS-R005.6.1:** Registry purpose copy.
- [ ] **WEBUI-APPS-R005.6.2:** Rendered purpose visibility.
- [ ] **WEBUI-APPS-R006:** One panel relates goals, sessions and fleets (rollup).
- [ ] **WEBUI-APPS-R006.1:** Link type.
- [ ] **WEBUI-APPS-R006.2:** Panel reads typed operations.
- [ ] **WEBUI-APPS-R006.3:** Absent operation is honest.

- [ ] R030.7: implement the served browser → Arbora operation → fixture-engine journey and prove unauthorized edits leave durable graph state unchanged.
- [ ] R031.2 prerequisite: implement generated EG R085 and Arbora R024.4.1–.6 contracts through canonical invoke; prove registered same-origin hosting. Definitions exist, runtime proof remains missing.
- [ ] R031.7: implement served snapshot/conflict/refusal journeys and the unchanged-head observation-generation acknowledgment race. Retain and reload authorized versions. Prove redacted denied/revoked reads and browser acknowledgment refusal. Accept sync labels only from EG evidence. No client/host-handler/engine-transport mocks.

<!-- spec-definition-patch:consumer-definitions-20261012 -->
## Consumer implementation tasks

Unchecked tasks remain open. Definitions alone do not establish runtime delivery.

- [ ] **WEBUI-APPS-R004.7.1:** Implement and prove model for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.2:** Implement and prove behavior for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.3:** Implement and prove wiring for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.4:** Implement and prove refusal for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.5:** Implement and prove evidence for evolution evidence.
- [ ] **WEBUI-APPS-R004.7.6:** Implement and prove served acceptance for evolution evidence.
- [ ] **WEBUI-APPS-R006.4.1:** Implement and prove model for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.2:** Implement and prove behavior for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.3:** Implement and prove wiring for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.4:** Implement and prove refusal for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.5:** Implement and prove evidence for unified harness sessions.
- [ ] **WEBUI-APPS-R006.4.6:** Implement and prove served acceptance for unified harness sessions.
- [ ] **WEBUI-APPS-R004.8.1:** Implement and prove model for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.2:** Implement and prove behavior for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.3:** Implement and prove wiring for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.4:** Implement and prove refusal for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.5:** Implement and prove evidence for indexed usage analysis.
- [ ] **WEBUI-APPS-R004.8.6:** Implement and prove served acceptance for indexed usage analysis.
- [ ] **WEBUI-APPS-R030.8.1:** Implement and prove model for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.2:** Implement and prove behavior for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.3:** Implement and prove wiring for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.4:** Implement and prove refusal for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.5:** Implement and prove evidence for live graph convergence.
- [ ] **WEBUI-APPS-R030.8.6:** Implement and prove served acceptance for live graph convergence.
- [ ] **WEBUI-APPS-R001.1.1:** Implement and prove model for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.2:** Implement and prove behavior for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.3:** Implement and prove wiring for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.4:** Implement and prove refusal for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.5:** Implement and prove evidence for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.1.6:** Implement and prove served acceptance for retrieval quality comparison.
- [ ] **WEBUI-APPS-R001.2.1:** Implement and prove model for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.2:** Implement and prove behavior for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.3:** Implement and prove wiring for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.4:** Implement and prove refusal for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.5:** Implement and prove evidence for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.2.6:** Implement and prove served acceptance for bounded large-data charts.
- [ ] **WEBUI-APPS-R001.3.1:** Implement and prove model for column vector controls.
- [ ] **WEBUI-APPS-R001.3.2:** Implement and prove behavior for column vector controls.
- [ ] **WEBUI-APPS-R001.3.3:** Implement and prove wiring for column vector controls.
- [ ] **WEBUI-APPS-R001.3.4:** Implement and prove refusal for column vector controls.
- [ ] **WEBUI-APPS-R001.3.5:** Implement and prove evidence for column vector controls.
- [ ] **WEBUI-APPS-R001.3.6:** Implement and prove served acceptance for column vector controls.
- [ ] **WEBUI-APPS-R001.4.1:** Implement and prove model for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.2:** Implement and prove behavior for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.3:** Implement and prove wiring for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.4:** Implement and prove refusal for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.5:** Implement and prove evidence for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.4.6:** Implement and prove served acceptance for remote editor compatibility.
- [ ] **WEBUI-APPS-R001.5.1:** Implement and prove model for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.2:** Implement and prove behavior for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.3:** Implement and prove wiring for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.4:** Implement and prove refusal for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.5:** Implement and prove evidence for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.5.6:** Implement and prove served acceptance for meeting transcripts and summaries.
- [ ] **WEBUI-APPS-R001.6.1:** Implement and prove model for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.2:** Implement and prove behavior for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.3:** Implement and prove wiring for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.4:** Implement and prove refusal for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.5:** Implement and prove evidence for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.6.6:** Implement and prove served acceptance for bookmark knowledge views.
- [ ] **WEBUI-APPS-R001.7.1:** Implement and prove model for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.2:** Implement and prove behavior for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.3:** Implement and prove wiring for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.4:** Implement and prove refusal for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.5:** Implement and prove evidence for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.7.6:** Implement and prove served acceptance for sandboxed design artifacts.
- [ ] **WEBUI-APPS-R001.8.1:** Implement and prove model for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.2:** Implement and prove behavior for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.3:** Implement and prove wiring for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.4:** Implement and prove refusal for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.5:** Implement and prove evidence for interactive code explanations.
- [ ] **WEBUI-APPS-R001.8.6:** Implement and prove served acceptance for interactive code explanations.
<!-- /spec-definition-patch -->

- [ ] Reconcile exact specialized producer requirements, operation IDs and schema revisions before marking any source input definition-complete.
- [ ] Obtain owner-defined positive finite latency, layout and viewport bounds for R004.8, R030.8 and R001.2.
- [ ] Bind R006.4 acceptance to every entry in the complete versioned supported-harness manifest.

## Responsive workspace extension: implementation and evidence open

- [ ] WEBUI-APPS-R045: Implement complete capability and leaf census. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.
- [ ] WEBUI-APPS-R046: Implement one semantic workspace navigation state. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.
- [ ] WEBUI-APPS-R047: Implement native webmcp action equivalence. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.
- [ ] WEBUI-APPS-R048: Implement webmcp lifecycle and authority preservation. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.
- [ ] WEBUI-APPS-R049: Implement preserve every feature through the arbora redesign. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.
- [ ] WEBUI-APPS-R050: Implement composed deployment and shared-backend acceptance. Run the planned acceptance in test-spec.md. Attach the exact merged revision and evidence. No runtime result is claimed by this specification.

## Registered navigation source evidence

- [x] WEBUI-APPS-R046.1: Implement registered navigation controls and shared dispatch. Run the two bound source test files.
- [ ] WEBUI-APPS-R046.2: Complete dynamic deepest-leaf, semantic zoom and actual browser history/focus acceptance. Include keyboard, touch and rendered mobile layouts.

## Consolidated redesign delivery

- [ ] WEBUI-APPS-R049.1: Complete the destination-to-context migration matrix and classify every domain action.
- [ ] WEBUI-APPS-R049.1: Replace standalone layouts with contextual surfaces. Preserve compatible URLs and authorization.
- [ ] WEBUI-APPS-R049.1: Retire duplicate shells and redundant navigation after action and state parity tests pass.
- [ ] WEBUI-APPS-R049.2: Capture old task journeys and compare the actual three-context implementation.
- [ ] WEBUI-APPS-R049.2: Record navigation counts, scroll distances and viewport evidence. Keep failures and unfinished domains open.
- [ ] WEBUI-APPS-R049.1: Carry forward backend, safety, data and action tests. Replace page-layout assertions with consolidated workspace acceptance.
- [ ] WEBUI-APPS-R049.2: Stop cosmetic work on retired layouts. Test the new composition instead of matching old screenshots.

- [ ] WEBUI-APPS-R049.1.1: Bind retained Explore source tests and record their exact source revision and normal gate evidence.
- [ ] WEBUI-APPS-R049.1.2: Finish the destination migration and installed-browser capability matrix. Keep unfinished contexts and producer checks open.

- [ ] WEBUI-APPS-R049.1.3: Bind the retained Work source tests and preserve one existing Chat instance.
- [ ] WEBUI-APPS-R049.1.3: Check independent task/trace reads and typed navigation without claiming missing associations.
- [ ] WEBUI-APPS-R049.1.2: Qualify real producer associations and installed-browser lifecycle before claiming complete correlated Work investigation. Include the nested graph, public records and accessible deep-link journeys. Retain every earlier migration criterion.

- [ ] WEBUI-APPS-R049.1.4: Bind the retained read-only Operate discovery source and its focused tests.
- [ ] WEBUI-APPS-R049.1.4: Preserve filter focus, observed-admission isolation and partial catalog reporting.
- [ ] WEBUI-APPS-R049.1.2: Migrate connector configuration, host launch, containment, approvals, tool load/unload and execution with their actual upstream authority contracts. Qualify served discovery and native browser journeys separately.

- [ ] WEBUI-APPS-R049.1.5: Bind current-response task navigation without inferred trace relationships or execution authority.

- [ ] WEBUI-APPS-R049.1.6: Bind the bounded command catalog and shared selection tests. Keep other dynamic leaves and full migration open.

## Consent placement repair and remaining browser acceptance

- [x] WEBUI-APPS-R046.2.1: Repair consent prompt dismissal and management. Preserve explicit choice semantics and failed-storage denial through source regressions.
- [ ] WEBUI-APPS-R046.2.2: Complete every remaining R046.2 browser and all-leaf obligation. Include rendered consent clearance and mobile input journeys.

- [ ] WEBUI-APPS-R049.1.7: Bind integrated query/validation lens tests and preserve the existing maintainer boundary. Qualify real provider and browser behavior separately.

- [ ] WEBUI-APPS-R049.1.8: Bind attended editor and review tests. Check the trusted-event default in a real browser. Do not classify a provider request as a local tool mutation.

- [ ] WEBUI-APPS-R049.1.9: Bind loaded Work and Operate command adapters. Keep capability discovery separate from permission to call tools.

- [ ] WEBUI-APPS-R049.1.3: Qualify task refresh and attended cancellation against the served provider. Retain separate native browser and complete migration acceptance.

## R048 retained callback repair

- [x] Validate the R048 registration-lifetime guard with the document adapter and rendered navigation observer (99 focused WebMCP/navigation tests passed). Keep native browser, hidden-page retirement, replay, cross-origin, in-flight cancellation and served authority acceptance open. This partial repair does not complete R048.

## R048 hidden document source repair

- [x] Validate hidden-document registration cleanup, late acknowledgements and fresh registrations on return. The 98 focused tests passed.
- [ ] Keep native-browser qualification, full authority acceptance and in-flight cancellation open under R048.

## R048 cooperative execution source contract

- [x] Validate caller cancellation and registration retirement through the mounted provider and shared tool factory. All 108 focused tests passed.
- [ ] Qualify native-browser scheduling and served authority independently. Cooperative cancellation does not prove rollback or stop uncooperative handlers.

### R048 native replacement routing

Chromium 156 experimental WebMCP resolved a retained native Tool reference to a new same-name registration. Each native registration now has a unique routing name; the application registry retains the semantic tool ID. This prevents stale native references from selecting replacement callbacks. The rendered route, Back/Forward, deep-link and restoration matrix uses native discovery with synthetic backend responses. Authenticated served authority acceptance remains open; R048 is not complete.

R005.3 source progress: `OperateCatalogPanel` renders the existing enhanced catalog server projection. Registration availability is not connection state; keep the requirement unchecked pending connection and served acceptance.

R005.3 and R049.1.2 source progress includes selected connector definition inspection through the existing enhanced catalog adapter.
Full operational migration and provider connection acceptance remain unchecked.

R049.1.2 next source batch: contextual readiness diagnosis, selected-check inspection and explicit reprobe through the supported dashboard adapter.
Legacy alias retirement, complete migration and live-provider acceptance remain open.

R049.1.2 acceptance batch: preserve readiness failure parity and replace its standalone layout with a typed Operate compatibility adapter.
Qualify catalog and readiness actions, history, focus, keyboard and mobile access before recording completion of this bounded batch.

Bounded readiness alias and catalog/readiness action qualification passed desktop and mobile installed synthetic journeys.
Full R049.1.2 acceptance remains open, including other destinations, native controls, live providers and production identity.

## Cold-entry asset resolution

- [x] Replace relative production asset references with origin-root references;
  retain explicit Vite asset-base overrides.
- [x] Exercise generated default and prefixed script/style URLs (2 build tests).
- [x] Run cold Work, Explore and Operate entries and reloads against the installed
  Arbora composer and production WebUI static mount (3 browser tests passed).
- [ ] Complete R046.2.2 navigation and R050 provider acceptance independently.

The production build/typecheck and strict documentation build passed. The served
fixture used installed Arbora 0.1.7, Agent Utilities 3.1.0, SDK 0.2.2 and
epistemic-graph 2.27.5 with this candidate WebUI source and built assets. Browser
identity and API data were synthetic; static documents, lazy chunks, styles and
fonts crossed the real HTTP mount in Chromium 156.0.8078.4. This is not
live-provider or auth acceptance.

### R048 attended agent proposal delivery

The armed WebMCP channel accepts an Arbora proposal for human review.
It shows the exact tool, arguments, requesting agent and opaque requester reference.
A trusted human acceptance returns only the proposal decision.
It neither runs a tool nor satisfies the separate exact-request mutation confirmation.
Generation, schema and retained input validation bind the prompt to the active registration.
Expiry, server withdrawal, disconnect and retirement withdraw the prompt.
The client rejects terminal proposal IDs.

Source tests cover proposals, channel transport, rendered review and Python message validation.
Accepted-path component tests use the existing attended-gesture seam.
These fixtures do not establish authenticated served execution or installed native browser acceptance.
WEBUI-APPS-R048 remains open pending that composed acceptance.
This change grants no session, arms no browser and changes no production authority.

## Supported Work journey and remaining dependencies

- [x] WEBUI-APPS-R049.1.3: Check conversation response, admitted task, output and independent trace inspection with synthetic browser responses.
- [x] WEBUI-APPS-R049.1.3: Validate producer text artifacts and explicit references without inferring trace or conversation links.
- [ ] WEBUI-APPS-R049.1.2: Migrate supported authoring and other remaining Work capabilities with parity evidence.
- [ ] WEBUI-APPS-R004: Await authoritative current-plan and run-metrics bindings; task text does not replace these fields.
- [ ] WEBUI-APPS-R006.4: Await supported-harness discovery and indexed sessions; browser conversations do not replace this producer.
- [ ] WEBUI-APPS-R050: Qualify the composed served-provider journey and actual authorization boundaries.

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

### Work prompt authoring continuation

- [x] WEBUI-APPS-R049.1.2: Compose the existing admin prompt editor as a Work lens and preserve investigation context.
- [x] WEBUI-APPS-R049.1.3: Cover lens navigation, draft retention, owner retirement and explicit save with rendered source tests.
- [ ] WEBUI-APPS-R049.1.2: Qualify served-provider and native-browser prompt authoring, full editor-tool parity, and remaining Work authoring destinations.

- [ ] R046.2.2, R047 and R049.1.2: qualify loaded catalog navigation with installed providers. Source tests and the synthetic Chromium catalog journey do not close complete migration or dynamic-leaf acceptance.

### Nested execution explorer

- [ ] **WEBUI-APPS-R049.1.10:** Add explicit capability-gated active-child targeting without implicit Chat retargeting.
- [ ] **WEBUI-APPS-R049.1.11:** Add completed-child continuation using its separate backend binding.
- [ ] **WEBUI-APPS-R049.1.12:** Qualify both actions, reconnect and cancellation through the real Work route and released producer.

### Flat dependency source slice

- [x] WEBUI-APPS-R049.1.13: Qualify the bounded inline view with mounted Work and adapter fixtures.
- [ ] R049.1.2: Keep actual browser, installed-provider and nested execution acceptance open after the source slice.

## Canopy Glass presentation continuation — 2026-10-24

- [x] Specify WEBUI-APPS-R049.2.1 within the existing redesign owner and preserve all parent acceptance obligations.
- [ ] R049.2.1: Apply the shared full-width expanded shell and real Explore list/detail presentation without changing route, auth or WebMCP authority.
- [ ] R049.2.1: Qualify search, selection, detail tools, return, denial, retained state and focus with source tests and separately recorded rendered journeys.
- [ ] R049.2: Compare actual old/new tasks, navigation/scrolling effort and reviewed layout captures; the bounded presentation slice cannot close this row.
- [ ] R049.1.2/R045/R046/R047/R048: Complete remaining migration, all-leaf navigation, mobile capability parity and native-tool/authority acceptance.
- [ ] R050: Qualify noauth, EG and OIDC with the installed producers independently; synthetic theme fixtures do not establish served acceptance.

The first implementation covers shared chrome and existing Explore evidence only.
Graph, editor, run, administration, authentication and other native surfaces still
need complete theme and interaction review under their existing owners. Do not
promote a broad row from scoped tests or historical documentation screenshots.

### Remaining composition acceptance after the Canopy shell slice

- [ ] WEBUI-APPS-R049.2: Rebalance the real Work conversation/task split so an empty
  conversation does not reserve most of the center while selected-task details
  are squeezed into a narrow column. Preserve the mounted conversation, drafts,
  execution selection and safe disclosure behavior; do not manufacture content.
- [ ] WEBUI-APPS-R049.2: Complete Work and Operate composition and real wide, narrow,
  low-height and ultrawide pixel review. A shared palette or the first Explore
  list/detail journey does not complete the three-context redesign.

## Native workspace assistant continuation

- [x] WEBUI-APPS-R005.4/R049.1.3: Replace the floating launcher/drawer with a visible native assistant using the same mounted Chat and canonical state.
- [ ] WEBUI-APPS-R049.2: Preserve dominant task width, expanded header and an accessible dock/composer across narrow and short layouts.
- [x] WEBUI-APPS-R049.1.3: Check unsent draft, live context, canonical streaming and owner retirement through source tests of the actual Chat seam. Add native dock focus and retained-shell regression tests.
- [ ] WEBUI-APPS-R049.1.2/R047/R048/R050: Complete native browser co-navigation and installed-provider acceptance separately; a layout change cannot close these rows.

Bounded source evidence: 409 tests across 40 component/Chat/WebMCP files passed
with two workers. The default worker pool exhausted available process memory;
that interrupted run is not validation. Hosted native dock, touch/keyboard,
short/narrow, appearance and pixel qualification remain pending. The dock adds
no provider, scheduler, data endpoint or semantic-tool authority.

Typecheck, scoped typed lint and the production build passed. Local whole-repository
lint exceeded memory. Hosted typecheck and full lint passed on c8bd060, composed
with base 954a227. Browser qualification remains incomplete.

## Retained redesign ledger correction — 2026-10-24

- [ ] WEBUI-APPS-R049.2.2: Complete the original measured redesign criteria beyond the bounded R049.2.1 source slice.

Keep the Work/Operate, baseline comparison and native interaction obligations above open.
Preserve the qualified source child without promoting its broader ancestor.
Metadata guard tests are not evidence that the remaining redesign is accepted.

### Request handling without a mode (2026-10-25)

R005.4.1 local source work: delete obsolete request-mode controls and state; add mounted transport regressions; run scoped Chat suites. Full quality gates and served inference acceptance remain separate.
