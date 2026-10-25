# Arbora shell and app architecture

## Reuse and ownership

`src/lib/nav-registry.ts` owns sections/routes; `src/lib/frontend-contributions.ts` validates contributed descriptors; `src/lib/webmcp/` owns attended page tools; `src/lib/atlas/renderers.ts` and `src/components/atlas/renderers/index.ts` own renderer registration. `src/App.tsx` mounts the shell. `public/`, `index.html`, `src/index.css` and the existing asset generator own brand presentation. `agent/agent_webui/server.py` serves packaged assets. Extend these seams; do not create another router, renderer registry, app permission database or client-side Arbora authority. The first native app lives under `src/apps/markets/`; its finance behavior is specified separately in this repository.

## AppSurface contract

Each app has a stable ID, manifest version and route definitions from the same `RouteDef` shape. It declares capabilities, minimum role, generated API client bindings, WebMCP page/tool IDs and optional typed Atlas renderer registrations. Resolve the app catalog before constructing navigation. A native app registers a statically imported component. A package descriptor carries declarative metadata and a trusted, bounded contribution reference. The host validates it through the existing frontend-contribution schema and policy before exposing a route. A denied app is absent from privileged navigation and direct URL access returns a denied state. WebMCP tools remain attended and call the host-mediated Arbora operation path. They cannot execute merely because a page registered them.

## Brand and migration

Regenerate favicon/icon/social images using the repository asset script and check generated files against source. Move Python import and distribution metadata, npm package metadata naming in one cutover. Coordinate that cutover with Arbora's consumer dependency. Keep the npm package private when the SPA is shipped in the Python wheel. Change WebMCP tool IDs to `arbora.*` and regenerate digests; old grants drain by expiry and are not silently reinterpreted. Browser storage keys receive a version bump and explicit re-consent. Environment names use one canonical prefix and reject stale aliases after the documented cutover. Preserve browser route paths except those required for the Apps section. Published Pages navigation resolves to the new site after publication; broken links are measured.

## Failure and portability

A missing catalog, unsupported manifest version, denied capability, unavailable API or failed app load has a distinct visible state. Fail closed on invalid descriptors and do not import remote executable code. A fresh checkout runs `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'`, then `pnpm run dev:server` and `pnpm run dev`; fixtures provide native and contributed app manifests locally. No private host is needed for normal PR validation.

## Amendments

### 2026-10-11: Sidebar query-provider parity (`WEBUI-APPS-R001`)

Standalone sidebar navigation and conversation tests use the existing
`renderWithProviders` harness, matching the real query provider in `App.tsx`.
Keep the catalog hook and React Query real. A rendered regression checks that
capability-gated links remain absent until the catalog loads, then shows only
available apps. Preserve modified-click and conversation-remount coverage.
This focused regression does not establish the broader `WEBUI-APPS-R044` accessibility
acceptance criteria.

## Run harness surface (WEBUI-APPS-R004)

Data flow: Observability run view (`ObservabilityView.tsx:602`) → `gatewayPost` (`gateway.ts:129`) → arbora `runs.get` / `runs.metrics` → harness block beside the trace waterfall.

Types and fields (names from the design brief): `harness_config` (`context_policy` with `soft_threshold`, `hard_threshold`, `recent_window_fraction`; `plan_scaffold`; `action_space`), `peakContextTokens`, `contextBudgetTokens`, `costUsd`, `terminationReason` (`final_answer` | `context_overflow` | `stuck` | `step_budget` | `error`), and the run's plan state.

Attach point: the run list and trace waterfall in `src/components/views/ObservabilityView.tsx` (`loadRuns` :602, `loadDag` :619, `RunRow` :41). It calls `gatewayPost` (`src/lib/gateway.ts:129`) on `/traces`. The new harness block renders beside the selected trace's waterfall.

Failure behaviour: a refused or absent operation yields "not available". The client invents no value and shows no zero for an absent number. Each termination reason has its own label; `context_overflow` and `stuck` carry their own text.

Reuse and new: the run view above stays; the harness block is new.

Decisions: the client reads `runs.get` and `runs.metrics` only. Rejected alternative: computing context use or cost in the client.
The engine owns the run trace, and a client copy drifts.

Cross-repository: depends on three rows. The `ARBORA-OPS` row for run metrics serves `runs.get` and `runs.metrics`. The `AU-HARNESS` row for the run trace writes the fields. The `AU-HARNESS` row for `update_plan` owns the plan state.

## WEBUI-APPS-R005 role-aware navigation and per-user dashboards

Data flow: principal role → nav registry filter → DashboardView layout read and write → rendered page.
Attach point: src/lib/nav-registry.ts and src/components/views/DashboardView.tsx.
Reused: the identity session from `WEBUI-IDENTITY-R004` and the AppSurface contract. Role definitions stay with `ARBORA-IDENTITY` rows.
Decision: filter navigation by the declared role in the client. Arbora still authorizes each call. Rejected alternative: a separate client role table.

## WEBUI-APPS-R006 goals, sessions and fleets panel

Data flow: goals, sessions and fleets operations → link builder → panel filtered by goal.
Attach point: first child row locates the current goals and sessions views and replaces them.
Reused: the typed client of `WEBUI-API-R009`. Fleet execution stays with `AU-CONTROL` rows.
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
The existing `src/lib/arbora-api/invoke.ts:56` sends generated operations to `/api/v1/ops/{op_id}` with same-origin credentials, CSRF handling, idempotency options and validated envelopes. Reuse that adapter under `WEBUI-API-R001`, `WEBUI-API-R006` and `WEBUI-API-R011`.
`gatewayPost` prefixes the graph facade and is not the operation adapter. Served tests must prove the real same-origin host route and installed schemas. The browser helper alone does not prove them.

### Explicit wire and view mapping

| Planned helper/view        | Arbora producer                      | EG producer     | Required mapping                                                                                                                   |
| -------------------------- | ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| listMemoryFiles            | memory.files.list; R024.4.1/.2/.6    | R085.1/.2/.4    | Generated metadata-only page, optional kind, limit 1–100, opaque cursor; stable authorized snapshot, no hidden counts or hashes    |
| readMemoryFile             | memory.files.read; R024.4.1/.2/.6    | R085.1/.2/.4/.5 | Document identity and optional exact revision; only authorized snapshot bytes, digest, sync state and conflict references          |
| saveMemoryFile             | memory.files.save; R024.4.1/.3/.5/.6 | R085.1/.3–.5/.7 | Generated submit/resolve only; exact precondition, UTF-8 bytes and digest; explicit absent-head creation; same identity/body retry |
| conflict and refusal views | R024.4.3/.5                          | R085.3/.5/.7    | Authorized conflict_retained versus head-free refused; do not convert retained conflict to a generic failure                       |
| sync label                 | R024.4.4                             | R085.6/.8       | Render in_sync, graph_ahead, file_ahead, conflict or unavailable exactly from served evidence                                      |

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

Extend src/components/views/ObservabilityView.tsx beside the existing trace waterfall. Resolve proposal and trace references through typed Arbora reads. The existing runs.get and runs.metrics operations alone do not return the missing join.

