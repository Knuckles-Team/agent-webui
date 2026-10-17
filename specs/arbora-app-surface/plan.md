# Arbora shell and app architecture

## Reuse and ownership

`src/lib/nav-registry.ts` owns sections/routes; `src/lib/frontend-contributions.ts` validates contributed descriptors; `src/lib/webmcp/` owns attended page tools; `src/lib/atlas/renderers.ts` and `src/components/atlas/renderers/index.ts` own renderer registration. `src/App.tsx` mounts the shell. `public/`, `index.html`, `src/index.css` and the existing asset generator own brand presentation. `agent/agent_webui/server.py` serves packaged assets. Extend these seams; do not create another router, renderer registry, app permission database or client-side Arbora authority. The first native app lives under `src/apps/markets/`; its finance behavior is specified separately in this repository.

## AppSurface contract

Each app has a stable ID, manifest version and route definitions from the same `RouteDef` shape. It declares capabilities, minimum role, generated API client bindings, WebMCP page/tool IDs and optional typed Atlas renderer registrations. Resolve the app catalog before constructing navigation. A native app registers a statically imported component. A package descriptor carries declarative metadata and a trusted, bounded contribution reference. The host validates it through the existing frontend-contribution schema and policy before exposing a route. A denied app is absent from privileged navigation and direct URL access returns a denied state. WebMCP tools remain attended and call the host-mediated Arbora operation path. They cannot execute merely because a page registered them.

## Brand and migration

Regenerate favicon/icon/social images using the repository asset script and check generated files against source. Move Python import and distribution metadata, npm package metadata and release image naming in one cutover. Coordinate that cutover with Arbora's consumer dependency. Keep the npm package private when the SPA is shipped in the Python wheel. Change WebMCP tool IDs to `arbora.*` and regenerate digests; old grants drain by expiry and are not silently reinterpreted. Browser storage keys receive a version bump and explicit re-consent. Environment names use one canonical prefix and reject stale aliases after the documented cutover. Preserve browser route paths except those required for the Apps section. Published Pages navigation resolves to the new site after publication; broken links are measured.

## Failure and portability

A missing catalog, unsupported manifest version, denied capability, unavailable API or failed app load has a distinct visible state. Fail closed on invalid descriptors and do not import remote executable code. A fresh checkout runs `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'`, then `pnpm run dev:server` and `pnpm run dev`; fixtures provide native and contributed app manifests locally. No private host is needed for normal PR validation.

## Amendments

### 2026-10-11: Sidebar query-provider parity (`WEBUI-APPS-R001`)

Standalone sidebar navigation and conversation tests use the existing
`renderWithProviders` harness, matching the real query provider in `App.tsx`.
Keep the catalog hook and React Query real. A rendered regression checks that
capability-gated links remain absent until the catalog loads, then shows only
available apps. Preserve modified-click and conversation-remount coverage.
This focused regression does not establish the broader `APP-07` accessibility
acceptance criteria.

## Run harness surface (WEBUI-APPS-R004)

Data flow: Observability run view (`ObservabilityView.tsx:602`) → `gatewayPost` (`gateway.ts:129`) → arbora `runs.get` / `runs.metrics` → harness block beside the DAG.

Types and fields (names from the design brief): `harness_config` (`context_policy` with `soft_threshold`, `hard_threshold`, `recent_window_fraction`; `plan_scaffold`; `action_space`), `peakContextTokens`, `contextBudgetTokens`, `costUsd`, `terminationReason` (`final_answer` | `context_overflow` | `stuck` | `step_budget` | `error`), and the run's plan state.

Attach point: the run list and DAG panel in `src/components/views/ObservabilityView.tsx` (`loadRuns` :602, `loadDag` :619, `RunRow` :41), which calls `gatewayPost` (`src/lib/gateway.ts:129`) on `/traces`; a new harness block renders beside the selected run's DAG.

Failure behaviour: a refused or absent operation yields "not available". The client invents no value and shows no zero for an absent number. Each termination reason has its own label; `context_overflow` and `stuck` carry their own text.

Reuse and new: the run view above stays; the harness block is new.

Decisions: the client reads `runs.get` and `runs.metrics` only. Rejected alternative: computing context use or cost in the client.
The engine owns the run trace, and a client copy drifts.

Cross-repository: depends on three rows. The `ARBORA-OPS` row for run metrics serves `runs.get` and `runs.metrics`. The `AU-HARNESS` row for the run trace writes the fields. The `AU-HARNESS` row for `update_plan` owns the plan state.

## WEBUI-APPS-R005 role-aware navigation and per-user dashboards

