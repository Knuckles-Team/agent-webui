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