Missing proposal provenance, hidden traces or incompatible producer revisions show unavailable. Never infer progress from trace count or substitute WEBUI-DECIDE-R001 coverage.

Bind the shown proposal revision, run IDs, trace digests, metric window and producer schema revision. Label incomplete source sets.

A real served proposal must lead from the dashboard to its authorized stored traces and measured outcomes. Denied traces must reveal no metrics or proposal progress.

### WEBUI-APPS-R006.4: Unified harness sessions

Input `WEBUI:3`; original record SHA-256 `38936b5f2136263c40c29fe639c984243fed8be6dbb9a6d836f40d7b7672116e`.

Source obligation: On first run, the platform discovers agent sessions from every supported harness. It syncs them into local queryable indexes. The web interface offers unified browsing and search across them with cost summaries.

Existing owner anchors: WEBUI-API-R009; WEBUI-APPS-R006; ARBORA-OPS-R008; ARBORA-OPS-R009. Entry: SessionsView and goal-session-fleet panel.

Consume the versioned host supported-harness manifest and discovery status for every manifest entry. Session identity includes source harness, source session ID, tenant and authoritative indexed revision.

On first use, show discovery and synchronization for every declared supported harness. Browse and search the unified authorized index with cross-session cost summaries.

Extend src/components/views/SessionsView.tsx and the R006 panel through the generated client. SDK discovers and syncs sources; EG owns indexes; Arbora serves bounded search and discovery progress.

Unsupported harnesses, denied sources and partial synchronization remain individually visible. Never claim complete discovery from one source or replace missing costs with zero.

Keep source coverage, sync cursor, index revision, query window, cost units and partial-result flags with every result page. Do not create a browser metric or session index.

From a fresh browser, exercise every supported harness in the versioned owner manifest and search sessions without duplicate identities. Include at least two harnesses when the manifest contains two or more. Two examples alone do not prove manifest-wide coverage. Deny one source and prove visible partial coverage and no hidden-session disclosure.

### WEBUI-APPS-R004.8: Indexed usage analysis

Input `WEBUI:4`; original record SHA-256 `dd790b40c92758d720375c78ccd4278845b8d348022b4d69b978cba049461237`.

Source obligation: The platform tracks token and cost usage per agent and indexes it in local storage. It exposes usage for fast analysis by model, project and agent.

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

Existing owner anchors: WEBUI-APPS-R001; WEBUI-API-R009; ARBORA-OPS-R008; ARBORA-OPS-R009. Entry: Meeting AppSurface and existing dictation seam.

Consume meeting ID, segment ID, sequence, correction revision, timestamps and finalization state. Summary requests bind final transcript revision, admitted provider identity and local/hosted execution class.

Show live partial/final segments and ordered corrections. After meeting finalization, let the user select an available local or hosted summary provider and request a summary.

Add the meeting consumer through existing AppSurface and host transport. SDK owns live transcription/provider transport; EG owns context and summary admission; Arbora serves their generated contracts.

Keep src/hooks/useVoiceDictation.ts single-shot behavior honest. Denied capture, missing streams, sequence gaps or absent providers remain distinct. Never silently move a local-provider request to a hosted service.

Bind summary content and citations to final transcript revision, provider/model revision and admitted execution receipt. Corrections invalidate stale summaries visibly.

In a real browser, receive segments and corrections, finalize, then select local and hosted providers separately. Check actual provider routing and summary provenance. Denied egress and stale transcript requests produce no summary effects.

### WEBUI-APPS-R001.6: Bookmark knowledge views

Input `WEBUI:11`; original record SHA-256 `b1708c96d6b9cadcb1c9f35cc5cb7dde4e60ed2cb1250598e55b9ce4cc66907e`.

Source obligation: The web interface presents a searchable bookmark knowledge base. It supports semantic filtering and an interactive mindmap. It exports CSV or JSON.

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

| Input    | Consumer clauses           | Scope                             |
| -------- | -------------------------- | --------------------------------- |
| AU:103   | `WEBUI-APPS-R004.7.1`–`.6` | Evolution evidence                |
| WEBUI:3  | `WEBUI-APPS-R006.4.1`–`.6` | Unified harness sessions          |
| WEBUI:4  | `WEBUI-APPS-R004.8.1`–`.6` | Indexed usage analysis            |
| WEBUI:5  | `WEBUI-APPS-R030.8.1`–`.6` | Live graph convergence            |
| WEBUI:6  | `WEBUI-APPS-R001.1.1`–`.6` | Retrieval quality comparison      |
| WEBUI:7  | `WEBUI-APPS-R001.2.1`–`.6` | Bounded large-data charts         |
| WEBUI:8  | `WEBUI-APPS-R001.3.1`–`.6` | Column vector controls            |
| WEBUI:9  | `WEBUI-APPS-R001.4.1`–`.6` | Remote editor compatibility       |
| WEBUI:10 | `WEBUI-APPS-R001.5.1`–`.6` | Meeting transcripts and summaries |
| WEBUI:11 | `WEBUI-APPS-R001.6.1`–`.6` | Bookmark knowledge views          |
| AU:107   | `WEBUI-APPS-R001.7.1`–`.6` | Sandboxed design artifacts        |
| AU:115   | `WEBUI-APPS-R001.8.1`–`.6` | Interactive code explanations     |

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
This is partial test evidence only. The harness retains known-failure baselines.
Purpose visibility through shell-heading exceptions still needs rendered acceptance. Child requirements separate the tested subset from the remaining rendered obligations.
Parent rollups do not claim full verification from these partial tests.

### Acceptance decomposition — 2026-10-16

Each R005.1, R005.5 and R005.6 parent rolls up its two child requirements.
The first child records the tested registry or harness contract.
The second retains the full rendered acceptance obligation and remains open.
Test bindings name only the narrow children, not their full-acceptance parents.
The canonical child rollup keeps every parent pending until both children pass.

## Hostile-harness test budget (WEBUI-APPS-R005.5)

Each matrix test has an explicit 5 s budget, the vitest default.
A matrix body takes about 0.4 s; the slowest local body takes 0.9 s.
One main CI body took 10.1 s while its neighbours took 320 ms.
The cause was CPU starvation of the self-hosted runner pod.
The runner pods request 2 CPUs and may use 12, so co-scheduled Rust compiler jobs can starve them.
That failure is an infrastructure failure. The runner capacity owns the fix, not the test budget.

## Responsive workspace architecture and shared action contract

WEBUI-APPS-R045–R050 reuse src/lib/nav-registry.ts, src/lib/apps/contract.ts, App.tsx, reusable domain widgets and src/lib/webmcp. The current 58 application destinations are a baseline, not a closed list. Extend the route registry with semantic destination/action descriptors, never introduce a second router. Dynamic entities use a stable canonical identity and scoped parent/context references; relationship paths may differ. List bounded authorized children lazily and support direct search so an infinite dataset does not require an infinite initial payload.

The three primary contexts are Work, Explore and Operate, with contextual settings and help utilities. The workspace has a persistent context/search bar, compact expandable branch rail and primary task surface. It also has an optional related inspector and run/conversation tray. Map and accessible list are representations of the same state, not separate products. Semantic zoom transitions from ecosystem to branch to entity and deeper actionable leaves. Preserve canonical existing URLs and encode only typed allowlisted context; do not relax the existing WebMCP query/hash/arbitrary URL rejection. Commit semantic changes to browser history, not every camera frame. Back restores prior selection, focus and pane state. Resolve stale/deleted/denied destinations explicitly without disclosing hidden metadata.