Data flow: principal role → nav registry filter → DashboardView layout read and write → rendered page.
Attach point: src/lib/nav-registry.ts and src/components/views/DashboardView.tsx.
Reused: the identity session from `IDUI-02` and the AppSurface contract. Role definitions stay with `ARBORA-IDENTITY` rows.
Decision: filter navigation by the declared role in the client. Arbora still authorizes each call. Rejected alternative: a separate client role table.

## WEBUI-APPS-R006 goals, sessions and fleets panel

Data flow: goals, sessions and fleets operations → link builder → panel filtered by goal.
Attach point: first child row locates the current goals and sessions views and replaces them.
Reused: the typed client of `APIUI-04`. Fleet execution stays with `AU-CONTROL` rows.
Decision: relate by returned identifiers. Rejected alternative: infer links by name matching in the browser.
## Graph edits through the engine (WEBUI-APPS-R030)

The graph overlay save (`GraphCanvas.tsx:605`) calls `handleUpdateNode` (`GraphView.tsx:792`). It calls the new `sendGraphEdit` export in `src/lib/graph-edit.ts`, then `gatewayPost` (`gateway.ts:129`). The authenticated Arbora invoke pipeline serves `eg.graph.AddNode`, `eg.graph.ApplyMutation` and `eg.graph.RemoveNode`. The fixture engine commits the durable mutation. The client updates local state from the verdict and authoritative readback.

Types: `GraphEditRequest`, `GraphEditVerdict` (`applied` | `refused` | `unavailable`), `ViewPersona`. Attach point: the three handlers at `GraphView.tsx:792-801`, called by `GraphCanvas.tsx:605-609`.

Failure behaviour: a refused edit leaves the node unchanged and shows the engine reason. An absent operation shows "not available".

Existing code: `src/components/views/GraphView.tsx:792`, `:796`, `:801`; `src/components/knowledge-graph/GraphCanvas.tsx:379`, `:605`; `src/lib/nav-registry.ts:73`. Reachable today: no. The handlers run, but no production caller reaches an engine write. Persona search terms (`persona`, `ViewPersona`) found nothing, so persona modes are new.

Decision: the engine decides authorization and the client shows the verdict. Rejected alternative: a client-side role check, which drifts from the engine policy.

Cross-repository: `ARBORA-OPS-R008` generates the engine-bound operations, `ARBORA-OPS-R009` enforces invoke authority and `ARBORA-OPS-R013` serves `POST /api/v1/ops/{op_id}`. EG owns the served `ApplyMutation` version check (`EG-DURABLE-KERNEL-R084.3`) and unchanged-state conflict refusal (`EG-DURABLE-KERNEL-R084.4`). Embedded read parity in `EG-TYPED-PACKS-R088` is not proof of served write authorization.

## Memory files (WEBUI-APPS-R031)

### Current source and producer prerequisites

