# Features

## Environment Variables (Frontend)

| Variable          | Default | Description                                 |
| ----------------- | ------- | ------------------------------------------- |
| `VITE_ENABLE_ACP` | `false` | Enable ACP protocol support alongside AG-UI |

## Environment Variables (Contact Delivery)

| Variable                             | Default | Description                                                                                                           |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `AGENT_WEBUI_CONTACT_DESTINATION`    | unset   | Fixed server-side destination passed only to the injected governed delivery adapter. Invalid values disable delivery. |
| `AGENT_WEBUI_CONTACT_RETENTION_DAYS` | unset   | Explicit PII retention decision from `0` (delivery only) through `3650`. Missing or invalid values disable delivery.  |

The host must also pass a `ContactDeliveryPort` implementation to
`create_agent_web_app(contact_delivery=...)`. An enabling implementation must
declare that it owns a durable atomic idempotency fence and a shared deployment
rate limit. No default provider is selected, and the browser cannot name a
provider, channel, destination, or retention period.

## Application capabilities

- **Workspace APIs** cover graph and knowledge-base exploration, SDD lifecycle,
  perspective views, resource management, and maintenance operations.
- **Knowledge views** include interactive graph, knowledge base, memory, schema,
  object, table, RDF, code, and temporal surfaces under Atlas.
- **ACP and AG-UI** share the composed agent runtime rather than creating a
  second browser-only execution path.
- **Graph activity** renders specialist routing, parallel execution, tool calls,
  and expert reasoning in a collapsible timeline.
- **Human approval** intercepts security-sensitive tool calls before execution.
- **Conversation persistence** combines per-user local presentation state with
  server-side chat records from `/api/enhanced/chats`.
- **Model discovery** reads the backend registry for the model picker and usage
  display, including zero-cost local models.
- **Structured traces** link browser requests to their downstream GraphOS and
  engine activity without exposing credentials to the frontend.

## API Endpoint Summary

### Contact API

- `POST /api/contact` - Submit bounded contact fields through the configured,
  host-injected governed delivery adapter. Authentication, exact same-origin
  checks, a client idempotency key, a server deadline, and local defense-in-depth
  throttling apply. The injected adapter must supply the shared abuse limit and
  atomic fence. Only a confirmed delivery with a valid durable contact receipt
  returns that opaque receipt.

### Knowledge Graph APIs

- `GET /api/enhanced/graph/stats` - Graph totals (node/relationship counts)
- `GET /api/enhanced/graph/node-types` - Real node-type distribution (engine-side `GROUP BY`; a separate route because it is far more expensive than the totals)
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
