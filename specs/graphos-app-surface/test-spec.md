# GraphOS shell and app verification

| Case | Level/fixture | Pass |
|---|---|---|
| Product identity | Asset-generator check, metadata/route snapshots | All exposed names and generated hashes match |
| Package/consumer | Wheel, import and Graph OS consumer fixture | Canonical package imports; release assets included; no old runtime alias |
| Native app | Markets fixture + route/client/WebMCP/renderer tests | Single AppSurface registers all declared pieces |
| Contributed app | Valid descriptor and malformed/unauthorized descriptors | Valid app appears per capability; invalid entries fail closed without code loading |
| Old state and grants | Browser profile with prior consent/tool IDs | Re-consent required; old grant cannot invoke new tool |
| Direct denied URL | Two-principal browser fixture | No privileged component data or tool registration exposed |
| Mobile/desktop accessibility | Playwright keyboard/touch and reduced-motion fixture | Focus, nav labels, hit targets, contrast and error states pass |
| Public site | `mkdocs build --strict` and Pages artifact inspection | Links/assets resolve under published base path |
| Run surface WEBUI-APPS-R004.1 | `tests/x::test_run_read_uses_graphos_operations` | Run read goes through the graph-os read operations. |
| Run surface WEBUI-APPS-R004.2 | `tests/x::test_harness_config_shown` | Applied harness configuration is shown. |
| Run surface WEBUI-APPS-R004.3 | `tests/x::test_context_and_cost_shown` | Context use is shown against the budget. |
| Run surface WEBUI-APPS-R004.4 | `tests/x::test_plan_read_only` | Current plan is shown read-only. |
| Run surface WEBUI-APPS-R004.5 | `tests/x::test_termination_reasons_distinct` | Each termination reason has a distinct state. |
| Run surface WEBUI-APPS-R004.6 | `tests/x::test_absent_operation_not_available` | Absent operation shows an honest state. |
| Graph and memory WEBUI-APPS-R030.1 | `src/__tests__/graph-edit-types.test.ts::test_edit_types_closed` | Graph edit types. |
| Graph and memory WEBUI-APPS-R030.2 | `src/__tests__/graph-edit-send.test.ts::test_send_returns_engine_verdict` | Send edits to graph-os. |
| Graph and memory WEBUI-APPS-R030.3 | `src/__tests__/graph-edit-wiring.test.tsx::test_handlers_call_send_graph_edit` | Wire graph handlers to the engine. |
| Graph and memory WEBUI-APPS-R030.4 | `src/__tests__/graph-edit-refusal.test.tsx::test_unauthorized_edit_refused_and_unchanged` | Show refusals on unauthorized edits. |
| Graph and memory WEBUI-APPS-R030.5 | `src/__tests__/graph-persona-filter.test.tsx::test_persona_changes_presentation_only` | Semantic filters and persona modes. |
| Graph and memory WEBUI-APPS-R030.6 | `src/__tests__/graph-edit-log.test.tsx::test_log_records_each_verdict` | Edit log with verdicts. |
| Graph and memory WEBUI-APPS-R030.7 | `e2e/graph-edit-served.spec.ts::overlay_edit_reaches_durable_engine` (planned) | Use the actual GraphOS operation and fixture engine. Unauthorized edits leave the durable graph unchanged. Authorized mutations survive reload. Do not mock the client, gateway, host handler or engine transport. |
| Graph and memory WEBUI-APPS-R031.1 | `src/__tests__/memory-files-types.test.ts::test_memory_file_types_closed` | Memory file types. |
| Graph and memory WEBUI-APPS-R031.2 | `src/__tests__/memory-files-ops.test.ts::test_generated_operations_preserve_preconditions; e2e/memory-files-served.spec.ts::authorized_snapshots_and_cursor_refusal` (planned) | Authorized exact-revision content and stable metadata pages reach actual registered operations. Stale/cross-scope/expired cursors refuse without hidden metadata and require explicit restart. Exact preconditions/bytes/digests and retry identity survive the transport; changed-body replay refuses. |
| Graph and memory WEBUI-APPS-R031.3 | `src/__tests__/memory-files-wiring.test.tsx::test_files_tab_uses_canonical_invoke; e2e/memory-files-served.spec.ts::navigation_reaches_registered_memory_operations` (planned) | Navigation reaches Files, list/read/save use canonical invoke and real same-origin hosting. Missing registration/schema/host is not available. Late responses cannot replace another document or principal state; access loss clears protected content. |
| Graph and memory WEBUI-APPS-R031.4 | `src/__tests__/memory-files-conflict.test.tsx::test_authorized_conflict_and_head_free_refusal; e2e/memory-files-served.spec.ts::denied_reads_creates_and_replays_are_redacted` (planned) | Authorized stale submit retains both contents/digests across restart with unchanged accepted head. Denied existing/absent/create requests, cross-scope conflict reads and revoked replay disclose only error code/correlation. This applies to UI, errors and activity. Capacity refusal claims no retention; durable records/holders remain unchanged. |
| Graph and memory WEBUI-APPS-R031.5 | `src/__tests__/memory-files-state.test.tsx::test_each_sync_state_has_label` | Sync state labels. |
| Graph and memory WEBUI-APPS-R031.6 | `src/__tests__/memory-files-evidence.test.tsx::test_save_evidence_respects_outcome_authority` (planned) | Authorized verdict/digests appear; refused entries reveal no cached head metadata. A successful save alone never shows in_sync. |
| Graph and memory WEBUI-APPS-R031.7 | `e2e/memory-files-served.spec.ts::file_conflict_preserves_both_versions; e2e/memory-files-served.spec.ts::stale_materialization_ack_never_shows_in_sync` (planned) | Two real clients compete, restart, read both durable conflict versions and resolve against current head. Delay a host acknowledgment, observe a newer edit without changing head, deliver old acknowledgment and prove no in_sync. Correct authenticated acknowledgment establishes served in_sync only without pending edits/conflicts. Browser observation/ack attempts refuse; absent evidence shows unavailable. No mocked transport, dispatch, authority or persistence. |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, `uv run --all-extras pytest agent/agent_webui/__tests__`, and `pre-commit run --config .config/pre-commit.yaml --all-files`. Hosted CI provisions browser and API fixtures; no live deployment is required to accept an external PR. CCCC staged threshold is no new function above cyclomatic 10/cognitive 15 and no regression. Run configured jscpd and Dupehound if installed; do not claim an unconfigured threshold passed. KISS rejects duplicate route/app/renderer registries. Record package, Pages and browser artifact digests with exact commit in `tasks.md`.
| WEBUI-APPS-R005.1 | src/lib/__tests__/nav-registry.test.ts | Nav entry declares a minimum role. |
| WEBUI-APPS-R005.2 | src/components/views/__tests__/DashboardView.test.tsx | Layout saved per user. |
| WEBUI-APPS-R005.3 | src/components/views/__tests__/DashboardConnectorTiles.test.tsx | Connector tiles from the catalog. |
| WEBUI-APPS-R005.4 | src/components/__tests__/chat-session-sync.test.tsx | One chat session list. |
| WEBUI-APPS-R005.5 | src/lib/__tests__/route-render-census.test.tsx | Every route renders. |
| WEBUI-APPS-R005.6 | src/lib/__tests__/nav-registry.test.ts | Each view states its purpose. |
| WEBUI-APPS-R006.1 | src/lib/__tests__/goal-link.test.ts | Link type. |
| WEBUI-APPS-R006.2 | src/components/views/__tests__/GoalPanel.test.tsx | Panel reads typed operations. |
| WEBUI-APPS-R006.3 | src/components/views/__tests__/GoalPanel.test.tsx | Absent operation is honest. |

The R030/R031 test paths above are planned acceptance contracts. These tests have not run.
Component tests cannot substitute for the served R030.7/R031.7 journeys. When those journeys are built, record WebUI, GraphOS and EG revisions.
Record installed operation IDs, schema digests and fixture principals.
Include durable readbacks from before and after each change.
R031.7 cannot pass until the R085/R024.4 definitions in plan.md are implemented, generated, registered and served. Record independent durable readbacks, hosted artifacts and observation/ack identities at the exact tested revisions. Source/spec merges alone are not receipts.
