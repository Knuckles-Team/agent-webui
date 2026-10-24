# Arbora shell and app verification

| Case | Level/fixture | Pass |
|---|---|---|
| Product identity | Asset-generator check, metadata/route snapshots | All exposed names and generated hashes match |
| Package/consumer | Wheel, import and Arbora consumer fixture | Canonical package imports; release assets included; no old runtime alias |
| Native app | Markets fixture + route/client/WebMCP/renderer tests | Single AppSurface registers all declared pieces |
| Contributed app | Valid descriptor and malformed/unauthorized descriptors | Valid app appears per capability; invalid entries fail closed without code loading |
| Old state and grants | Browser profile with prior consent/tool IDs | Re-consent required; old grant cannot invoke new tool |
| Direct denied URL | Two-principal browser fixture | No privileged component data or tool registration exposed |
| Mobile/desktop accessibility | Playwright keyboard/touch and reduced-motion fixture | Focus, nav labels, hit targets, contrast and error states pass |
| Sidebar catalog provider | `AppSidebar.navigation.test.tsx` uses the real query hook and deferred catalog response. Conversation suites cover deletion and deep links. | Available links appear after catalog resolution. Unavailable links stay hidden. Navigation and conversation regressions pass. |
| Public site | `mkdocs build --strict` and Pages artifact inspection | Links/assets resolve under published base path |
| Run surface WEBUI-APPS-R004.1 | `tests/x::test_run_read_uses_arbora_operations` | Run read goes through the arbora read operations. |
| Run surface WEBUI-APPS-R004.2 | `tests/x::test_harness_config_shown` | Applied harness configuration is shown. |
| Run surface WEBUI-APPS-R004.3 | `tests/x::test_context_and_cost_shown` | Context use is shown against the budget. |
| Run surface WEBUI-APPS-R004.4 | `tests/x::test_plan_read_only` | Current plan is shown read-only. |
| Run surface WEBUI-APPS-R004.5 | `tests/x::test_termination_reasons_distinct` | Each termination reason has a distinct state. |
| Run surface WEBUI-APPS-R004.6 | `tests/x::test_absent_operation_not_available` | Absent operation shows an honest state. |
| Graph and memory WEBUI-APPS-R030.1 | `src/__tests__/graph-edit-types.test.ts::test_edit_types_closed` | Graph edit types. |
| Graph and memory WEBUI-APPS-R030.2 | `src/__tests__/graph-edit-send.test.ts::test_send_returns_engine_verdict` | Send edits to arbora. |
| Graph and memory WEBUI-APPS-R030.3 | `src/__tests__/graph-edit-wiring.test.tsx::test_handlers_call_send_graph_edit` | Wire graph handlers to the engine. |
| Graph and memory WEBUI-APPS-R030.4 | `src/__tests__/graph-edit-refusal.test.tsx::test_unauthorized_edit_refused_and_unchanged` | Show refusals on unauthorized edits. |
| Graph and memory WEBUI-APPS-R030.5 | `src/__tests__/graph-persona-filter.test.tsx::test_persona_changes_presentation_only` | Semantic filters and persona modes. |
| Graph and memory WEBUI-APPS-R030.6 | `src/__tests__/graph-edit-log.test.tsx::test_log_records_each_verdict` | Edit log with verdicts. |
| Graph and memory WEBUI-APPS-R030.7 | `e2e/graph-edit-served.spec.ts::overlay_edit_reaches_durable_engine` (planned) | Use the actual Arbora operation and fixture engine. Unauthorized edits leave the durable graph unchanged. Authorized mutations survive reload. Do not mock the client, gateway, host handler or engine transport. |
| Graph and memory WEBUI-APPS-R031.1 | `src/__tests__/memory-files-types.test.ts::test_memory_file_types_closed` | Memory file types. |
| Graph and memory WEBUI-APPS-R031.2 | `src/__tests__/memory-files-ops.test.ts::test_generated_operations_preserve_preconditions; e2e/memory-files-served.spec.ts::authorized_snapshots_and_cursor_refusal` (planned) | Authorized exact-revision content and stable metadata pages reach actual registered operations. Stale/cross-scope/expired cursors refuse without hidden metadata and require explicit restart. Exact preconditions/bytes/digests and retry identity survive the transport; changed-body replay refuses. |
| Graph and memory WEBUI-APPS-R031.3 | `src/__tests__/memory-files-wiring.test.tsx::test_files_tab_uses_canonical_invoke; e2e/memory-files-served.spec.ts::navigation_reaches_registered_memory_operations` (planned) | Navigation reaches Files, list/read/save use canonical invoke and real same-origin hosting. Missing registration/schema/host is not available. Late responses cannot replace another document or principal state; access loss clears protected content. |
| Graph and memory WEBUI-APPS-R031.4 | `src/__tests__/memory-files-conflict.test.tsx::test_authorized_conflict_and_head_free_refusal; e2e/memory-files-served.spec.ts::denied_reads_creates_and_replays_are_redacted` (planned) | Authorized stale submit retains both contents/digests across restart with unchanged accepted head. Denied existing/absent/create requests, cross-scope conflict reads and revoked replay disclose only error code/correlation. This applies to UI, errors and activity. Capacity refusal claims no retention; durable records/holders remain unchanged. |
| Graph and memory WEBUI-APPS-R031.5 | `src/__tests__/memory-files-state.test.tsx::test_each_sync_state_has_label` | Sync state labels. |
| Graph and memory WEBUI-APPS-R031.6 | `src/__tests__/memory-files-evidence.test.tsx::test_save_evidence_respects_outcome_authority` (planned) | Authorized verdict/digests appear; refused entries reveal no cached head metadata. A successful save alone never shows in_sync. |
| Graph and memory WEBUI-APPS-R031.7 | `e2e/memory-files-served.spec.ts::file_conflict_preserves_both_versions; e2e/memory-files-served.spec.ts::stale_materialization_ack_never_shows_in_sync` (planned) | Two real clients compete, restart, read both durable conflict versions and resolve against current head. Delay a host acknowledgment, observe a newer edit without changing head, deliver old acknowledgment and prove no in_sync. Correct authenticated acknowledgment establishes served in_sync only without pending edits/conflicts. Browser observation/ack attempts refuse; absent evidence shows unavailable. No mocked transport, dispatch, authority or persistence. |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, `uv run --all-extras pytest agent/agent_webui/__tests__`, and `pre-commit run --config .config/pre-commit.yaml --all-files`. Hosted CI provisions browser and API fixtures; no live deployment is required to accept an external PR. CCCC staged threshold is no new function above cyclomatic 10/cognitive 15 and no regression. Run configured jscpd and Dupehound if installed; do not claim an unconfigured threshold passed. KISS rejects duplicate route/app/renderer registries. Record package, Pages and browser artifact digests with exact commit in `tasks.md`.
| WEBUI-APPS-R005.1 | src/lib/__tests__/nav-registry.test.ts | Nav entry declares a minimum role. |
| WEBUI-APPS-R005.1.1 | src/lib/__tests__/nav-registry.test.ts | Registry role contract. |
| WEBUI-APPS-R005.1.2 | Planned rendered sidebar and route-shell acceptance | Rendered role filtering. |
| WEBUI-APPS-R005.2 | src/components/views/__tests__/DashboardView.test.tsx | Layout saved per user. |
| WEBUI-APPS-R005.3 | src/components/views/__tests__/DashboardConnectorTiles.test.tsx | Mount Operate through the browser adapter with HTTP fixtures. Check tiles without tools, reported state, zero/absent counters, filter and selection. Check loading, empty and refused refresh. Assert no connector data in browser storage. This is partial source presentation evidence. Complete catalog membership, connection state and live-provider acceptance remain open. |
| WEBUI-APPS-R005.4 | src/components/__tests__/chat-session-sync.test.tsx | One chat session list. |
| WEBUI-APPS-R005.5 | src/__tests__/routes/route-render.hostile.test.tsx | Every route renders. |
| WEBUI-APPS-R005.5.1 | src/__tests__/routes/route-render.hostile.test.tsx | Census detects a throwing view. |
| WEBUI-APPS-R005.5.2 | Planned complete route census without known-failure exemptions | Complete route render acceptance. |
| WEBUI-APPS-R005.6 | src/lib/__tests__/nav-registry.test.ts | Each view states its purpose. |
| WEBUI-APPS-R005.6.1 | src/lib/__tests__/nav-registry.test.ts | Registry purpose copy. |
| WEBUI-APPS-R005.6.2 | Planned rendered shell and own-heading purpose acceptance | Rendered purpose visibility. |
| WEBUI-APPS-R006.1 | src/lib/__tests__/goal-link.test.ts | Link type. |
| WEBUI-APPS-R006.2 | src/components/views/__tests__/GoalPanel.test.tsx | Panel reads typed operations. |
| WEBUI-APPS-R006.3 | src/components/views/__tests__/GoalPanel.test.tsx | Absent operation is honest. |

