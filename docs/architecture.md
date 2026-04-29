# Architecture

## Protocol Flow

```
AG-UI: /api/chat  -> Vercel AI SDK useChat -> pydantic-ai agent -> graph (via tools)
ACP:   /acp/*     -> create_graph_acp_app() -> graph (via run_graph_flow tool)
SSE:   /stream    -> run_graph_stream() -> direct graph execution
```

## Key Component Map

| Component         | File                                         | Responsibility                                                                                            |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Chat              | `src/Chat.tsx`                               | Main chat interface with streaming, tool execution, graph activity, multi-modal input, approval workflows |
| GraphActivity     | `src/components/GraphActivity.tsx`           | Real-time graph execution timeline (routing, parallel execution, tool binding, expert reasoning)          |
| ApprovalCard      | `src/components/ApprovalCard.tsx`            | Human-in-the-loop tool approval for security-sensitive operations                                         |
| Part              | `src/Part.tsx`                               | Message part renderer (text, tool calls, elicitation forms, sources, images)                            |
| AppSidebar        | `src/components/app-sidebar.tsx`             | Navigation, conversation history, agent identity, view switching                                          |
| GraphView         | `src/components/views/GraphView.tsx`         | Interactive graph visualization with layouts, zoom/pan, node inspection, statistics                      |
| KnowledgeBaseView | `src/components/views/KnowledgeBaseView.tsx` | Knowledge base ingestion, article management, health checks, search                                      |
| MemoryView        | `src/components/views/MemoryView.tsx`        | Memory CRUD with timeline visualization, importance scoring, advanced search                             |
| SDDView           | `src/components/views/SDDView.tsx`          | Spec-driven development: constitution, specs, plans, tasks, memory synchronization                        |
| FilesView         | `src/components/views/FilesView.tsx`         | Workspace file browser                                                                                    |
| SkillsView        | `src/components/views/SkillsView.tsx`        | Universal skills viewer and configuration                                                                 |
| SchedulingView    | `src/components/views/SchedulingView.tsx`    | Cron task monitoring and management                                                                       |
| ConfigurationView | `src/components/views/ConfigurationView.tsx` | Agent and workspace configuration                                                                         |
| KnowledgeView     | `src/components/views/KnowledgeView.tsx`     | Knowledge base and embedding management (legacy)                                                          |
| ACP Client        | `src/lib/acp-client.ts`                      | ACP protocol client (session management, JSON-RPC, SSE event streaming)                                   |
| MCP Context       | `src/lib/mcp-context.tsx`                    | MCP tool context provider for the React tree                                                              |

## Backend Structure

| Module         | File                                  | Responsibility                                                                                                  |
| -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Server Factory | `agent/agent_webui/server.py`         | `create_agent_web_app()` — composes FastAPI app with Pydantic AI routes, enhanced APIs, and SPA static serving |
| API Extensions | `agent/agent_webui/api_extensions.py` | `/api/enhanced/*` routes for knowledge graph, KB, SDD, MAGMA, resources, and maintenance                    |
