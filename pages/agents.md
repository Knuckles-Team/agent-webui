# Agents & Events

## Graph Activity Event Types

The `GraphActivity` component renders sideband events emitted by the agent orchestrator. Key event types:

| Event                                                         | Description                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `routing_started` / `routing_completed`                       | Domain routing analysis and result                                        |
| `plan_created`                                                | Execution plan generated with step count                                  |
| `step_dispatched` / `batch_dispatched`                        | Sequential or parallel specialist dispatch                                |
| `parallel_execution_started` / `parallel_execution_completed` | Fan-out/fan-in of parallel specialist execution                           |
| `specialist_enter` / `specialist_exit`                        | HSM entry/exit with duration tracking                                     |
| `expert-metadata`                                             | Specialist handshake and initialization                                   |
| `tools-bound`                                                 | Tool binding confirmation with count, toolset_count, dev_tools, mcp_tools |
| `subagent_tool_call` / `subagent_tool_completed`              | Individual tool execution within a specialist                             |
| `subagent_text`                                               | Streaming text delta from a specialist                                    |
| `subagent_completed`                                          | Specialist execution finished                                             |
| `expert-warning`                                              | Warning or degraded-mode notification (e.g. 0 tools bound)                |
| `verification_result`                                         | Quality gate score and feedback                                           |
| `replanning_started` / `replanning_completed`                 | Plan-level failure recovery                                               |
| `graph_force_terminated`                                      | Infinite-loop guard triggered                                             |

## Unified Specialist Discovery

The backend uses `discover_all_specialists()` to merge MCP agents and A2A peers into a single `DiscoveredSpecialist` roster during graph bootstrap. Both sources share the same registration and tag-prompt code path. The frontend does not need changes — it consumes the same sideband events regardless of specialist source.

## Tool-Count Telemetry

The `tools-bound` sideband event includes `toolset_count`, `dev_tools`, and `mcp_tools` breakdowns alongside the existing `count` and `tools` fields. `GraphActivity.tsx` can render these for richer tool-binding visibility.