The R030/R031 test paths above are planned acceptance contracts. These tests have not run.
Component tests cannot substitute for the served R030.7/R031.7 journeys. When those journeys are built, record WebUI, Arbora and EG revisions.
Record installed operation IDs, schema digests and fixture principals.
Include durable readbacks from before and after each change.
R031.7 cannot pass until the R085/R024.4 definitions in plan.md are implemented, generated, registered and served. Record independent durable readbacks, hosted artifacts and observation/ack identities at the exact tested revisions. Source/spec merges alone are not receipts.

<!-- spec-definition-patch:consumer-definitions-20261012 -->
## Planned served consumer acceptance

These cases require the real browser route, WebUI host, registered Arbora operation and actual owner implementation with disposable durable storage. No mocked transport, policy, persistence or fabricated receipt establishes acceptance. Record exact component revisions, generated schema digests, fixture identities and independent durable readback.

| Requirement | Planned test | Positive and negative acceptance |
|---|---|---|
| `WEBUI-APPS-R004.7.1` | `e2e/evolution-evidence-served.spec.ts::test_model` (planned) | Use generated proposal identity, prompt revision, agent identity, progress state and source RunTrace references. Keep measured run metrics separate from decision calibration and coverage. |
| `WEBUI-APPS-R004.7.2` | `e2e/evolution-evidence-served.spec.ts::test_behavior` (planned) | Show each optimization proposal beside its exact source runs and recorded progress. Preserve pending review and propose-only state. Never promote a prompt from this view. |
| `WEBUI-APPS-R004.7.3` | `e2e/evolution-evidence-served.spec.ts::test_wiring` (planned) | Extend src/components/views/ObservabilityView.tsx beside the existing run DAG. Resolve proposal and trace references through typed Arbora reads. The existing runs.get and runs.metrics operations alone do not return the missing join. |
| `WEBUI-APPS-R004.7.4` | `e2e/evolution-evidence-served.spec.ts::test_refusal` (planned) | Missing proposal provenance, hidden traces or incompatible producer revisions show unavailable. Never infer progress from trace count or substitute WEBUI-DECIDE-R001 coverage. |
| `WEBUI-APPS-R004.7.5` | `e2e/evolution-evidence-served.spec.ts::test_evidence` (planned) | Bind the shown proposal revision, run IDs, trace digests, metric window and producer schema revision. Label incomplete source sets. |
| `WEBUI-APPS-R004.7.6` | `e2e/evolution-evidence-served.spec.ts::test_served_acceptance` (planned) | A real served proposal must lead from the dashboard to its authorized stored traces and measured outcomes. Denied traces must reveal no metrics or proposal progress. |
| `WEBUI-APPS-R006.4.1` | `e2e/unified-harness-sessions-served.spec.ts::test_model` (planned) | Consume the versioned host supported-harness manifest and discovery status for every manifest entry. Session identity includes source harness, source session ID, tenant and authoritative indexed revision. |
| `WEBUI-APPS-R006.4.2` | `e2e/unified-harness-sessions-served.spec.ts::test_behavior` (planned) | On first use, show discovery and synchronization for every declared supported harness. Browse and search the unified authorized index with cross-session cost summaries. |
| `WEBUI-APPS-R006.4.3` | `e2e/unified-harness-sessions-served.spec.ts::test_wiring` (planned) | Extend src/components/views/SessionsView.tsx and the R006 panel through the generated client. SDK discovers and syncs sources; EG owns indexes; Arbora serves bounded search and discovery progress. |
| `WEBUI-APPS-R006.4.4` | `e2e/unified-harness-sessions-served.spec.ts::test_refusal` (planned) | Unsupported harnesses, denied sources and partial synchronization remain individually visible. Never claim complete discovery from one source or replace missing costs with zero. |
| `WEBUI-APPS-R006.4.5` | `e2e/unified-harness-sessions-served.spec.ts::test_evidence` (planned) | Keep source coverage, sync cursor, index revision, query window, cost units and partial-result flags with every result page. Do not create a browser metric or session index. |
| `WEBUI-APPS-R006.4.6` | `e2e/unified-harness-sessions-served.spec.ts::test_served_acceptance` (planned) | From a fresh browser, exercise every supported harness in the versioned owner manifest and search sessions without duplicate identities. Include at least two harnesses when the manifest contains two or more. Two examples alone do not prove manifest-wide coverage. Deny one source and prove visible partial coverage and no hidden-session disclosure. |
| `WEBUI-APPS-R004.8.1` | `e2e/indexed-usage-analysis-served.spec.ts::test_model` (planned) | Consume generated model, project and agent identities, input/output token counts and total usage cost. Preserve owner-defined cached/reasoning categories, accounting units and missing-value semantics. |
| `WEBUI-APPS-R004.8.2` | `e2e/indexed-usage-analysis-served.spec.ts::test_behavior` (planned) | Filter indexed history by model, project, agent and time window. Show producer aggregates and pagination. Label cost per solved task separately from total usage and context peak/budget. |
| `WEBUI-APPS-R004.8.3` | `e2e/indexed-usage-analysis-served.spec.ts::test_wiring` (planned) | Extend src/components/views/ObservabilityView.tsx using the canonical operation adapter. EG returns indexed accounting and groups; Arbora serves the generated projection. Reuse existing model/task-class metrics. |
| `WEBUI-APPS-R004.8.4` | `e2e/indexed-usage-analysis-served.spec.ts::test_refusal` (planned) | Unknown project/agent attribution, incomplete token accounting and zero-solved abstention remain explicit. Missing, nonpositive or nonfinite owner latency limits make bounded analysis unavailable. Never total overlapping token categories or manufacture project costs in JavaScript. |
| `WEBUI-APPS-R004.8.5` | `e2e/indexed-usage-analysis-served.spec.ts::test_evidence` (planned) | Retain aggregate definition, currency, accounting version, observation interval, source coverage and index watermark. Bind measured latency to an owner-published positive finite limit, units, measurement boundary, dataset size and contract revision. |
| `WEBUI-APPS-R004.8.6` | `e2e/indexed-usage-analysis-served.spec.ts::test_served_acceptance` (planned) | Serve indexed model/project/agent queries over the owner-declared dataset and check independent stored accounting totals. Compare measured latency with the revision-bound positive finite owner limit. Test incomplete attribution, denied scope and absent, invalid or exceeded limits. |
| `WEBUI-APPS-R030.8.1` | `e2e/live-graph-convergence-served.spec.ts::test_model` (planned) | Consume authorized snapshot identity and ordered change events with graph incarnation, revision, cursor and event identity. A tombstone remains distinct from an inaccessible entity. |
| `WEBUI-APPS-R030.8.2` | `e2e/live-graph-convergence-served.spec.ts::test_behavior` (planned) | Apply committed changes to other connected clients without page refresh. Preserve selected nodes, camera and stable layout anchors during concurrent edits. |
| `WEBUI-APPS-R030.8.3` | `e2e/live-graph-convergence-served.spec.ts::test_wiring` (planned) | Attach the host subscription to src/components/views/GraphView.tsx and GraphCanvas. Use the existing host event transport with its generated contract; snapshot reads remain typed Arbora operations. |
| `WEBUI-APPS-R030.8.4` | `e2e/live-graph-convergence-served.spec.ts::test_refusal` (planned) | Deduplicate events and reject revision regressions. A gap or expired cursor requires an authorized fresh snapshot. Missing, nonpositive or nonfinite latency/layout bounds make bounded live mode unavailable. Revocation clears protected graph state and stops the subscription. |
| `WEBUI-APPS-R030.8.5` | `e2e/live-graph-convergence-served.spec.ts::test_evidence` (planned) | Retain snapshot and event revisions and measure commit-to-visible latency. Bind latency and layout measurements to owner-published positive finite limits, metric definitions, units, workload and contract revision. Layout metrics must cover readability and frame timing; retain selection continuity evidence. |
| `WEBUI-APPS-R030.8.6` | `e2e/live-graph-convergence-served.spec.ts::test_served_acceptance` (planned) | Two real browsers edit concurrently and converge before refresh within the owner latency limit. Compare layout measurements against owner limits under the declared workload. Test missing, invalid and exceeded bounds. Exercise duplicated, delayed and reordered events, reconnect and revocation; compare both views with independent durable readback. |
| `WEBUI-APPS-R001.1.1` | `e2e/retrieval-quality-comparison-served.spec.ts::test_model` (planned) | Consume EG evaluation identity, corpus revision, relevance-label revision, algorithm version, k, hits-at-k and context-span offsets. Keep result ranking separate from relevance labels. |
| `WEBUI-APPS-R001.1.2` | `e2e/retrieval-quality-comparison-served.spec.ts::test_behavior` (planned) | Compare algorithms side by side for the same evaluation input. Show hits-at-k, safe n-gram highlights and context search with source references. |
| `WEBUI-APPS-R001.1.3` | `e2e/retrieval-quality-comparison-served.spec.ts::test_wiring` (planned) | Extend src/components/table-explorer/TryItPanel.tsx through typed Arbora evaluation reads. Its current SQL search legs and local rrfFuse do not establish authoritative evaluation metrics. |
| `WEBUI-APPS-R001.1.4` | `e2e/retrieval-quality-comparison-served.spec.ts::test_refusal` (planned) | Missing labels, incompatible corpus revisions, invalid offsets and denied context show unavailable. Never compute quality from rank alone or treat local fusion as an EG retrieval decision. |
| `WEBUI-APPS-R001.1.5` | `e2e/retrieval-quality-comparison-served.spec.ts::test_evidence` (planned) | Show numerator, denominator, k, corpus/label revisions, algorithm settings and query identity. Escape source text before highlighting and bound returned context spans. |
| `WEBUI-APPS-R001.1.6` | `e2e/retrieval-quality-comparison-served.spec.ts::test_served_acceptance` (planned) | A real served fixed corpus and labels must produce independently checked hits-at-k for two algorithms. Test unlabeled data, cross-revision comparison and hostile highlight text without fake metrics. |
| `WEBUI-APPS-R001.2.1` | `e2e/bounded-large-data-charts-served.spec.ts::test_model` (planned) | Consume EG viewport bounds, pixel dimensions, bin revision, source cardinality, count/extrema and selection references. Scatter bins and line continuity have distinct generated result variants. |
| `WEBUI-APPS-R001.2.2` | `e2e/bounded-large-data-charts-served.spec.ts::test_behavior` (planned) | Pan, zoom and select scatter and line data with at least one billion source points. Render screen-bounded results, preserving gaps and producer-defined selection semantics. |
| `WEBUI-APPS-R001.2.3` | `e2e/bounded-large-data-charts-served.spec.ts::test_wiring` (planned) | Extend the existing shared Atlas chart renderer used by finance. Send viewport queries through typed Arbora reads; EG performs binning and selection against its indexed source. |
| `WEBUI-APPS-R001.2.4` | `e2e/bounded-large-data-charts-served.spec.ts::test_refusal` (planned) | Reject stale viewport replies and invalid selection tokens. Refuse rendering when owner bin/byte limits or viewport dimensions are absent, nonpositive, nonfinite or schema-invalid. Never download the complete source, interpolate across declared gaps or report exact point selection from a bin summary. |
| `WEBUI-APPS-R001.2.5` | `e2e/bounded-large-data-charts-served.spec.ts::test_evidence` (planned) | Enforce owner-published positive finite bin-count and response-byte limits before rendering. Their versioned formulas must bind viewport dimensions and chart variant, independently of total source cardinality. Count limits use integers. Record formula revision, viewport dimensions, source cardinality, bins and bytes. |
| `WEBUI-APPS-R001.2.6` | `e2e/bounded-large-data-charts-served.spec.ts::test_served_acceptance` (planned) | Serve a real indexed source of at least one billion points. Pan, zoom and select both chart variants. Measure bins and bytes against the owner viewport formulas and limits. Test absent, zero, negative, nonfinite and exceeded limits, stale responses and denied selections. |
| `WEBUI-APPS-R001.3.1` | `e2e/column-vector-controls-served.spec.ts::test_model` (planned) | Consume stable table/column IDs, schema revision, ColumnVectorBinding, embedder identity/dimension and versioned index statistics. Advice and binding state remain distinct. |
| `WEBUI-APPS-R001.3.2` | `e2e/column-vector-controls-served.spec.ts::test_behavior` (planned) | Offer explicit per-column bind/unbind controls and show index readiness, indexed-row count and owner-reported size/freshness. Read the authoritative binding after each accepted mutation. |
| `WEBUI-APPS-R001.3.3` | `e2e/column-vector-controls-served.spec.ts::test_wiring` (planned) | Extend src/components/views/TableExplorerView.tsx and src/components/table-explorer/SchemaTree.tsx. Use generated Arbora list, stats and mutation bindings to existing EG column operations. |
| `WEBUI-APPS-R001.3.4` | `e2e/column-vector-controls-served.spec.ts::test_refusal` (planned) | Deny unauthorized mutations before effects. Stale schema, unsupported type or unavailable embedder leaves the binding unchanged. Advice must never activate a toggle automatically. |
| `WEBUI-APPS-R001.3.5` | `e2e/column-vector-controls-served.spec.ts::test_evidence` (planned) | Bind mutation verdict and readback to column ID, schema revision, embedder and index generation. Missing statistics remain unavailable, never fabricated zeros. |
| `WEBUI-APPS-R001.3.6` | `e2e/column-vector-controls-served.spec.ts::test_served_acceptance` (planned) | Use an authenticated browser to bind a text column and read actual index statistics through Arbora and EG. Deny a writer and submit a stale schema; prove unchanged bindings and no embedding effects. |
| `WEBUI-APPS-R001.4.1` | `e2e/remote-editor-compatibility-served.spec.ts::test_model` (planned) | Consume a versioned host compatibility manifest naming editor protocol, extension IDs/versions, supported capabilities and keybinding profiles. Keep remote workspace identity scoped to the session. |
| `WEBUI-APPS-R001.4.2` | `e2e/remote-editor-compatibility-served.spec.ts::test_behavior` (planned) | Expose supported extension installation/use and keyboard shortcuts within the existing embedded workbench. Resolve shortcut focus between shell and editor without silently swallowing commands. |
| `WEBUI-APPS-R001.4.3` | `e2e/remote-editor-compatibility-served.spec.ts::test_wiring` (planned) | Reuse src/components/views/WorkspaceIDEView.tsx at /ide and its editor-context bridge. Arbora owns workbench hosting and extension admission; the browser must not install a second editor. |
| `WEBUI-APPS-R001.4.4` | `e2e/remote-editor-compatibility-served.spec.ts::test_refusal` (planned) | Unsupported extensions, incompatible versions and denied workspace access show explicit refusals. Untrusted workspaces cannot gain host privileges or access another workspace through the bridge. |
| `WEBUI-APPS-R001.4.5` | `e2e/remote-editor-compatibility-served.spec.ts::test_evidence` (planned) | Record workbench and manifest versions, extension verdicts, keybinding profile and workspace revision. Keep service credentials out of frame messages and browser state. |
| `WEBUI-APPS-R001.4.6` | `e2e/remote-editor-compatibility-served.spec.ts::test_served_acceptance` (planned) | Open an authenticated remote workspace and exercise one declared extension and shortcut in a real browser. Test incompatible extensions, reserved shortcut focus and cross-workspace access denial. |
| `WEBUI-APPS-R001.5.1` | `e2e/meeting-transcripts-and-summaries-served.spec.ts::test_model` (planned) | Consume meeting ID, segment ID, sequence, correction revision, timestamps and finalization state. Summary requests bind final transcript revision, admitted provider identity and local/hosted execution class. |
| `WEBUI-APPS-R001.5.2` | `e2e/meeting-transcripts-and-summaries-served.spec.ts::test_behavior` (planned) | Show live partial/final segments and ordered corrections. After meeting finalization, let the user select an available local or hosted summary provider and request a summary. |
| `WEBUI-APPS-R001.5.3` | `e2e/meeting-transcripts-and-summaries-served.spec.ts::test_wiring` (planned) | Add the meeting consumer through existing AppSurface and host transport. SDK owns live transcription/provider transport; EG owns context and summary admission; Arbora serves their generated contracts. |
| `WEBUI-APPS-R001.5.4` | `e2e/meeting-transcripts-and-summaries-served.spec.ts::test_refusal` (planned) | Keep src/hooks/useVoiceDictation.ts single-shot behavior honest. Denied capture, missing streams, sequence gaps or absent providers remain distinct. Never silently move a local-provider request to a hosted service. |
| `WEBUI-APPS-R001.5.5` | `e2e/meeting-transcripts-and-summaries-served.spec.ts::test_evidence` (planned) | Bind summary content and citations to final transcript revision, provider/model revision and admitted execution receipt. Corrections invalidate stale summaries visibly. |
| `WEBUI-APPS-R001.5.6` | `e2e/meeting-transcripts-and-summaries-served.spec.ts::test_served_acceptance` (planned) | In a real browser, receive segments and corrections, finalize, then select local and hosted providers separately. Check actual provider routing and summary provenance. Denied egress and stale transcript requests produce no summary effects. |
| `WEBUI-APPS-R001.6.1` | `e2e/bookmark-knowledge-views-served.spec.ts::test_model` (planned) | Consume bookmark/source IDs, ingestion provenance, semantic-index revision, authorized relationships and bounded export schema. Reuse the existing SDK bookmark envelopes and extraction vocabulary. |
| `WEBUI-APPS-R001.6.2` | `e2e/bookmark-knowledge-views-served.spec.ts::test_behavior` (planned) | Search and filter bookmarks by meaning; render their authorized relationships as an interactive mindmap. Offer CSV and JSON export for the selected authorized query snapshot. |
| `WEBUI-APPS-R001.6.3` | `e2e/bookmark-knowledge-views-served.spec.ts::test_wiring` (planned) | Use existing AppSurface, GraphView/GraphCanvas and generated Arbora reads/export delivery. EG owns semantic indexing and relationship decisions. Do not duplicate SDK offline ingestion in the browser. |
| `WEBUI-APPS-R001.6.4` | `e2e/bookmark-knowledge-views-served.spec.ts::test_refusal` (planned) | Denied nodes, stale cursors and unavailable semantic indexes reveal no hidden counts or relationships. Never fetch embedded URLs or run imported instructions. Exports must not widen the selected scope. |
| `WEBUI-APPS-R001.6.5` | `e2e/bookmark-knowledge-views-served.spec.ts::test_evidence` (planned) | Bind search, mindmap and exports to one query/snapshot revision, source provenance, format version and content digest. Preserve unknown metadata and escape CSV formula-like cells safely. |
| `WEBUI-APPS-R001.6.6` | `e2e/bookmark-knowledge-views-served.spec.ts::test_served_acceptance` (planned) | Import bookmarks through SDK R005.7–.12, then use real browser semantic filtering, mindmap and CSV/JSON export. Independently compare stored records and downloaded bytes; deny one bookmark and prove exclusion everywhere. |
| `WEBUI-APPS-R001.7.1` | `e2e/sandboxed-design-artifacts-served.spec.ts::test_model` (planned) | Consume host-discovered executable identities and capabilities, EG-admitted skill sequence and immutable generated artifact references. Bind artifacts to execution, skill and source revisions. |
| `WEBUI-APPS-R001.7.2` | `e2e/sandboxed-design-artifacts-served.spec.ts::test_behavior` (planned) | Let the user select available coding-agent capabilities for a design flow and inspect skill-transformation progress. Render the resulting artifact only through the existing sandboxed frame. |
| `WEBUI-APPS-R001.7.3` | `e2e/sandboxed-design-artifacts-served.spec.ts::test_wiring` (planned) | Reuse src/components/mcp/McpAppFrame.tsx and McpAppHost.tsx. Arbora discovers PATH executables and hosts effects; EG selects composition; AU runs admitted skills. The browser never probes PATH or chooses policy. |
| `WEBUI-APPS-R001.7.4` | `e2e/sandboxed-design-artifacts-served.spec.ts::test_refusal` (planned) | Unavailable executables or refused transformations produce no success preview. Validate artifact digest, origin and message schema. Block parent DOM, credential access, popups and unauthorized network/navigation. |
| `WEBUI-APPS-R001.7.5` | `e2e/sandboxed-design-artifacts-served.spec.ts::test_evidence` (planned) | Show execution and transformation references with the rendered digest. Preserve producer refusal and cancellation; frame rendering alone is not proof of a completed transformation. |
| `WEBUI-APPS-R001.7.6` | `e2e/sandboxed-design-artifacts-served.spec.ts::test_served_acceptance` (planned) | Serve an admitted design flow through actual host discovery and execution to the sandbox frame. Compare the artifact digest with durable provenance; test substituted artifacts and hostile scripts without parent or network escape. |
| `WEBUI-APPS-R001.8.1` | `e2e/interactive-code-explanations-served.spec.ts::test_model` (planned) | Consume query/repository revision, ordered walkthrough steps, source spans, self-contained artifact manifest/digest and execution-note sequence references. Keep explanation notes distinct from private model reasoning. |
| `WEBUI-APPS-R001.8.2` | `e2e/interactive-code-explanations-served.spec.ts::test_behavior` (planned) | Show a linear source-linked walkthrough and interactive explanation artifact for the same query output. Show ordered graph-persisted execution notes with provenance links. |
| `WEBUI-APPS-R001.8.3` | `e2e/interactive-code-explanations-served.spec.ts::test_wiring` (planned) | Reuse existing code navigation and the R001.7 frame boundary. Arbora serves generated explanation output and note subscriptions; EG owns source and provenance identity; AU emits admitted execution notes. |
| `WEBUI-APPS-R001.8.4` | `e2e/interactive-code-explanations-served.spec.ts::test_refusal` (planned) | Missing source revisions, invalid manifests, stale notes and denied source spans show unavailable. Reject unmanifested external artifact dependencies; never synthesize a successful explanation from a generic span tree. |
| `WEBUI-APPS-R001.8.5` | `e2e/interactive-code-explanations-served.spec.ts::test_evidence` (planned) | Bind walkthrough, artifact bytes and note stream to one query and repository revision. Label disconnected streams and retain sequence/correction identities without exposing hidden source content. |
| `WEBUI-APPS-R001.8.6` | `e2e/interactive-code-explanations-served.spec.ts::test_served_acceptance` (planned) | From a real served code query, inspect source-linked steps and load the artifact with external network blocked. Independently read graph notes and compare artifact bytes; reject wrong-revision outputs and unauthorized source links. |
<!-- /spec-definition-patch -->

