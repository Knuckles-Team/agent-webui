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
| Graph and memory WEBUI-APPS-R030.7 | `e2e/graph-edit-served.spec.ts::overlay_edit_reaches_durable_engine` (planned) | Actual GraphOS operation and fixture engine; unauthorized durable graph unchanged, authorized mutation survives reload; no client/gateway/host-handler/engine-transport mocks. |
| Graph and memory WEBUI-APPS-R031.1 | `src/__tests__/memory-files-types.test.ts::test_memory_file_types_closed` | Memory file types. |
| Graph and memory WEBUI-APPS-R031.2 | `src/__tests__/memory-files-ops.test.ts::test_list_and_save_use_graphos_ops` | Memory file operations. |
| Graph and memory WEBUI-APPS-R031.3 | `src/__tests__/memory-files-wiring.test.tsx::test_files_tab_calls_list` | Files tab in the memory view. |
| Graph and memory WEBUI-APPS-R031.4 | `src/__tests__/memory-files-conflict.test.tsx::test_conflict_refused_with_both_versions` | Conflict refusal. |
| Graph and memory WEBUI-APPS-R031.5 | `src/__tests__/memory-files-state.test.tsx::test_each_sync_state_has_label` | Sync state labels. |
| Graph and memory WEBUI-APPS-R031.6 | `src/__tests__/memory-files-evidence.test.tsx::test_save_shows_hash_and_verdict` | Save evidence. |
| Graph and memory WEBUI-APPS-R031.7 | `e2e/memory-files-served.spec.ts::file_conflict_preserves_both_versions` (planned) | Actual owner-published file operation and fixture engine; both conflicting contents/hashes retained after reload and visible, accepted sync state read from the service; no client/gateway/host-handler/engine-transport mocks. |

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

R030/R031 test paths above are planned acceptance contracts, not executed tests.
Component tests cannot substitute for the served R030.7/R031.7 journeys. Record
WebUI, GraphOS and EG revisions, installed operation IDs/schema digests, fixture
principals and durable before/after readbacks when those journeys are built.
R031.7 cannot pass until the missing owner file contracts in plan.md are published.
