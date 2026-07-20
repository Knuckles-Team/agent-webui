# Features

## Environment Variables (Frontend)

| Variable          | Default | Description                                 |
| ----------------- | ------- | ------------------------------------------- |
| `VITE_ENABLE_ACP` | `false` | Enable ACP protocol support alongside AG-UI |

## Recent Architecture Changes

- **Comprehensive API Extensions**: Added 20+ new API endpoints for knowledge graph CRUD, knowledge base management, SDD lifecycle, MAGMA views, resource management, and maintenance operations
- **Enhanced Frontend Components**: Created GraphView with interactive visualization, KnowledgeBaseView for KB management, MemoryView for memory management, and SDDView for spec-driven development
- **Testing Infrastructure**: Implemented comprehensive testing with Vitest (frontend), Pytest (backend), Playwright (E2E), and CI/CD pipeline with coverage reporting
- **Knowledge Graph Integration**: Full CRUD operations for memory nodes, article management, and MAGMA orthogonal views (semantic, temporal, causal, entity)
- **Backend Abstraction**: GraphBackend factory supporting LadybugDB (default), FalkorDB, and Neo4j for hot-swappable database backends
- **ACP protocol** now routes through the full HSM graph pipeline (not a flat agent) via `create_graph_acp_app()`
- **Graph Activity visualization** (`GraphActivity.tsx`) shows specialist routing decisions, parallel execution status, tool calls, and expert reasoning in a collapsible timeline
- Backend uses `create_agent_web_app()` in `agent/agent_webui/server.py` to compose Pydantic AI web routes with enhanced workspace APIs
- **Unified execution**: all protocols (AG-UI, ACP, SSE /stream) share the same graph engine via `graph/unified.py`
- **Human-in-the-loop approval** (`ApprovalCard.tsx`) intercepts security-sensitive tool calls before execution
- **Conversation persistence** merges localStorage entries with server-side records from `/api/enhanced/chats`
- **Model registry is backend-driven**: the hardcoded `MODEL_COST_TABLE` in `Chat.tsx` has been removed. Both the model picker and the per-session cost badge now consume `GET /api/enhanced/models` (which mirrors the `agent-utilities` core `GET /models`). Zero-cost models render as `$0.00` so token / tool counts remain visible for local / free deployments
- **Structured trace logger**: The backend emits structured log lines to `agent_utilities.graph.trace` for every graph event, enabling server-side prompt-flow tracing without the UI

## API Endpoint Summary

### Knowledge Graph APIs
- `GET /api/enhanced/graph/stats` - Graph statistics
- `GET /api/enhanced/graph/nodes` - List graph nodes
- `GET /api/enhanced/graph/relationships` - List relationships
- `POST /api/enhanced/graph/memory` - Create memory node
- `GET /api/enhanced/graph/memory/{id}` - Get memory node
- `PUT /api/enhanced/graph/memory/{id}` - Update memory node
- `DELETE /api/enhanced/graph/memory/{id}` - Delete memory node
- `POST /api/enhanced/graph/link` - Link nodes
- `GET /api/enhanced/graph/search` - Hybrid search
- `GET /api/enhanced/graph/impact/{symbol}` - Impact analysis
- `POST /api/enhanced/graph/query` - Execute Cypher query

### Knowledge Base APIs
- `POST /api/enhanced/kb/ingest` - Ingest knowledge base
- `GET /api/enhanced/kb/list` - List knowledge bases
- `GET /api/enhanced/kb/search` - Search knowledge base
- `GET /api/enhanced/kb/article/{id}` - Get article
- `POST /api/enhanced/kb/health` - Health check

### SDD Lifecycle APIs
- `GET /api/enhanced/sdd/constitution` - Get constitution
- `POST /api/enhanced/sdd/constitution` - Save constitution
- `GET /api/enhanced/sdd/specs` - List specifications
- `POST /api/enhanced/sdd/spec` - Create specification
- `GET /api/enhanced/sdd/plans` - List implementation plans
- `GET /api/enhanced/sdd/tasks` - Get tasks
- `POST /api/enhanced/sdd/sync` - Sync SDD to memory

### MAGMA View APIs
- `POST /api/enhanced/graph/magma` - Retrieve orthogonal context

### Resource Management APIs
- `GET /api/enhanced/resources` - List callable resources
- `POST /api/enhanced/resources/spawn` - Spawn specialized agent

### Maintenance APIs
- `GET /api/enhanced/maintenance/status` - Get maintenance status
- `POST /api/enhanced/maintenance/trigger` - Trigger maintenance operation

### Pipeline APIs
- `GET /api/enhanced/pipeline/status` - Get pipeline status
- `POST /api/enhanced/pipeline/trigger` - Trigger pipeline phase