## Responsive workspace acceptance matrix

The following are planned tests, not existing receipts. Test every registered static destination and representative authorized/denied dynamic leaves, including nested leaves deeper than three levels. Generate action cases from the shared census rather than hand-picking top-level pages.

| Requirement | Required proof |
|---|---|
| WEBUI-APPS-R045 | Registry completeness, orphan/duplicate IDs, dynamic detail fixtures and new-route/action omission tests. |
| WEBUI-APPS-R046 | All-leaf reachability through keyboard, touch, direct URL, search and WebMCP; repeated Back/Forward and shared-entity path tests. |
| WEBUI-APPS-R047 | Parameterized manual/keyboard/tool equivalence for every inventoried action; same state, validation, permission, confirmation and outcome, including denial/cancellation. |
| WEBUI-APPS-R048 | Native supported-browser registration/execution plus unsupported fallback; stale generation, hidden-page retirement, replay, revocation, cross-origin and cancellation adversarial tests. |
| WEBUI-APPS-R049 | Before/after feature and action census parity, deep-link compatibility, storage/consent migration regression and branding snapshots. |
| WEBUI-APPS-R050 | Installed-host browser journeys against real Arbora. Include unavailable-provider cases, authenticated tenant isolation, permitted no-auth tests and shared contract parity receipts. |