One dispatcher accepts stable action ID, validated typed arguments and current context revision. It returns a typed outcome and updated visible state. Manual controls and WebMCP invoke it identically. Separate local view mutations, reads and server effects. Form edits do not submit; security-sensitive fields and ceremony actions retain explicit human-only boundaries. Undo is only offered where a safe inverse exists; it never implies that a committed server effect was cancelled. Apply server-issued preview/confirmation/step-up through existing typed Arbora operations. No new client scheduler, graph engine, policy authority or credentials store is introduced.

Keep the existing native WebMCP adapter, registration lifecycle and attended-control boundary. Core navigation, Atlas state, Markets and dashboard controllers are migration seams. Tools are registered only for the mounted/authorized context, with bounded schemas/results and retirement on identity or generation changes. Page content and descriptions are untrusted data, never authority. Do not publish all backend MCP tools unchanged. Reconcile stale WebMCP documentation with actual dashboard/query and Markets capabilities. Imperative tools and suitable declarative form annotations share the same dispatcher. Feature-detect the actual API instead of relying on browser names.

The official Chrome WebMCP documentation (https://developer.chrome.com/docs/ai/webmcp, checked 2026-10-23) describes a proposed standard, imperative and declarative APIs, and an origin trial from Chrome 149. This is a progressive enhancement, not a universal availability claim. Browser acceptance must record actual API/support and tools Permissions Policy behavior. Existing same-origin/no-cross-origin exposure remains the default; this spec grants no additional browser or remote-control permission.

Delivery order: (1) census and contract tests; (2) shared navigation/action state and responsive shell with current views; (3) domain-by-domain reflow and semantic tools; (4) composed auth/no-auth and performance qualification. Domain backend gaps remain with their existing upstream owners and cannot be concealed by the presentation migration. See workspace-coverage.md for preservation and dependency obligations.

## Registered navigation slice and remaining acceptance

R046.1 introduces only registered branch/list navigation and the shared validated navigation dispatcher. It preserves the existing route registry, role checks and native links. Its source tests use synthetic URL events. R046.2 retains real browser history, dynamic deepest-leaf, camera and rendered mobile acceptance. R047 still requires complete action equivalence beyond navigation. No backend, identity boundary or provider capability is added.

## Consolidated information architecture

The primary contexts are Work, Explore and Operate. Existing route declarations remain the compatibility and capability inventory during migration. They do not mandate separate feature pages.

Work combines conversations, runs, goals, plans and authoring tools around the active task. Explore combines knowledge, objects, graphs, queries, data analysis and contextual app data. Operate combines fleet, system health, usage, integrations and policy administration. A context changes the central working surface while preserving relevant task and selection state. Help, account and settings open utility surfaces; they are not extra primary app contexts.

Canonical state contains context, entity ID, relationship path, lens, active task, inspector and focus target. One entity can appear through multiple relationship paths without duplicate identity. Legacy URLs decode into validated state. Back/Forward and native links use the same state codec. Security scopes and capability checks remain unchanged. An alias must not mount an independent legacy shell.

Use one primary working surface, contextual inspector and task tray. At narrow widths, focus one pane while keeping context and pane switching available. Wider layouts reveal relevant panes instead of adding feature pages. Semantic zoom changes relationship/detail context and renders readable native controls. Map/list, search, keyboard, touch and WebMCP share destination IDs and state.

The migration matrix binds every current destination to its replacement state and removal obligation. Reuse proven domain widgets and typed operations, not page-level layout composition. Retire a legacy standalone layout only after its actions, errors, authorization and deep links have parity evidence. Retain domain capability when its old page disappears. App and dynamic entity additions extend the same matrix and context rules.

Navigation measurement counts deliberate activations that change context, lens or inspector before the target task is usable. It excludes text entry, mandatory confirmation and task execution. Record old and new counts from identical starting state. Record viewport-height scroll distance separately from data-region scrolling. Keep context and primary task actions anchored; never meet a budget by hiding content. Compare run inspection, graph-to-related-object exploration, workflow editing, provider configuration and dashboard editing. Every tested leaf must be reachable directly through search or a compatible deep link.

Migration work prioritizes reusable backend, safety, data, action and accessibility contracts. Do not polish old page layouts scheduled for replacement. Parity means preserved capabilities and safe interactions, not pixel matching or exhaustive cosmetic checks of legacy routes. Existing mobile correctness tests can inform new acceptance fixtures; their old layout is not the design target. Implement and test the consolidated surfaces directly. Legacy compatibility adapters only need routing, state, authority and capability evidence.

## Read-only Explore implementation seam

WEBUI-APPS-R049.1.1 uses the workspace component `ExploreWorkspace.tsx` and `src/lib/explore-workspace.ts`. The component retains collection/query state while a typed entity/tool state selects overview, relationships or history. Manual links and mounted WebMCP use one validator and transition function. The implementation gates reads on resolved identity and the existing user role. Published conversation evidence stays bounded without truncating the working query. Existing typed read clients provide data; no backend operation or effect authority is added.

This opt-in source proof is not the completed destination migration. WEBUI-APPS-R049.1.2 keeps old-address adaptation, remaining domains and real browser/native-provider acceptance open. Do not infer camera zoom, full mobile parity or live backend correctness from mounted component tests. Preserve the original source receipt when comparing independent browser evidence.

The R049.1.1 source contract also retains the typed collection query across remounts and native links. The URL carries validated `q` state so reload and modified-click navigation restore the same investigation. The Explore shell does not mount a hidden dashboard. Existing attended controls remain in normal shell flow during denied and loading states. Public context reports the canonical route and a bounded query representation. The full execution query remains separate and unchanged. Reuse the reviewed consent lifecycle; its separate requirements stay with their existing owner.

## Retained Work source composition

WEBUI-APPS-R049.1.3 reuses the existing Chat lifecycle instead of constructing another conversation engine. The Work surface presents conversation selection, independent served task list/get reads and trace/node reads. Typed URL state and tool navigation use the same validator as manual controls. The anchored shared context rail does not replace or duplicate Chat. Switching context preserves legitimate selection without inventing associations.

No served contract currently links conversation, task, trace, subagent and evidence into one proven chain for this slice. Present independent selectors and provenance honestly. Do not label spans as subagents or infer links from similar IDs, timing or labels. Task cancellation uses its existing Arbora operation and preserves service authority. This slice adds no execution, permission or backend operation. Other capabilities require their existing owning contracts. The complete migration and real-provider/browser qualification remain under R049.1.2.

### Operate discovery source amendment

Add R049.1.4 as a narrow read-only source slice. Canonical `fleet.status` reports child state; process state does not prove callable tools. `fleet.catalog.list` provides caller-visible descriptors and cursors. Browse without named-server filters to avoid the live priming path. Preserve the three-context shell and existing assistant; do not wrap the legacy Fleet Supervisor page. A reader-level presentation gate never substitutes for gateway `mcp:discover` authorization. Bound the preview to ten catalog pages and report incompleteness honestly.

Retain host provisioning, configuration, containment, approval and execution capabilities as explicit R049.1.2 migration obligations. Do not expose those effects or fabricate their backend contracts. Live auth/no-auth, deployment, mobile, accessibility and browser qualification remain independent acceptance work.

### Current response task navigation source

Use the explicit task identifier returned for the active conversation. Render one link for the current non-streaming assistant response. Share the typed Work dispatcher with the browser tool. Treat all trace references as opaque values. Navigation does not establish execution ownership or authorization. Keep full migration and live-provider acceptance open.

Give Work panes readable minimum tracks when the viewport is short. Scroll the workspace rather than collapse the transcript behind the composer. Keep the transcript and composer in normal flow. Preserve response navigation and keyboard behavior.

The bounded workspace command catalog exposes three migrated roots and loaded Explore results. It does not advertise all legacy routes as migrated. Catalog entries are owner- and location-scoped. Native links and semantic selection share the typed context dispatchers. The dialog uses bounded viewport height and normal scrolling. Command identifiers are temporary catalog references, not backend authority. Tool catalog output excludes collection query text. Additional context leaf adapters remain migration work.

Explore uses an explicit evidence/query/validation lens field. Collection search remains in q; executable query drafts do not enter URLs. The retained controller is keyed by owner and evidence context, not the selected lens. Query and validation keep the existing maintainer role boundary. Lens changes only navigate. Explicit controls use the existing SPARQL and ontology-validation APIs. A selected entity does not scope these requests. Hidden evidence withdraws its tools and reads. Shared context links use the same typed parser and dispatcher.

The attended query tool slice adds local draft editing and review requests. It retains the existing local-mutation catalog class. A separate visible control checks the browser trusted-event signal before submission. Review captures the draft, source type and workspace generation. Navigation or edits retire that approval. Provider submission is not cancellation-safe; retired views ignore late results but do not promise to stop backend work. Native tool registration and live provider qualification remain separate gates.

Loaded Work and Operate command adapters reuse the existing command provider. They add no catalog fetch or backend operation. Work registers four bounded groups from its current reads. Operate registers confirmed fleet children and capabilities from loaded catalog pages. Failed discovery withdraws related commands. Native links and semantic selection use the same validated destination. Root commands remain available according to role. Missing or truncated leaves remain reachable through their existing workspace controls.

The Work task lifecycle uses the existing task cancellation operation. Manual controls and a local review tool share the same selected task. The tool opens review only. A trusted browser confirmation sends the request. Admission changes retire reads and reviews. Selection changes retire review. A request that already reached Arbora can continue; the retired view ignores its completion. Refresh reads authoritative task state. No conversation-to-task association is inferred.

## R048 retained registration callback repair

Guard browser-facing tool callbacks with their acknowledged registration lifetime.
A callback retained after cleanup, or from a pending or failed registration, must
refuse dispatch before changing navigation state. Keep validation and role checks
in the existing page tools and shared navigation dispatcher. This is a partial
R048 source repair; native-browser qualification and the remaining authority and
cancellation matrix stay open.

### Connector tile composition amendment

The Operate connector panel adds partial presentation for WEBUI-APPS-R005.3 under the
R049 workspace migration. Reuse the caller-visible `fleet.status` inventory
that backs the existing ecosystem services adapter. Each returned child gets
a tile, including children with no loaded capability descriptions. Show the
reported process state and optional mounted-tool, in-flight, queue and restart
counters without inferring connectivity or execution permission. Missing
counters read “Not available”; zero remains zero. Selection uses the existing
Operate dispatcher and preserves the filter and capability inspector. The panel never
requests, persists or renders connector configuration or credentials.
Failed refresh withdraws the old tiles; an empty inventory and a filter with
no matches remain distinct. These tests prove presentation over returned fleet children.
They do not prove complete connector catalog membership or connection state.
R005.3 and full migration and installed-provider acceptance remain open.

## R048 hidden document registration lifecycle

The provider subscribes to document visibility before registering page or child tools.
Hidden documents keep manual content mounted but expose no browser tool registrations.
Visibility changes trigger existing registration cleanup and publish fresh registrations when the document becomes visible.
The channel retains its existing visibility revocation behavior.
This partial source repair does not qualify native browser support or complete R048.

## R048 cooperative execution lifetime

Browser tool execution receives cancellation from both its caller and its registration lifetime.
The adapter links these signals for each call and detaches listeners when the call settles.
The shared tool factory exposes execution options to cooperative handlers.
Provider cleanup on route, identity or visibility changes aborts those running calls.
Handlers must observe the signal before continuing asynchronous work.
The adapter preserves returned outcomes and does not describe a completed dispatch as rolled back.
Native browser scheduling, served authority and complete R048 acceptance remain open.

### R048 native replacement routing

Chromium 156 experimental WebMCP resolved a retained native Tool reference to a new same-name registration. Each native registration now has a unique routing name; the application registry retains the semantic tool ID. This prevents stale native references from selecting replacement callbacks. The rendered route, Back/Forward, deep-link and restoration matrix uses native discovery with synthetic backend responses. Authenticated served authority acceptance remains open; R048 is not complete.

### Connector catalog registration presentation

Extend the R005.3 Operate panel with the existing Arbora `/api/enhanced/tools`
contract. Arbora v0.1.7 and current main define `EnhancedCatalog.servers` in
`arbora/gateway/enhanced_catalog_api.py`. Its WebUI composer mounts
`register_graph_routes`, which registers this route before the SPA fallback.
Render every returned catalog server, including absent registrations and zero
catalog tools, independently of running fleet children. `available` means a
live registration exists; it does not establish a provider connection. Preserve
that distinction in visible labels. Strip URLs and raw error fields from the
browser projection. Scope reads to the current admission, and withdraw stale
results on refusal. Missing host composition remains visibly unavailable.
Full connection-state and installed-provider acceptance remain open.

### Contextual connector definitions

Extend existing R005.3 and R049.1.2 inspection within the selected catalog connector.
Join tools and skills only through returned `server_name`; retain each definition identity.
Render lifecycle, authority, revision and digests without implying execution permission.
Keep registration availability, MCP transport state and unknown provider connectivity distinct.
Retire selection after catalog refresh, refusal or admission change.
Full migration, provider connectivity and governed execution acceptance remain open.

### Operate readiness diagnosis

Use the supported dashboard readiness route for existing R049.1.2 health-context migration.
Preserve returned rollups, dynamic checks, snapshot provenance and complete check evidence.
Accept a validated diagnostic snapshot on HTTP 503; transport refusal remains distinct.
The installed graph-analysis readiness action is unserved and cannot qualify this journey.
Let operators select a returned check, inspect its evidence and explicitly reprobe.
Replace the previous evidence on refresh and retire it on admission changes.
Do not infer query readiness or fixed checks absent from the response.

Inventory bounds: the workspace matrix assigns prompt/template editing to Work, so this lane leaves it there.
Installed scheduling, pipeline, maintenance and model-management facades refuse unsupported operations.
Fleet load/unload require authenticated MCP sessions and are not HTTP actions.
Legacy broker topic/message requests do not match its advertised queue/publish contract.
Readiness diagnosis uses the supported dashboard collector rather than those unavailable journeys.

### Supported Operate migration acceptance

Consolidate catalog inspection and readiness diagnosis through their existing Operate controls.
Retire the standalone readiness layout only after its refresh and evidence behavior passes in Operate.
Map the legacy readiness address through a typed compatibility adapter with reader access and replacement history.
Focus the readiness heading on arrival without creating a Back-navigation loop.
Preserve missing-route, access-denied, invalid-response and transport-failure distinctions before retiring the legacy view.
Keep integration package descriptors separate from connector identities; their missing contract prevents that alias migration.

## Cold-entry asset resolution amendment

Fix nested workspace entry in the existing Vite configuration. Keep the static
host and admission behavior unchanged. Exercise generated asset references for
the default origin root and an explicit asset prefix. Drive the production
bundle through the installed Arbora application composer and WebUI static mount.
Use synthetic identity/data only; retain the full R046.2.2 and R050 acceptance
obligations. No additional requirement decomposition is introduced.

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

### Work trace inspection continuation

Extend WEBUI-APPS-R049.1.3 within the existing Work surface.
Refresh the selected trace through its existing waterfall adapter.
Return from a node to its trace.
Follow a recorded parent only when that parent exists in the loaded trace.
Preserve conversation and independent task selection in all destinations.
Failed detail refresh withdraws stale evidence and node controls.
Retry restores only validated matching detail.

Mounted components and synthetic Chromium history tests qualify this bounded interaction.
Served-provider acceptance remains open.
This does not provide a conversation/task/trace join, subagent identity, plan state or unified harness discovery.

Chat owns streaming, local conversation history, approval/elicitation and ask/plan/code input modes.
CurrentResponseTaskLink uses the explicit response task identifier to enter Work.
Work uses the existing enhanced sessions facade for agents.tasks.list/get/cancel.
It uses the traces search/waterfall adapter for independent inspection.
SessionsView expects legacy title/turn-count/string-status fields.
That model differs from the facade's task model.
Its reply/delete console remains outside this migration.
ConsoleConfirmView retains its direct plan-reference URL and human review boundary.
Chat's plan mode and routing-plan activity do not provide an authoritative current-run plan snapshot.
Richer metrics, goal/workflow editing, IDE authoring and harness discovery remain migration obligations.
This continuation preserves their legacy routes.

### Task output inspection in Work

WEBUI-APPS-R049.1.3 also renders returned task output inside the selected task.
The producer is agents.tasks.get through the existing enhanced sessions detail facade.
Arbora's A2ATask contains text artifacts and explicit metadata from WorkItemA2AAuthority.
Artifact containment establishes its task association. No identifier parsing establishes any other association.
Render contextId, metadata.arbora.runId and runTraceRef as opaque text when valid.
Do not navigate from those references or infer a browser conversation, trace selection or subagent.
Render only bounded text artifacts. Refuse unsupported or malformed output without hiding valid task status and cancellation controls.
Preserve missing output and explicit producer refusal as distinct states.
Component and synthetic browser fixtures qualify presentation only. Full migration and live-provider acceptance remain open.

Task reads do not retry explicit 401, 403, 404 or 501 responses.
Transient failures retain bounded retries. The caller can request another read explicitly.
This avoids keeping cached output visible during retry backoff after an explicit refusal.

### Fleet discovery host admission

WEBUI-APPS-R049.1.4 classifies only the canonical fleet status and catalog-list
POSTs as host-level reads. Arbora declares both `Effect.READ` and requires
`mcp:discover`; that downstream policy remains authoritative. Neighboring fleet
calls, tool load/unload, unknown POST paths and other mutation methods retain
the write floor. This repairs transport classification, not caller grants or provider
acceptance.

### Work conversation lifecycle

Extend R049.1.3 and the migration inventory under R049.1.2 with the existing owner-scoped chat store.
Start a new conversation without leaving Work or clearing independent task and trace selection.
Rename only a local index entry and delete only the selected owner's local index and message cache.
Neither action mutates server history; remote records can remain in the selector.
Use visible attended review for these changes, including the loss of an unsent draft when changing conversation.
Bind reviews and semantic review requests to the current owner, conversation and local-copy snapshot.
Retire reviews when that context changes. Check local storage readback before reporting success.
Keep the existing conversation selector, legacy links and one retained Chat instance.

### Contextual Work prompt authoring

Extend WEBUI-APPS-R049.1.2 and R049.1.3 with an admin-only prompts lens.
Reuse the existing validated prompt editor and its canonical list/read/upsert adapter.
Do not add a backend API or infer a task association.
Keep conversation, task and independent trace selection in typed Work URLs.
Keep prompt documents and unsaved edits out of URLs and semantic navigation.
Share lens selection between native links and WebMCP. Selecting a lens must
not save a prompt. Preserve drafts while switching lenses in the admitted
Work workspace, and retire the editor when the identity admission changes.
Retain the legacy prompts route and its existing editor behavior. This slice
does not claim full authoring-tool parity, provider acceptance, plan metrics,
harness discovery, or complete Work destination migration.

## Persistent loaded workspace frame

Extend the existing workspace requirements without new decomposition. Keep the
three-context rail and task surfaces. Add a persistent map/list of loaded
caller-visible destinations beside those surfaces. Let the URL select the map
branch. Native links, breadcrumbs and search use the existing typed dispatchers.
Presentation changes add no browser history. Preserve the stable chat instance
and all existing controls during viewport changes. Narrow layouts stack the map
and task surface with explicit focus controls. This bounded shell does not
migrate legacy pages or prove all dynamic leaves and installed providers.

### Workspace entry and prompt compatibility slice (2026-10-24)

R045/R049.1/R049.1.2 retain ownership of entry migration. The registry declares
`/` as the workspace entry. Admitted user-or-higher identities enter Work.
Readers enter Operate. Signed-out or unresolved identities do not redirect.
The still-unmigrated dashboard remains available at `/overview`. `/prompts`
retains its admin admission and resolves to the Work prompt lens using the same
editor, not a second authoring implementation. Compatibility replaces the
current history entry, retains query and fragment context, and fails closed on
malformed or conflicting Work state. Manual and WebMCP navigation share the
same registry resolution; WebMCP still rejects caller-provided query/fragment
state. Existing owner retirement and retained drafts apply within Work.
All other legacy destinations remain unchanged. Source-mounted journeys do not
establish native-browser acceptance, complete semantic authoring coverage, or
completion of the ground-up redesign.

Entry reconciliation also tests the real persistent frame after tree/map integration.
The location subscription retains its pathname/query contract. Compatibility history
replacement preserves inert fragments without admitting them as semantic map state.
Mounted tests check the selected Work branch and editor DOM across map presentation changes.

R049 owns this partial entry migration. R049.1.3 owns the retained Work source behavior.
R045 and R049.1.2 remain open; these source receipts do not complete either requirement.

### Loaded catalog navigation

R046.2.2, R047 and R049.1.2 partial delivery adds caller-visible connector and
associated tool/skill definition identities to the existing Operate destination.
Native inspector links, command search, branch browsing and the command WebMCP
adapter share the typed destination. Refresh and admission changes withdraw
unconfirmed definitions instead of retaining stale evidence. Only bounded
identifiers enter the URL; no definition body, token or execution authority does.
Full dynamic-leaf, native-provider and complete migration acceptance remain open.

### Canonical chat turn usage — 2026-10-24

This bounded consumer slice does not complete WEBUI-APPS-R004.3 or
WEBUI-APPS-R004.8. Their context-budget, cost and indexed-analysis acceptance
remains open. Arbora returns `metadata.arbora.usage` from the caller-bound
durable completion. Bind the receipt's `runId`, `taskId`, `contextId` and
`scope: turn` to the returned task identity. Bind its presentation to the current
conversation. Preserve the exact receipt through model and Vercel message metadata.

The transport retains explicit run bindings across same-message replacement.
Seed and prune correlation from committed, current-owner conversation history at
stream entry. Absent messages and retired conversations cannot seed new state.
A conflicting run clears usage without changing the returned outer identity.
This temporary presentation correlation creates no accounting ledger or authorization.

The transport adapter resets canonical metadata before the AI SDK deep merge.
A later partial receipt cannot retain omitted counters. The five optional counts
are requests, tool calls, input tokens, output tokens and total tokens.
Each count is an integer from zero through the JavaScript safe-integer maximum.
Reject unknown counters and malformed or mismatched receipts as a whole.

Render known counts, including zero, once per admitted task/run.
A later replay replaces the earlier presentation. Missing, denied or invalid
usage clears prior counts. Never derive a total from input/output or accumulate
a session total. Do not infer timing, throughput or cost for canonical Arbora
turns. Generic provider estimates remain separate and exclude Arbora-tagged messages.

Focused tests cover the decoder, Vercel stream, rendered Chat, replay and caller
separation. They do not establish native producer, restart, context-budget or
full-session acceptance.

### Read-only current plan in the selected task

Extend WEBUI-APPS-R004.4 through the existing Arbora operation transport.
The selected task's validated `metadata.arbora.runId` selects `runs.current_plan`.
Arbora projects that reference from its stored task run identifier; its presence
does not prove plan availability. The independent Work trace URL and
`runTraceRef` never select this read. Render only the SDK current-plan snapshot,
not an executable task plan or a plan inferred from chat content.
Clear expired snapshots and retire requests across task and identity changes.
Classify only the canonical `Effect.READ` POST as a host read; retain
authentication, CSRF and downstream caller policy. Do not grant write access
to compensate for a read transport. This bounded slice adds no editing,
metrics, harness configuration, trace association or provider acceptance.

### 2026-10-24: Nested execution explorer in Work

This extends R049.1.2 without narrowing its complete migration and served-provider obligations.
R049.1.3 retains its independent task/trace source evidence and explicit refusal to infer subagents.
R004.4 keeps the current-plan view read-only and bound to the selected task's authoritative run identifier.
An independent trace selection must not become that run binding.
The existing `parentId` trace waterfall shows nesting, not the agent orchestration dependency DAG.
Node selection currently does not retarget Chat.

Depends-on: [Execution projections](https://github.com/Knuckles-Team/arbora/blob/main/specs/hosted-api-operations/spec.md), [Served child controls](https://github.com/Knuckles-Team/arbora/blob/main/specs/dependency-ordered-release/spec.md)

R049.1.2 consumes `ARBORA-OPS-R021.4.8` and `ARBORA-OPS-R021.4.9` through `WEBUI-API-R011.3`.
R049.1.10 and R049.1.11 consume `ARBORA-RELEASE-R003.4.12` and `ARBORA-RELEASE-R003.4.13` respectively.
These upstream requirements do not establish current installed-provider availability.
Do not invent operation names or browser-only protocol variants before the released schema exists.

#### Shared identity and navigation

The root request `task_id` identifies a WorkItem/A2A task; event `task_id` identifies a run-local step.
A producer-issued node key is `(run_id, node_kind, local_id)`, not an interchangeable task or conversation identifier.
The producer provides owner, conversation and control-target bindings separately.
Existing shared child `run_id` values do not prove unique execution identity or a child mailbox.
Trace spans, labels, timestamps and similar identifiers must not create association edges.

Extend `WorkWorkspace.tsx:42` in the existing workspace component directory and `src/lib/work-workspace.ts:95`.
Reuse their typed navigation helpers rather than adding a fourth context.
Native links, command search, manual selection and attended WebMCP must use the same validated destination.
Deep links contain opaque root/node references, never transcripts, credentials or capability secrets.
Reauthorize every reopened destination; invalid or unauthorized nodes must not reveal cached details.
Keep original conversation, task and independent trace selection distinct from the explorer selection.

Render `spawned_child` hierarchy edges and `depends_on` dependency edges with distinct labels and accessible descriptions.
Breadcrumbs follow recorded hierarchy; dependency navigation keeps a separate return path.
A fan-in node may have more than one dependency without acquiring invented spawn parents.
Selecting a graph node opens authorized details and does not change the Chat target.
An explicit target action must show the intended child before sending.
Keep the root conversation draft intact while inspecting or interacting with a child.

Snapshots carry schema version, covered cursor, completeness and per-run cursor maps for nested runs.
Apply only bound updates and discard stale requests after owner, selection or generation changes.
Recover replay gaps through the producer's resnapshot path; never invent global ordering across runs.
Use bounded pagination and viewport rendering, with visible partial-scope labels.
Distinguish available-empty, partial, unavailable, denied and failed results.

#### Public records and accessible interaction

Use the existing Chat parts and inspector components for public summaries, tool activity and transcript records.
Label these categories separately; never show private reasoning or unknown fields.
Preserve explicit expansion choice through streaming, reconnect and replay for the same node and event identity.
A missing transcript capability means unavailable history, not an empty successful conversation.
A denied refresh must clear protected records and controls, even after earlier success.

Provide a searchable list or adjacency view with every graph action available by keyboard and touch.
Support parent return, selectable nodes and visible focus without relying on color, canvas gestures or hover.
At narrow widths and 200-percent zoom, use stacked panes or a drawer without losing actions or the return path.
Actual browser Back/Forward, reload and deep-link navigation must restore only reauthorized selections.
Closing an inspector returns focus to its invoking node and must not submit a message.

#### Control boundaries

`can_read_events`, `can_read_transcript`, `can_message_active` and `can_continue_completed` default to false.
Backend authorization remains required even when the current capability projection activates a control.
`Message active child` and `Continue completed child` have separate labels, target bindings and lifecycle conditions.
Never pass graph or span identifiers into the existing root-message path.
Continuation returns an authoritative new execution identity and history relationship; it does not rewrite the completed child.
Retire previews after selection, owner, lifecycle or capability changes.
Unsupported controls make zero effect requests and show the producer's bounded unavailable reason.
A lost response remains unknown; reconnect reconciles the original request without automatic resend.
Cancellation uses only its exact authorized target and reports acknowledgement separately from eventual terminal state.
Drawn descendants do not imply permission to cancel a subtree.

### 2026-10-24: Bounded flat execution graph source slice

R049.1.13 adds a read-only inline dependency view in the selected Work task.
It consumes the explicit `runs.execution_graph` operation and
`arbora-execution-graph-v1` projection, not replay-v1 event inference.
The selected task response provides `metadata.arbora.runId`; the request also
passes its root task ID for producer-side ownership validation. Independent
trace and node selections cannot provide either binding. An absent operation
remains unavailable, with no legacy fallback or fabricated graph.

The bounded adapter validates the envelope, exact run/task identities, unique
plan-step keys, explicit predecessor-to-dependent edges and evidence. The layout only places declared nodes; it does not schedule tasks or infer lineage.
The inline diagram has an equivalent keyboard-accessible dependency list.
It wraps or scrolls within the existing Work panel at narrow widths. Labels remain
plain text. Refresh, selection and identity changes retire the previous read;
denied or malformed responses cannot reveal cached protected graph data.

Topology is complete only within the producer-declared flat plan. Lifecycle
coverage is always incomplete, including when `has_more` is false. Unobserved
is not pending, queued or successful. Show the covered cursor and whether
more evidence exists. Child hierarchy, transcript access, private reasoning,
active-child messaging and completed-child continuation remain unavailable.
Inspection never changes the Chat target or conversation selection.

Mounted Work and adapter contract fixtures qualify this source slice only.
The producer is unreleased; no installed-provider, browser rendering, nested
execution, chat-targeting or full R049.1.2 completion is claimed.

## Canopy Glass shared-shell and Explore slice — 2026-10-24

WEBUI-APPS-R049.2.1 applies the existing design-system children
WEBUI-DESIGN-R002.1.1/R004.1.1/R005.2 to the shared workspace and retained Explore
journey. Extend `WorkspaceContextRail`, `WorkspaceFrame`, `WorkspaceCommands` and
`ExploreWorkspace`; retain their existing authority, state and focus seams.

Keep a single full-width header with visibly labelled context navigation,
current context, search/commands and main actions. Reflow into rows instead of
hiding main navigation in a compact menu. Retain the resizable map and give the
main task the remaining width. Collection-only mode must not reserve an empty
inspector. A selected record exposes actual detail and its existing overview, relationships and history controls. Returning to the collection preserves query and results. Small layouts stack or focus the same capabilities with keyboard
access, not a mobile subset. Avoid decorative filler or a second assistant tray.

Keep existing typed URL parsing, native/modified links, mounted query/chat state,
identity admission and manual/WebMCP dispatch. A visual selection changes neither
backend authority nor the set of callable capabilities. No new data read, endpoint,
router, credential store or invented relationship is needed. Revoked identity,
stale handles, denied data and superseded selection retain their existing refusal
behavior. Preserve noauth, EG and OIDC as authority modes rather than themes.

The design is original and uses existing brand artwork and same-origin fonts.
Reuse the current provider for density and appearance preferences. The companion
[interaction contract](../browser-design-system/interaction-contract.md) defines
material, expanded-header, motion and fallback behavior. This is a staged theme implementation. The 58-destination migration, nested execution, all-leaf semantic navigation, native WebMCP equivalence and real-provider evidence remain incomplete.
R045–R050 retain every broader obligation. Qualify remaining graph, editor, run,
administration and authentication surfaces through their existing owners.

## Native workspace assistant amendment — 2026-10-24

Extend WEBUI-APPS-R005.4, R049.1.3 and R049.2 within the existing shared shell.
Replace the floating chat launcher, backdrop and off-canvas drawer with one
visible in-flow assistant. Reuse ChatPanel, Chat, the owner-scoped conversation
store, canonical transport and page-context envelope. Retain transcript,
composer, attachments, model/tool controls, streaming, approvals and task links.
Use a bounded side dock only when the available task width fits it.
Otherwise, stack a compact visible composer and real status without occlusion. The
transcript and additional composer options expand explicitly at narrow widths
without replacing their state. Expansion and focus controls are local presentation
changes, not new authority or a second conversation. The task receives most
available desktop width rather than a mandatory equal split. Delete the viewport exclusion and bottom padding reserved for the launcher.

Preserve the mounted assistant and unsent draft through navigation and resize.
The existing Chat admission boundary retires protected state on identity loss
or owner change. Selection context follows the existing publisher. It does not
imply task ownership, a chat target change or permission to execute a tool.
Source tests cover real Chat retention, current context on send and owner
retirement. Authored browser journeys cover geometry, keyboard, touch and
short/narrow layouts separately from actual execution of those journeys.
R045–R050 and WEBUI-DESIGN-R004.1/R004.2 retain full co-navigation, native WebMCP,
mobile/device, all-route migration and installed-provider acceptance.

Critical compact-state controls remain outside optional message tools: the
existing SWE mode, live session and Stop controls. Request-mode selection is
deleted under R005.4.1. Pending
approval renderers mark their actual review state. The shell exposes
Review required approval, which only expands and focuses that same UI.
No approval decision, execution path or provider is added. Clearing the existing
review or retiring its owner deletes the cue. Hidden focus on disclosure or
container resize moves to the persistent composer without remounting Chat.

### Hosted Explore focus correction — 2026-10-24

R049.2.1 focus belongs to the active evidence journey: closing detail returns to
the retained search, and selecting evidence focuses its heading. The query-lens
wrapper must not override that focus when its identity/selection-keyed subtree
remounts or React repeats effects. Query/validation lens changes still focus their
own heading. Native focus must reveal the destination at narrow widths rather
than leaving keyboard focus outside the visible scrollport. Fresh entry must not
steal focus or jump the viewport. Keep identity retirement and existing typed navigation unchanged.

Preserve R005.6.2's visible registry purpose in all workspace shells. Use a compact
paragraph, not a redundant page hero; density must not delete required purpose.

R049.1.13 retains its full-visibility keyboard test after shared-shell changes.
Qualify the diagram and step details at wide, narrow, low-height and enlarged-text
sizes. Never weaken the viewport ratio or replace the equivalent dependency list
to accommodate the new header. Read admission, lifecycle honesty and graph
semantics remain unchanged.

### Hosted native assistant qualification

The first draft passed hosted typecheck and full lint on c8bd060, composed with base 954a227.
The identity journey failed its initial narrow Operate action hit test.
That result does not yet distinguish occlusion from missing keyboard navigation.
Preserve initial geometry and failure captures. Reach each action with native Tab navigation, then retain the unchanged hit test.
The advancing base also changed generated design evidence. Regenerate the composed history receipt without hand-editing status.
Full native browser acceptance remains open.

The next hosted identity pass confirms native keyboard access at narrow widths.
Initial pixels retain the full header, task scrollport and compact composer without launcher clearance.
Compose the Work focus-inset correction using the route's existing identity, not its retired shell depth.
Keep full evidence viewport assertions and focused-control margins distinct.
Write native browser captures to retained output paths; attachment buffers alone do not persist with the list reporter.

The native browser pass exposed compact composer clipping with enlarged text.
Give the compact assistant its intrinsic height and let the outer boundary scroll.
Do not change expanded transcript scrolling or hide active execution controls.
Keep ordinary wheel reachability and all four painted-control hit tests.
Use the rendered markdown destination's button role for the resize focus precondition.
Pending-approval review and fresh-entry focus passed; remaining browser cases still need qualification.

### Acceptance rollup correction — 2026-10-24

The source-delivery children did not exhaust their original parent acceptance criteria.
Explicit retained-acceptance children now preserve those obligations in canonical generated rollups.
Parent requirement text and qualified child evidence remain unchanged.
Regenerate every spec status and audit ancestor states after source and receipt commits.
The metadata regression must not create feature-acceptance bindings for retained work.

### 2026-10-25: Native Explore sampled graph lens

Extend R049.1.2 with bounded child R049.1.14. Share GraphView's validated graph
reads, GraphCanvas and GraphAdapter, not its page/card/tab shell. Preserve the
existing reader-level graph boundary within Explore's user-level boundary.
Nodes and edges use the existing typed served facades; stats/type aggregates
retain their existing honest unavailable and partial states. Do not substitute
GraphSchema, which is an administrative operation, for any read capability.

Graph selection and type filters are independent of evidence identity. Keep
query drafts/results within the owner-and-role-scoped Explore lifetime. Clear
obsolete/denied read data and retire hidden handles. Provide a keyboard list
for the same sampled adjacency. Do not claim a complete neighborhood.
Read-only canvas disables every edit entry point. Legacy local draft editing is
not an engine write and remains unmigrated with Cypher and MAGMA. R030 writes,
API R008.2 served parity, R046.2.2 full continuity, R047/R048 complete command
coverage and R049.1.2 migration remain open. Mounted fixtures and metadata
checks are not actual browser, installed-provider or full-redesign acceptance.

## Contextual Work workflow continuation — 2026-10-25

Extend the existing R049.1.2 migration owner with source child R049.1.15.
Extract WorkflowEditorView into a contextual editor/controller that reuses the
existing workflow client and graph-to-spec helpers. Retain the mounted editor
while Work switches to task inspection. Workflow selection is independent of
conversation, task and trace selections, and drafts stay out of URLs.

The current host allows administrator workflow reads but does not implement the
capabilities route. Save and Run explicitly report unavailable. Keep these
effect controls disabled. Label each edit as an in-memory preview, never a durable save or successful run. Do not add endpoints or infer capability
from a loaded list. Preserve errors instead of showing a successful empty catalog. Future effect activation still requires the existing authority and
confirmation protocol and separate provider acceptance under WEBUI-API-R009.

Scope source tests to retained draft/selection/validation, keyboard editing,
failed or malformed reads, stale replies and admission replacement. Keep served, native-tool, performance and full responsive acceptance open under the original broad owners.
Source tests do not establish those outcomes.

### Contextual Operate usage — 2026-10-25

R049.1.16 extracts the existing analytics presentation, not its standalone page shell.
Operate keeps Health/Services context while selecting Usage, a session and its timeline.
Use the current `/api/observability` bindings and server-derived user admission.
Tenant totals from `usage.read` do not establish model costs, sessions or traces.
The existing search, session detail and trace bindings have no tenant-filter argument.
Do not issue those reads for an explicit foreign tenant or imply filtered results.
The client has no instrumentation manifest, so a successful summary is not proof
that every source is captured. No new backend, pricing, permissions or scheduler.
Missing analytics and indexed harness producers remain explicit residuals under
R004.8/R006.4 and WEBUI-API-R009/R011. Source and browser fixtures are not delivery
of those producers. Keep broad navigation, authority, responsive and measured-design
acceptance open under R047/R049.1.2 and WEBUI-DESIGN-R004.1.2/R004.2.2.

Producer inspection found only client bindings for `/api/observability/*` in the
current WebUI source, not matching WebUI host route implementations. The inspected
Arbora `usage.read` operation declares only a tenant-scoped totals snapshot and
`usage:read` scope. It is not an analytics/session replacement. Check served analytics
availability independently. This UI shows unavailable responses; fixtures do not
prove producer delivery.

### 2026-10-25: Native feature-lens integration

Compose source children R049.1.14, R049.1.15 and R049.1.16 on the same admitted
workspace. Central commands preserve the existing lens policies.
Explore graph and evidence require user. Query and validation require maintainer.
Workflow plans require admin, and usage requires user. Keep the reader-level legacy graph route
for unmigrated editor, Cypher and MAGMA features. Workflow and usage compatibility
aliases retain their source role before canonical navigation.

Fleet and connector-catalog destinations select Services without discarding
retained usage filters or session context. Add all three authored synthetic
browser journeys to the existing required hosted selection and artifact capture.
Source integration does not establish native-browser or provider acceptance.
Workflow edits remain in memory with Save/Run unavailable. Analytics keep the existing unavailable bindings.
Do not derive rich evidence from usage totals or add a producer endpoint. Durable indexes remain with epistemic-graph.

## Liquid Glass reference correction — 2026-10-25

Extend R049.2.1 and R005.4/R049.1.3 in their existing composition. Replace the
default assistant side column with a contextual Agent entry in existing chrome.
Reserve no permanent bottom bar or idle column; never use a floating bubble.
Expand the same Chat instance in place; preserve drafts, owner retirement, real
status, pending approvals, mode, stop, attachment and message-option access.
Give the released width to evidence results and selected detail. Render optional
summary/source metadata only when returned by the existing evidence search.
No empty inspector, invented status or evidence, extra data access, or new router.

Hosted browser captures and a short disclosure/selection video remain required
for reference review. Keep broad all-route and installed-provider acceptance open.

### 2026-10-25: Conversation-first product clarity

Extend R005.4, R045, R049.1.3 and R049.2/.1 in place. The accepted Liquid Glass
materials remain unchanged. Work foregrounds the one mounted Chat with zero
disclosure clicks. Saved conversations, tasks and independent technical traces
remain reachable without invented associations. Show Chat, Knowledge and Tools.
Keep stable route IDs, URLs, permissions and owner retirement.
Use generic stored-record language rather than screenshot fixture titles.
Source tests do not close broad redesign or installed-provider acceptance.

The same amendment moves private-workspace privacy controls into the existing
Settings disclosure for every admitted role. Omit the automatic prompt and header link.
This must not grant consent, change a stored choice or start analytics.
Keep the Privacy page and existing allow/disable/revoke controls reachable there.
An empty conversation explains the core jobs. Text-only examples fill the existing draft.
They do not submit, execute or change configuration.

This scope includes retained private routes and public or signed-out entry.
No route mounts an automatic privacy banner. Retained private navigation uses
the same Settings controls. The public policy page stays reachable. This change
does not suppress tool, action or browser permission reviews.

### 2026-10-25: Conversation-first native lens integration

Combine R049.1.14/.15/.16 with the R049.2.1 conversation-first shell. Preserve
native graph selection retirement, workflow drafts and usage context while
retaining the clearer Chat, Knowledge and Tools presentation. Keep all native
browser journeys in the required Canopy selection. The 320px fresh secondary
entry retains the exact zero-scroll assertion. Source checks do not prove browser
geometry acceptance or provider completeness.

### Request handling without a mode (2026-10-25)

R005.4.1 deletes Chat request-mode UI, storage and payload only. Reuse the existing agents.run host adapter, which already forwards ordinary user text without this field. Do not classify prompts locally or alter authorization, approvals, model selection or developer workspace routing.
