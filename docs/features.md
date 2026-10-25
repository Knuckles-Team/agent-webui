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
- **Public activity components** render supported summary and tool parts when
  a provider supplies them. The current Arbora adapter waits for the final
  result. It forwards text and identity/usage metadata, not live rich activity.
- **Human approval** intercepts security-sensitive tool calls before execution.
- **Conversation persistence** combines per-user local presentation state with
  server-side chat records from `/api/enhanced/chats`.
- **Model discovery** reads the backend registry for the model picker and usage
  display, including zero-cost local models.
- **Structured traces** link browser requests to their downstream Arbora and
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

## Host composition

The WebUI holds no graph engine. A host passes `application_composer` to
`create_agent_web_app` to add its own routes. Graph data comes from Arbora
served operations; a feature whose operation is not served answers 501
`not_available`. Composition grants no identity or session authority. The host
must still supply its configured `session_boundary` and enforce its own
admission contract.

## Execution inspection boundaries

Work links the current response to its task when explicit matching metadata is
available. It also offers independent task and trace/node inspection. Selecting
a trace node does not retarget Chat, and trace spans are not spawned subagents.
The current-plan panel is read-only and uses the selected task's validated `runId` rather than an independently selected trace.

The selected task also has an inline execution-dependency view when its backend
supplies the versioned `runs.execution_graph` operation. It displays declared flat
plan steps, predecessor-to-dependent arrows and an expandable dependency list.
The view is unavailable when the task has no authoritative binding or the backend does
not support this operation. It never reconstructs orchestration from traces.
Lifecycle evidence is partial. An unobserved step is not necessarily queued.
A finished observed prefix does not prove that execution has finished.
Refresh revalidates access and clears the previous graph while loading.
This view does not supply child hierarchy, transcripts or child messaging.

Observability renders a `parentId` trace waterfall. That view describes span
nesting, not the dependency DAG of agent orchestration. Existing collapsible
components do not prove live public summaries, tool events or child conversations.

The [Work specification](https://github.com/Knuckles-Team/agent-webui/blob/main/specs/arbora-app-surface/requirements.md) retains
nested execution navigation, separate hierarchy/dependency edges and stable deep
links as remaining acceptance work. Public detail expansion also requires qualification. Targeted
active-child messaging and completed-child continuation require distinct
backend capabilities. Neither action is supplied by ordinary node selection.


### Native workspace assistant

The assistant stays alongside Work, Explore and Operate and retained private
routes, using one conversation and composer. The bounded dock gives the main
task most available desktop width. Narrow layouts keep a compact composer and status visible; Expand reveals the transcript and Options reveals the existing message controls. Write focuses
the composer; Expand and Restore adjust its space without opening an overlay or
changing the conversation. Current page and selected evidence context use the
existing shared context channel. Navigation does not grant tool authority.