Run each relevant journey with loading, empty, stale, denied, unavailable, validation error, success and in-flight cancellation fixtures. Use synthetic tenant data. No auth tokens, private reasoning, real account data or secrets may appear in screenshots, tool results or logs. Existing source and security gates remain mandatory.

## Registered navigation source evidence

R046.1 binds `src/lib/__tests__/workspace-navigation.test.tsx` and `src/components/__tests__/WorkspaceNavigation.test.tsx`. Test same-origin, registered-route and role refusal. Preserve native modified-click behavior, query state and disclosure focus. Synthetic popstate checks cover source subscription only.

R046.2 requires the complete parent all-leaf and real browser matrix. Validate dynamic entities, shared paths, semantic zoom, Back/Forward, selection and focus at supported mobile and desktop viewports. These cases remain planned. Full R047 action parity and R050 installed-provider acceptance remain separate and open.

## Three-context redesign acceptance

WEBUI-APPS-R049.1: List the baseline migration matrix and all dynamic leaf fixtures. Assert one context/entity/lens state per destination. Exercise legacy URLs, direct search, Back/Forward and entity relationship traversal. Check the same actions, error states and role/capability refusals. Fail if an old alias mounts a separate feature-page layout. Required legal pages are explicit exceptions, not hidden app contexts.