[EG R085](https://github.com/Knuckles-Team/epistemic-graph/tree/c0b952776129fd509b9f87b411a298593c2591ec/specs/durable-graph-kernel) defines authoritative memory versions, conflicts, retention and synchronization evidence.
[Arbora R024.4.1–.6](https://github.com/Knuckles-Team/arbora/tree/1d7fb3f0865a32be167b0090c01e28a2c5f258b4/specs/hosted-api-operations) defines hosted files and serving in [PR 272](https://github.com/Knuckles-Team/arbora/pull/272), currently a proposed producer dependency.
Neither definition establishes installed operations or runtime acceptance.
EG owns content, compare-and-set, retention and sync decisions. Arbora owns authenticated serving, hosted projection and authenticated materialization acknowledgments. AU consumes EG decisions. WebUI renders the returned state.

Current main `28df14e42c751d5fb99b60c973a5164144ef090d` has Memory-node CRUD in `src/components/views/MemoryView.tsx:439`, mounted from `src/lib/nav-registry.ts:664`; it has no Files tab or `src/lib/memory-files.ts`.
The existing `src/lib/arbora-api/invoke.ts:56` sends generated operations to `/api/v1/ops/{op_id}` with same-origin credentials, CSRF handling, idempotency options and validated envelopes. Reuse that adapter under `WEBUI-API-R001`, `APIUI-01` and `APIUI-06`.
`gatewayPost` prefixes the graph facade and is not the operation adapter. Served tests must prove the real same-origin host route and installed schemas. The browser helper alone does not prove them.

### Explicit wire and view mapping

| Planned helper/view | Arbora producer | EG producer | Required mapping |
|---|---|---|---|
| listMemoryFiles | memory.files.list; R024.4.1/.2/.6 | R085.1/.2/.4 | Generated metadata-only page, optional kind, limit 1–100, opaque cursor; stable authorized snapshot, no hidden counts or hashes |
| readMemoryFile | memory.files.read; R024.4.1/.2/.6 | R085.1/.2/.4/.5 | Document identity and optional exact revision; only authorized snapshot bytes, digest, sync state and conflict references |
| saveMemoryFile | memory.files.save; R024.4.1/.3/.5/.6 | R085.1/.3–.5/.7 | Generated submit/resolve only; exact precondition, UTF-8 bytes and digest; explicit absent-head creation; same identity/body retry |
| conflict and refusal views | R024.4.3/.5 | R085.3/.5/.7 | Authorized conflict_retained versus head-free refused; do not convert retained conflict to a generic failure |
| sync label | R024.4.4 | R085.6/.8 | Render in_sync, graph_ahead, file_ahead, conflict or unavailable exactly from served evidence |

These operation names are proposed producer IDs, not registration claims. Do not alias generic memory.read/write to them or maintain another authoritative browser store. Use generated bounded schemas: 1 MiB content, 256-byte document IDs and 1024-byte logical paths, preserving stricter serving limits. Logical paths are labels, never browser-controlled filesystem authority.

Refused/expired cursors require an explicit restart, not concatenation of incompatible snapshots. Recheck authorization on every page/read/save/conflict read/replay. Discard late responses across principal, tenant, graph or document changes; clear protected content after access loss. Refused results carry only error code and request-local correlation, with no result-derived metadata in the envelope, errors or activity view. Denied existing, absent and creation attempts have equal disclosure. A changed-body replay refuses without mutation.

Authorized stale saves return conflict_retained only after both versions are durably retained. Show both immutable contents/digests via authorized reads; never overwrite the accepted head. Retention-capacity failure refuses and cannot be presented as retained. Resolution binds the current accepted head and retained conflict. EG, not the client or hosted artifact deletion, determines release of retained history.

### Host observations and acknowledgment races

The browser cannot invoke observe_file or acknowledge_materialization. A save result is not a host acknowledgment. Arbora must preserve local edits and submit observations before replacing hosted bytes. Its acknowledgment binds graph incarnation, document, accepted revision, digest, observation_generation and attempt. EG atomically checks head and generation. A newer observed edit invalidates an old acknowledgment even if the accepted head has not changed. Pending edits or unresolved conflicts prevent in_sync; missing evidence yields unavailable. The UI must render that state after reread and never infer in_sync from HTTP success or matching local text.

Helper, tab, registered-operation and host-materializer work still needs implementation. Planned tests below are acceptance requirements, not implementation evidence.

## 2026-10-11 ownership and served-acceptance correction

Checked owner snapshots: Arbora `9d035d692475a7f513c2b3e99171d729b4ca5d08`
and EG `3137ad4a02c50540a94c0523acc9638281532c9e`.
Arbora `arbora/api/registry/eg_binding.py` generates `eg.{domain}.{method_id}`;
its exclusions list is empty at this snapshot. EG `contract/methods.json`
marks AddNode, ApplyMutation and RemoveNode in the graph domain wire-callable.
The installed registry and generated schemas remain the deployment authority;
source availability is not a served acceptance receipt.

The versioned-memory ownership contract is now the R085/R024.4 mapping above.
Generic memory.read/write and ApplyMutation concurrency remain insufficient to establish file synchronization.

The graph-edit browser path uses its typed export and gatewayPost. The memory-file path uses its typed export and canonical invoke adapter. Both require the real WebUI host.
The authenticated Arbora operation invokes its real handler and the actual fixture engine.
An independent durable readback completes the acceptance path. Local React state or helper
spies prove presentation/wiring only. R030.7 and R031.7 require browser journeys
through that complete path with no client/gateway/host-handler/engine-transport
mocks. Fixture credentials and temporary storage are allowed; replacing the
owners with canned verdicts is not. Persist and reload both conflict versions;
unauthorized graph edits must leave durable graph state unchanged.

Each R030/R031 child still needs its own acceptance run. The
requirements describe product-neutral graph and memory behavior. Research
citations, including arXiv papers, are inspiration only, never protocol
contracts, owner authority, implementation evidence or acceptance receipts.

<!-- spec-definition-patch:consumer-definitions-20261012 -->
## Consolidated consumer contracts

These clauses preserve the existing shell and producer responsibilities. They add only the reviewed missing browser consumers.

All new typed operation calls reuse `src/lib/arbora-api/invoke.ts` under `WEBUI-API-R001` and the generated API client. Arbora registration, authorization and serving remain `ARBORA-OPS-R008`, `ARBORA-OPS-R009` and `ARBORA-OPS-R013`. Existing event transports carry owner-defined subscriptions; the browser must not create a second event protocol.

No operation ID absent from a producer contract is assigned here. The owner must publish exact specialized operation IDs and schema bindings before definition closure or runtime acceptance. A missing binding is an unavailable dependency, not permission for local policy or a browser-owned index. Specialized producer extensions remain with EG, SDK, AU and Arbora. This batch defines the exact information and behavior their WebUI consumer requires.

For every consumer, bind authenticated tenant, principal, graph/workspace incarnation, request identity and source revision at the host. Cancel stale requests on scope changes and clear protected state on revocation. Refusals expose no hidden entity identifiers or stored data. Compare-and-set, idempotency and authorization decisions remain producer decisions.

### WEBUI-APPS-R004.7: Evolution evidence

Input `AU:103`; original record SHA-256 `68bae14976bd3581bc33ee65b153b5ad60f807fb894af09577b9debd19be7557`.

Source obligation: Evolution dashboards show per-run metrics and prompt-optimization progress drawn from recorded traces. Reviewers judge proposals by measured outcomes.

Existing owner anchors: AU-HARNESS-R011; AU-HARNESS-R017; EG-ORCH-VOCAB-R009; ARBORA-OPS-R021.4.4/.5. Entry: ObservabilityView harness block.

Use generated proposal identity, prompt revision, agent identity, progress state and source RunTrace references. Keep measured run metrics separate from decision calibration and coverage.

Show each optimization proposal beside its exact source runs and recorded progress. Preserve pending review and propose-only state. Never promote a prompt from this view.

Extend src/components/views/ObservabilityView.tsx beside the existing run DAG. Resolve proposal and trace references through typed Arbora reads. The existing runs.get and runs.metrics operations alone do not return the missing join.

Missing proposal provenance, hidden traces or incompatible producer revisions show unavailable. Never infer progress from trace count or substitute WEBUI-DECIDE-R001 coverage.

Bind the shown proposal revision, run IDs, trace digests, metric window and producer schema revision. Label incomplete source sets.

A real served proposal must lead from the dashboard to its authorized stored traces and measured outcomes. Denied traces must reveal no metrics or proposal progress.

### WEBUI-APPS-R006.4: Unified harness sessions

Input `WEBUI:3`; original record SHA-256 `38936b5f2136263c40c29fe639c984243fed8be6dbb9a6d836f40d7b7672116e`.

Source obligation: On first run, the platform discovers agent sessions from every supported harness. It syncs them into local queryable indexes. The web interface offers unified browsing and search across them with cost summaries.

Existing owner anchors: APIUI-04; WEBUI-APPS-R006; ARBORA-OPS-R008; ARBORA-OPS-R009. Entry: SessionsView and goal-session-fleet panel.

Consume the versioned host supported-harness manifest and discovery status for every manifest entry. Session identity includes source harness, source session ID, tenant and authoritative indexed revision.

On first use, show discovery and synchronization for every declared supported harness. Browse and search the unified authorized index with cross-session cost summaries.

Extend src/components/views/SessionsView.tsx and the R006 panel through the generated client. SDK discovers and syncs sources; EG owns indexes; Arbora serves bounded search and discovery progress.

Unsupported harnesses, denied sources and partial synchronization remain individually visible. Never claim complete discovery from one source or replace missing costs with zero.

Keep source coverage, sync cursor, index revision, query window, cost units and partial-result flags with every result page. Do not create a browser metric or session index.

From a fresh browser, exercise every supported harness in the versioned owner manifest and search sessions without duplicate identities. Include at least two harnesses when the manifest contains two or more. Two examples alone do not prove manifest-wide coverage. Deny one source and prove visible partial coverage and no hidden-session disclosure.

### WEBUI-APPS-R004.8: Indexed usage analysis

Input `WEBUI:4`; original record SHA-256 `dd790b40c92758d720375c78ccd4278845b8d348022b4d69b978cba049461237`.

Source obligation: The platform tracks token and cost usage per agent, indexes it in local storage, and exposes it for fast analysis by model, project and agent.

Existing owner anchors: EG-ORCH-VOCAB-R010.1–.6; ARBORA-OPS-R021.4.3/.4; WEBUI-APPS-R004.3. Entry: ObservabilityView usage section.

Consume generated model, project and agent identities, input/output token counts and total usage cost. Preserve owner-defined cached/reasoning categories, accounting units and missing-value semantics.

Filter indexed history by model, project, agent and time window. Show producer aggregates and pagination. Label cost per solved task separately from total usage and context peak/budget.

Extend src/components/views/ObservabilityView.tsx using the canonical operation adapter. EG returns indexed accounting and groups; Arbora serves the generated projection. Reuse existing model/task-class metrics.

Unknown project/agent attribution, incomplete token accounting and zero-solved abstention remain explicit. Missing, nonpositive or nonfinite owner latency limits make bounded analysis unavailable. Never total overlapping token categories or manufacture project costs in JavaScript.

Retain aggregate definition, currency, accounting version, observation interval, source coverage and index watermark. Bind measured latency to an owner-published positive finite limit, units, measurement boundary, dataset size and contract revision.

Serve indexed model/project/agent queries over the owner-declared dataset and check independent stored accounting totals. Compare measured latency with the revision-bound positive finite owner limit. Test incomplete attribution, denied scope and absent, invalid or exceeded limits.

### WEBUI-APPS-R030.8: Live graph convergence

Input `WEBUI:5`; original record SHA-256 `0b416b47d85530fb35cf44bf5dc79e04e1b9746481027d0b0687b66579dc9844`.

Source obligation: Connected client views reflect graph changes immediately without page refresh. The graph layout stays readable under concurrent edits from multiple users.

Existing owner anchors: EG-DURABLE-KERNEL-R084.3/.4; ARBORA-OPS-R008; ARBORA-OPS-R009; WEBUI-APPS-R030. Entry: GraphView and GraphCanvas.

Consume authorized snapshot identity and ordered change events with graph incarnation, revision, cursor and event identity. A tombstone remains distinct from an inaccessible entity.

Apply committed changes to other connected clients without page refresh. Preserve selected nodes, camera and stable layout anchors during concurrent edits.

Attach the host subscription to src/components/views/GraphView.tsx and GraphCanvas. Use the existing host event transport with its generated contract; snapshot reads remain typed Arbora operations.

Deduplicate events and reject revision regressions. A gap or expired cursor requires an authorized fresh snapshot. Missing, nonpositive or nonfinite latency/layout bounds make bounded live mode unavailable. Revocation clears protected graph state and stops the subscription.

Retain snapshot and event revisions and measure commit-to-visible latency. Bind latency and layout measurements to owner-published positive finite limits, metric definitions, units, workload and contract revision. Layout metrics must cover readability and frame timing; retain selection continuity evidence.

Two real browsers edit concurrently and converge before refresh within the owner latency limit. Compare layout measurements against owner limits under the declared workload. Test missing, invalid and exceeded bounds. Exercise duplicated, delayed and reordered events, reconnect and revocation; compare both views with independent durable readback.

### WEBUI-APPS-R001.1: Retrieval quality comparison

Input `WEBUI:6`; original record SHA-256 `3dc3c464a10a5178a413463f2b43baeb015732f5b8df508f6dbab9c37cc1165d`.

Source obligation: An operator inspects and compares retrieval quality interactively: hits-at-k metrics, n-gram highlighting, side-by-side algorithm comparison and context search.

Existing owner anchors: WEBUI-APPS-R001; ARBORA-OPS-R008; ARBORA-OPS-R009. Entry: TableExplorer TryItPanel.

Consume EG evaluation identity, corpus revision, relevance-label revision, algorithm version, k, hits-at-k and context-span offsets. Keep result ranking separate from relevance labels.

Compare algorithms side by side for the same evaluation input. Show hits-at-k, safe n-gram highlights and context search with source references.

Extend src/components/table-explorer/TryItPanel.tsx through typed Arbora evaluation reads. Its current SQL search legs and local rrfFuse do not establish authoritative evaluation metrics.

Missing labels, incompatible corpus revisions, invalid offsets and denied context show unavailable. Never compute quality from rank alone or treat local fusion as an EG retrieval decision.

Show numerator, denominator, k, corpus/label revisions, algorithm settings and query identity. Escape source text before highlighting and bound returned context spans.

A real served fixed corpus and labels must produce independently checked hits-at-k for two algorithms. Test unlabeled data, cross-revision comparison and hostile highlight text without fake metrics.

### WEBUI-APPS-R001.2: Bounded large-data charts

Input `WEBUI:7`; original record SHA-256 `483b80b268ba6924ced162740792071fb43f482b1cddf16d9fbd424727d4ed89`.

Source obligation: The web interface renders interactive scatter and line charts with pan, zoom and selection. Datasets reach billions of points. Screen-bounded binning keeps payload size bounded.

Existing owner anchors: FIN-UI-R002.1/.2; FIN-UI-R003; WEBUI-APPS-R001; ARBORA-OPS-R008. Entry: Shared Atlas chart renderer.

Consume EG viewport bounds, pixel dimensions, bin revision, source cardinality, count/extrema and selection references. Scatter bins and line continuity have distinct generated result variants.

Pan, zoom and select scatter and line data with at least one billion source points. Render screen-bounded results, preserving gaps and producer-defined selection semantics.

Extend the existing shared Atlas chart renderer used by finance. Send viewport queries through typed Arbora reads; EG performs binning and selection against its indexed source.

Reject stale viewport replies and invalid selection tokens. Refuse rendering when owner bin/byte limits or viewport dimensions are absent, nonpositive, nonfinite or schema-invalid. Never download the complete source, interpolate across declared gaps or report exact point selection from a bin summary.

Enforce owner-published positive finite bin-count and response-byte limits before rendering. Their versioned formulas must bind viewport dimensions and chart variant, independently of total source cardinality. Count limits use integers. Record formula revision, viewport dimensions, source cardinality, bins and bytes.

Serve a real indexed source of at least one billion points. Pan, zoom and select both chart variants. Measure bins and bytes against the owner viewport formulas and limits. Test absent, zero, negative, nonfinite and exceeded limits, stale responses and denied selections.

### WEBUI-APPS-R001.3: Column vector controls

Input `WEBUI:8`; original record SHA-256 `c00e7f00c83f38949d4da47e43c1e3d430e43d5b7122ff44c040d2921eeebedc`.

Source obligation: A table schema browser lets the user toggle vectorization per column and observe vector index statistics.

Existing owner anchors: EG-FEDERATED-QUERY-R077.1/.2/.5; EG-FEDERATED-QUERY-R077.6.1–.6; ARBORA-OPS-R008; ARBORA-OPS-R009. Entry: TableExplorer schema browser.

Consume stable table/column IDs, schema revision, ColumnVectorBinding, embedder identity/dimension and versioned index statistics. Advice and binding state remain distinct.

Offer explicit per-column bind/unbind controls and show index readiness, indexed-row count and owner-reported size/freshness. Read the authoritative binding after each accepted mutation.

Extend src/components/views/TableExplorerView.tsx and src/components/table-explorer/SchemaTree.tsx. Use generated Arbora list, stats and mutation bindings to existing EG column operations.

Deny unauthorized mutations before effects. Stale schema, unsupported type or unavailable embedder leaves the binding unchanged. Advice must never activate a toggle automatically.

Bind mutation verdict and readback to column ID, schema revision, embedder and index generation. Missing statistics remain unavailable, never fabricated zeros.

Use an authenticated browser to bind a text column and read actual index statistics through Arbora and EG. Deny a writer and submit a stale schema; prove unchanged bindings and no embedding effects.

### WEBUI-APPS-R001.4: Remote editor compatibility

Input `WEBUI:9`; original record SHA-256 `adf594bd4203d666df7254ef4f9481e91cdb841429e8b720d2a8483764f44a32`.

Source obligation: The web interface offers a browser-based code editor with extension and keyboard-shortcut compatibility for remote development.

Existing owner anchors: WEBUI-APPS-R001; ARBORA-OPS-R008; ARBORA-OPS-R009. Entry: WorkspaceIDEView.

Consume a versioned host compatibility manifest naming editor protocol, extension IDs/versions, supported capabilities and keybinding profiles. Keep remote workspace identity scoped to the session.

Expose supported extension installation/use and keyboard shortcuts within the existing embedded workbench. Resolve shortcut focus between shell and editor without silently swallowing commands.

Reuse src/components/views/WorkspaceIDEView.tsx at /ide and its editor-context bridge. Arbora owns workbench hosting and extension admission; the browser must not install a second editor.

Unsupported extensions, incompatible versions and denied workspace access show explicit refusals. Untrusted workspaces cannot gain host privileges or access another workspace through the bridge.

Record workbench and manifest versions, extension verdicts, keybinding profile and workspace revision. Keep service credentials out of frame messages and browser state.

Open an authenticated remote workspace and exercise one declared extension and shortcut in a real browser. Test incompatible extensions, reserved shortcut focus and cross-workspace access denial.

### WEBUI-APPS-R001.5: Meeting transcripts and summaries

Input `WEBUI:10`; original record SHA-256 `c82a815c87428a5baf4379ef7790bafb24a5d3367d16ebd85a6c39ff9b52521d`.

Source obligation: The web interface shows a live meeting transcript. The user chooses a local or hosted language-model provider for post-meeting summaries.

Existing owner anchors: WEBUI-APPS-R001; APIUI-04; ARBORA-OPS-R008; ARBORA-OPS-R009. Entry: Meeting AppSurface and existing dictation seam.

Consume meeting ID, segment ID, sequence, correction revision, timestamps and finalization state. Summary requests bind final transcript revision, admitted provider identity and local/hosted execution class.

Show live partial/final segments and ordered corrections. After meeting finalization, let the user select an available local or hosted summary provider and request a summary.

Add the meeting consumer through existing AppSurface and host transport. SDK owns live transcription/provider transport; EG owns context and summary admission; Arbora serves their generated contracts.

Keep src/hooks/useVoiceDictation.ts single-shot behavior honest. Denied capture, missing streams, sequence gaps or absent providers remain distinct. Never silently move a local-provider request to a hosted service.

Bind summary content and citations to final transcript revision, provider/model revision and admitted execution receipt. Corrections invalidate stale summaries visibly.

In a real browser, receive segments and corrections, finalize, then select local and hosted providers separately. Check actual provider routing and summary provenance. Denied egress and stale transcript requests produce no summary effects.

### WEBUI-APPS-R001.6: Bookmark knowledge views

Input `WEBUI:11`; original record SHA-256 `b1708c96d6b9cadcb1c9f35cc5cb7dde4e60ed2cb1250598e55b9ce4cc66907e`.

Source obligation: The web interface presents a searchable bookmark knowledge base with meaning-based semantic filtering, an interactive mindmap and CSV or JSON export.

Existing owner anchors: SDK-SOURCE-INGEST-R005.7–.12; WEBUI-APPS-R001; ARBORA-OPS-R008; ARBORA-OPS-R009. Entry: Bookmark AppSurface and GraphCanvas.

Consume bookmark/source IDs, ingestion provenance, semantic-index revision, authorized relationships and bounded export schema. Reuse the existing SDK bookmark envelopes and extraction vocabulary.

Search and filter bookmarks by meaning; render their authorized relationships as an interactive mindmap. Offer CSV and JSON export for the selected authorized query snapshot.

Use existing AppSurface, GraphView/GraphCanvas and generated Arbora reads/export delivery. EG owns semantic indexing and relationship decisions. Do not duplicate SDK offline ingestion in the browser.

Denied nodes, stale cursors and unavailable semantic indexes reveal no hidden counts or relationships. Never fetch embedded URLs or run imported instructions. Exports must not widen the selected scope.

Bind search, mindmap and exports to one query/snapshot revision, source provenance, format version and content digest. Preserve unknown metadata and escape CSV formula-like cells safely.

Import bookmarks through SDK R005.7–.12, then use real browser semantic filtering, mindmap and CSV/JSON export. Independently compare stored records and downloaded bytes; deny one bookmark and prove exclusion everywhere.

### WEBUI-APPS-R001.7: Sandboxed design artifacts

Input `AU:107`; original record SHA-256 `d179fc0eb33039df3a87efe8a59ce2a635f0e39f360c58f925011448d0401cdc`.

Source obligation: A design flow composes available coding agents found on the path and applies skill-driven transformations. It renders generated artifacts in a sandboxed web frame.

Existing owner anchors: AU-CONTROL-R003; AU-HARNESS-R009; WEBUI-DESIGN-R001; WEBUI-APPS-R001. Entry: Existing MCP App frame.

Consume host-discovered executable identities and capabilities, EG-admitted skill sequence and immutable generated artifact references. Bind artifacts to execution, skill and source revisions.

Let the user select available coding-agent capabilities for a design flow and inspect skill-transformation progress. Render the resulting artifact only through the existing sandboxed frame.

Reuse src/components/mcp/McpAppFrame.tsx and McpAppHost.tsx. Arbora discovers PATH executables and hosts effects; EG selects composition; AU runs admitted skills. The browser never probes PATH or chooses policy.

Unavailable executables or refused transformations produce no success preview. Validate artifact digest, origin and message schema. Block parent DOM, credential access, popups and unauthorized network/navigation.

Show execution and transformation references with the rendered digest. Preserve producer refusal and cancellation; frame rendering alone is not proof of a completed transformation.

Serve an admitted design flow through actual host discovery and execution to the sandbox frame. Compare the artifact digest with durable provenance; test substituted artifacts and hostile scripts without parent or network escape.

### WEBUI-APPS-R001.8: Interactive code explanations

Input `AU:115`; original record SHA-256 `445704f78ae07d1c4b62f42dd23797823d91bc470f04a9dc779e3f6777fffbf0`.

Source obligation: A codebase query can produce a linear code walkthrough and a self-contained interactive explanation artifact. Execution notes stream to the graph as provenance.

Existing owner anchors: EG-REPO-INGEST-R009; AU-HARNESS-R024; EG-ORCH-VOCAB-R013.1/.3; WEBUI-APPS-R001. Entry: Existing artifact frame and code navigation.

Consume query/repository revision, ordered walkthrough steps, source spans, self-contained artifact manifest/digest and execution-note sequence references. Keep explanation notes distinct from private model reasoning.

Show a linear source-linked walkthrough and interactive explanation artifact for the same query output. Show ordered graph-persisted execution notes with provenance links.

Reuse existing code navigation and the R001.7 frame boundary. Arbora serves generated explanation output and note subscriptions; EG owns source and provenance identity; AU emits admitted execution notes.

Missing source revisions, invalid manifests, stale notes and denied source spans show unavailable. Reject unmanifested external artifact dependencies; never synthesize a successful explanation from a generic span tree.

Bind walkthrough, artifact bytes and note stream to one query and repository revision. Label disconnected streams and retain sequence/correction identities without exposing hidden source content.

From a real served code query, inspect source-linked steps and load the artifact with external network blocked. Independently read graph notes and compare artifact bytes; reject wrong-revision outputs and unauthorized source links.

### Input reconciliation

| Input | Consumer clauses | Scope |
|---|---|---|
| AU:103 | `WEBUI-APPS-R004.7.1`–`.6` | Evolution evidence |
| WEBUI:3 | `WEBUI-APPS-R006.4.1`–`.6` | Unified harness sessions |
| WEBUI:4 | `WEBUI-APPS-R004.8.1`–`.6` | Indexed usage analysis |
| WEBUI:5 | `WEBUI-APPS-R030.8.1`–`.6` | Live graph convergence |
| WEBUI:6 | `WEBUI-APPS-R001.1.1`–`.6` | Retrieval quality comparison |
| WEBUI:7 | `WEBUI-APPS-R001.2.1`–`.6` | Bounded large-data charts |
| WEBUI:8 | `WEBUI-APPS-R001.3.1`–`.6` | Column vector controls |
| WEBUI:9 | `WEBUI-APPS-R001.4.1`–`.6` | Remote editor compatibility |
| WEBUI:10 | `WEBUI-APPS-R001.5.1`–`.6` | Meeting transcripts and summaries |
| WEBUI:11 | `WEBUI-APPS-R001.6.1`–`.6` | Bookmark knowledge views |
| AU:107 | `WEBUI-APPS-R001.7.1`–`.6` | Sandboxed design artifacts |
| AU:115 | `WEBUI-APPS-R001.8.1`–`.6` | Interactive code explanations |

The cited owner anchors establish existing responsibilities, not missing operation registrations. The exact newly published producer extensions must be reconciled before definition closure and runtime acceptance. Covered model/task-class metrics, SDK bookmark ingestion, single-shot dictation and the existing editor/frame remain intact.
<!-- /spec-definition-patch -->

## Open definition prerequisites

None of the twelve source inputs is fully definition-complete through this consumer increment alone.
Existing general owner anchors do not replace exact specialized producer operation IDs, schema revisions and consumer bindings.
EG, SDK, AU and Arbora retain authority to publish those missing producer clauses.
WebUI must reconcile each exact owner requirement and generated schema before claiming source-input definition closure.
The latency, layout and viewport limits above are also missing definition prerequisites.
Their owners must publish positive finite values or formulas with units, measurement boundaries, workloads and revisions.
The consumer must refuse absent or invalid bounds; it must not choose local defaults to close the gap.
Manifest-wide harness coverage requires the versioned complete supported-harness inventory and per-entry acceptance evidence.
These are cross-owner follow-up conditions. This change does not assign limit values, register operations or implement behavior.

## Amendments — 2026-10-16 navigation acceptance evidence

Extend WEBUI-APPS-R005.1 and WEBUI-APPS-R005.6 registry tests to enforce explicit
valid minimum roles, reader filtering, unknown-user rejection and the 20-word
purpose bound. Extend the existing hostile route harness for WEBUI-APPS-R005.5
with an injected throwing view; do not create a duplicate census harness.
This is partial test evidence only: the harness retains known-failure baselines,
and purpose visibility through shell-heading exceptions still needs rendered
acceptance. Child requirements separate the tested subset from the remaining rendered obligations.
Parent rollups do not claim full verification from these partial tests.

### Acceptance decomposition — 2026-10-16

Each R005.1, R005.5 and R005.6 parent rolls up its two child requirements.
The first child records the tested registry or harness contract.
The second retains the full rendered acceptance obligation and remains open.
Test bindings name only the narrow children, not their full-acceptance parents.
The canonical child rollup keeps every parent pending until both children pass.
