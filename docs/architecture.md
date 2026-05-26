# Architecture

## Centralized Epistemic Gateway Topology

The `agent-webui` interfaces directly with a centralized system layer located inside `agent-utilities` (`agent-utilities-kg`). This gateway centralizes data access and tool registry control, ensuring absolute consistency across multi-agent workflows.

```mermaid
graph TD
    UI[React frontend] -->|Vercel AI SDK useChat| API_Chat[/api/chat]
    UI -->|Enhanced Admin Dashboard| API_Enhanced[/api/enhanced/*]

    subgraph WebUI_Backend ["WebUI Backend Server (agent-webui)"]
        API_Chat --> ChatAgent[Pydantic AI Chat Agent]
        API_Enhanced --> ProxyRouter[FastAPI Route Proxy]
    end

    subgraph Centralized_Gateway ["Centralized Epistemic Gateway (agent-utilities)"]
        ProxyRouter -->|JSON-RPC / SSE / HTTP| GatewayREST[REST APIs / Starlette Routes]
        GatewayREST -->|/tools & /tools/toggle| ToolsConfig[Unified Tool Listing & Toggling]
        GatewayREST -->|7 Symmetric Endpoints| GraphExecutor[Direct Tool Executor]

        ToolsConfig -->|Persist state| KG[IntelligenceGraphEngine]
        GraphExecutor -->|Query / Search / Write / Ingest / Analyze / Orchestrate / Configure| KG
    end

    subgraph Database ["Persistence Layer"]
        KG --> LadybugDB[LadybugDB Engine / FalkorDB]
    end
```

## REST Endpoints Overview

The centralized `agent-utilities-kg` server exposes two primary REST API namespaces to the proxy:

### 1. Unified Tools Registry (`/tools`, `/tools/toggle`)
- **GET `/tools`**: Returns a complete, consolidated catalog of all three tool layers (MCP Server tools, Native Pydantic AI tools, and Universal Skills/Workflows/Graphs).
- **POST `/tools/toggle`**: Toggles individual tool status and records preferences inside the graph as a `Preference` node, dynamically enabling or disabling them within the `IntelligenceGraphEngine`.

### 2. Symmetric Graph Tools (`/graph/*`)
Symmetrically maps the 7 main FastMCP tools to HTTP endpoints, enabling zero-wrapper REST execution of complex KG queries:
- **POST `/graph/query`**: Cypher console execution.
- **POST `/graph/search`**: Semantic, concept-based, analogy-based, or episodic search.
- **POST `/graph/write`**: Bulk write node and edge insertions.
- **POST `/graph/ingest`**: Codebase, document, or logs ingestion.
- **POST `/graph/analyze`**: Complex traversal, sweep, and evaluation algorithms.
- **POST `/graph/orchestrate`**: Multi-agent swarm dispatch and workflow compiles.
- **POST `/graph/configure`**: Secret configuration, tool registrations, hooks.

## Backend Component Mapping

| Component         | Responsibility                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Chat Server       | Composes the local FastAPI server with SPA static serving.                                               |
| Centralized Gateway | Manages the primary Ne04j/LadybugDB database connections, memory storage pools, and execution processes.  |
| API Extensions    | Intercepts dashboard routes and dynamically proxy-forwards them directly to the Epistemic Gateway.       |