WEBUI-APPS-R049.2: Run identical baseline and redesigned tasks from recorded starting states. Capture primary-context count, navigation activations and viewport-height scrolling distance. Targets are exactly three primary app contexts and at most three activations from context root to task surface. Exclude typing, policy confirmations and task execution. Do not exclude required navigation or hide controls to satisfy the count. Record bounded-data fixture size and internal data-region scroll separately. Show a reduction against baseline for representative journeys; report unchanged or worse results explicitly.

Test run inspection, related-object exploration, workflow editing, provider configuration and dashboard editing. Repeat on narrow/tall, short/landscape, wide and changing viewports, with keyboard, touch and native tools. Compare manual and WebMCP state transitions. Keep context, current selection and primary actions visible during content scrolling. Check all content remains reachable. Source-only navigation tests or fresh branding cannot qualify these rows.

Do not require visual parity with discarded page layouts. Reuse backend, security, typed action and data tests. Rewrite layout tests for the consolidated workspace. Legacy URL tests cover compatible state and authority, not retained page composition. Existing mobile corrections supply reusable failure cases, not a visual target.

## Retained Explore source and residual qualification

WEBUI-APPS-R049.1.1 uses `ExploreWorkspace.test.tsx` in the workspace component tests. Test retained query/results through entity and relationship/history navigation. Test manual/WebMCP typed selection and malformed destination refusal. Check bounded published context without truncating input. Check resolving identity, insufficient role, missing entity and retryable query failures. Include entity-ID round trips and reject unauthorized history writes.

WEBUI-APPS-R049.1.2 requires the full migration matrix against the installed workspace. Test real Back/Forward, focus restoration, keyboard/touch, resize continuity and native browser tool registration. Check real authorized provider responses independently. Keep source fixtures, rendered fixture evidence and live producer receipts distinct. No source test marker may close the broader migration or measured redesign rows.

Additional R049.1.1 source regressions cover remount and query restoration through typed `q` state. Compare manual, native and modified-click links without losing the collection. `ExploreShell.test.tsx` checks that Explore mounts no hidden dashboard. It also checks normal shell placement of attended controls during denied and loading states. The real WebMCP `provider.test.tsx` checks canonical route context and bounded query publication separately from the full execution query. These source tests do not qualify native browser lifecycle, consent acceptance or full mobile parity. Keep those broader requirements open.

## Work source qualification boundary

WEBUI-APPS-R049.1.3 binds `WorkWorkspace.test.tsx`, `useConversationIdFromUrl.workspace.test.tsx` and shared shell/context-rail tests. Check conversation selection with exactly one existing Chat instance. Test independent served task list/get and trace/node adapters. Test typed URL/tool/manual navigation, anchored context controls and retained selection. Cover loading, denial, missing data and malformed state without fabricated links. Assert that trace spans do not become subagent records. No test may infer conversation/task/trace/evidence associations from fixture naming alone.

These source tests do not qualify real provider associations, native browser lifecycle or full mobile acceptance. They add no execution or cancel action. Keep R049.1.2 open for the complete capability matrix and installed-stack evidence.

### Retained Operate discovery source

WEBUI-APPS-R049.1.4 binds `OperateWorkspace.test.tsx` and `operate-workspace.test.ts`. Check fleet-to-child-to-capability navigation without mounting legacy operational pages. Test strict links, manual/tool parity and capability-to-server membership. Check that filtering keeps input focus. Reject invalid destinations and unsigned identities before reads. Decode actual gateway envelopes and discard unapproved payload fields. Test failed refresh, retained tool handles, same-principal observed credential/scope changes, repeated cursors and short tenth pages. No effectful operation is exposed.

Keep R049.1.2 and R050 open. Existing identity observation does not detect unseen live revocation. The shared transport requires a supported authenticated browser session. This source does not deliver anonymous discovery or real issuer revocation. Installed-provider acceptance, full catalog search and native browser WebMCP qualification remain open.

### Current response task link

WEBUI-APPS-R049.1.5 binds `CurrentResponseTaskLink.test.tsx` and `Chat.conversation-identity.test.tsx`. Compare native hrefs, manual navigation and the registered tool destination. Reject pending, failed, mismatched and malformed responses. Retire handles on response replacement or component unmount. Do not fall back to an older response. SDK ready is not a completion receipt. Explicit metadata may identify an interrupted task without asserting its outcome. Preserve modified-link behavior and backend authorization. Actual task retrieval, installed providers and live identity remain separate acceptance gates.

The `workspace-layout.spec.ts` fixture checks task-link geometry at 740 by 320 and 320 by 740. Scroll and resize before pointer navigation. Check the link center against `elementFromPoint`, positive transcript height and a full touch target. Keep the composer in normal flow. This fixture uses synthetic API responses, not live identity or execution acceptance.

### Bounded workspace command search

WEBUI-APPS-R049.1.6 binds `WorkspaceCommands.test.tsx`. Check migrated roots and loaded Explore entries without backend calls. Test typed manual/tool equivalence, native modified links, denied roles, arbitrary path rejection and stale handles. Check owner changes, location changes, keyboard opening and explicit dismissal. Tool catalog results omit URL query text. Real browser focus restoration, touch targets, resizing and native provider registration require separate acceptance.

## Consent lifecycle regression boundary

R046.2.1 binds the consent banner and workspace navigation source tests. Check normal-flow placement, explicit dismissal, choices, management access and focus restoration. Dismissal must not grant optional consent. Test failed storage across route remounts and consumers. Unrelated session-storage events must not clear a failed-denial fallback or restore an old grant.

Current App branch inspection establishes the single-prompt property; a mounted App assertion remains planned. Source tests do not prove rendered browser geometry or real browser storage behavior.

R046.2.2 retains the complete R046.2 matrix. Test dynamic deepest leaves, shared paths, semantic zoom, real Back/Forward, selection and focus. Include keyboard, touch, mobile layouts and consent clearance on the exact installed candidate. These complete journeys remain planned.

### Integrated query and validation lenses

WEBUI-APPS-R049.1.7 binds `ExploreQueryWorkspace.test.tsx` and `explore-lens-state.test.ts`. Test draft retention across lenses, no navigation-triggered requests and owner retirement. Preserve modified links, collection search and evidence selection. Refuse malformed state and insufficient roles. Existing controller tests cover synchronous request ownership and stale replies. Real served provider behavior, actual browser history and native tool registration remain separate acceptance gates.

WEBUI-APPS-R049.1.8 binds `QueryEditorTools.test.tsx` and `ExploreQueryWorkspace.test.tsx`. Check that draft edits and review requests never call a provider. Reject script-dispatched confirmation with the production default. Use an explicit injected gesture only for accepted-path unit tests. Reject stale handles, changed drafts, duplicate review and oversized UTF-8 arguments. Check owner retirement and both provider callbacks. Actual browser pointer and keyboard acceptance remain separate. A trusted event is local interaction evidence, not backend authority.

WEBUI-APPS-R049.1.9 binds `LoadedWorkspaceCommands.test.tsx`. Check real mounted Work and Operate registrations, typed destinations, modified links and keyboard opening. Reject held handles after admission or loaded availability changes. Omit capabilities whose fleet parent is unconfirmed. Bound Work groups to 25 entries each and Operate groups to 50 each. Keep the whole catalog limit at 103 entries. Traces remain independent of conversation ownership. Nodes remain scoped to the selected trace. Real browser and provider checks remain separate.

WEBUI-APPS-R049.1.3 also binds WorkTaskControls.test.tsx and the Work API adapter tests. Check manual and semantic review, trusted confirmation, same-tick duplicate requests, failed requests, terminal tasks, selection changes and late completion. Check admission changes against cached task reads. Browser fixtures must use real pointer confirmation; mocked responses do not prove provider cancellation.

## R048 retained callback regression

`src/lib/webmcp/__tests__/navigation-lifecycle.test.tsx` exercises the real
document adapter, page navigation tool, shared dispatcher and rendered location
observer with a structural document API fixture. Refuse pending, failed and
retired registrations, including late acknowledgement after cleanup. Prove active
callbacks still navigate a registered object leaf and retain role, path and
execution-cancellation checks. A held callback after cleanup must not add history
or change rendered location. This is source integration evidence, not native
browser, actual Back/Forward, or served authority acceptance. R048 stays open.

## R048 hidden document registration tests

`src/lib/webmcp/__tests__/provider.test.tsx` uses a structural document API fixture.
Check initially hidden documents, visible-to-hidden cleanup, late acknowledgements, and fresh registrations on return.
Manual content stays mounted. Hidden documents expose no attended control.
Registration signals must abort when the document hides.
The fixture does not prove native browser support, real visibility scheduling, or full R048 acceptance.

## R048 execution lifetime matrix

`src/lib/webmcp/__tests__/execution-lifetime.test.tsx` exercises the mounted provider, document adapter and shared tool factory.
The structural document API fixture covers route, identity, visibility and unmount retirement during cooperative execution.
Check caller isolation, pre-cancelled refusal, listener cleanup and preservation of completed outcomes.
These tests supplement existing registration, navigation, validation, remote confirmation and cancellation suites.
They do not establish native-browser scheduling, backend cancellation, or authority for served effects.
R048 remains open until its native-browser and served authority acceptance passes.

### R048 native replacement routing

Chromium 156 experimental WebMCP resolved a retained native Tool reference to a new same-name registration. Each native registration now has a unique routing name; the application registry retains the semantic tool ID. This prevents stale native references from selecting replacement callbacks. The rendered route, Back/Forward, deep-link and restoration matrix uses native discovery with synthetic backend responses. Authenticated served authority acceptance remains open; R048 is not complete.

R005.3 additional source evidence: `src/components/views/__tests__/OperateCatalogPanel.test.tsx` exercises the real typed GET adapter.
It covers returned servers without fleet processes, registration labels and zero counts.
It checks field stripping, filtering, empty/refused reads, admission retirement and incompatible payload rejection.
Fixtures support this source coverage. It does not prove installed-provider or connection-state acceptance.


### R005.3 installed catalog qualification

The catalog path was exercised with installed Arbora 0.1.7 and this WebUI 2.8.0 source.
The isolated runtime used AU 3.1.0, EG 2.27.5 and SDK 0.2.2.
Synthetic readers supplied one registered server and one catalog-only server, both with zero tools.
Arbora's real `EnhancedCatalogAuthority` projected the response through its installed WebUI composer and HTTP route.
A temporary JWT verifier admitted the synthetic reader. A synthetic browser-session port supplied the browser identity.
No catalog response, HTTP transport or frontend module was mocked.
The HTTP response contained two servers with `available` and `unavailable` registration values.
Chromium exercised the built bundle: both tiles, registration labels, filtering, HTTP 503 withdrawal and recovery passed.
The panel showed no server URL. Browser storage held no catalog data, and no page error occurred.
This qualifies the installed catalog projection with synthetic authorities, not a durable registry or live identity provider.

Fresh deep-link loading remains blocked: the Operate deep link resolves relative bundle URLs under `workspace/assets/`, which returns HTTP 404.
The checked build configuration uses an empty Vite base.
The successful browser check loaded `/` first, then dispatched the existing client-side history event to mount Operate.
No shell or build configuration was changed in this feature lane. Direct entry and reload acceptance remain open.

The installed `enhanced_catalog_api._project_fleet_server` derives availability only from the presence of a live registration.
The separate `ChildRuntime.status()` reports MCP runtime state and session count through `Multiplexer.status_snapshot` and `fleet.status`.
`ChildRuntime.adopt_sessions` sets state to `up` when it receives connected MCP sessions.
Those values do not establish upstream-provider connectivity. R005.3 connection-state acceptance remains open.

Contextual catalog tests cover shared names with distinct identities, explicit connector joins, and tool versus skill details.
They cover unknown MCP runtime state, refresh retirement, duplicate identities and incompatible authority rejection.
The installed Arbora 0.1.7 journey was repeated with tool and skill definitions on both synthetic connectors.
The real projection returned distinct identities with shared names and explicit connector associations.
The built browser selected each definition, changed connectors, and retired the prior details.
Unknown runtime evidence remained explicit. HTTP 503 withdrawal and recovery passed without browser errors.
The journey retained the synthetic identity port and root-first navigation described above.
Provider connectivity, direct entry and full authentication acceptance remain open.
