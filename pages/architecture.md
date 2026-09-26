# Architecture

Agent WebUI is the browser and same-origin presentation boundary for GraphOS.
It renders runtime capabilities; it does not duplicate their authorities.

![Runtime architecture: Agent WebUI enters GraphOS, which composes agent-utilities, epistemic-graph, and connector services.](assets/runtime-architecture.svg)

## Runtime composition

GraphOS starts Agent WebUI as a supervised co-service when `ENABLE_WEB_UI=true`.
The composition path is explicit:

1. GraphOS creates the native gateway application and verified process context.
2. The GraphOS WebUI host creates the Agent WebUI FastAPI application.
3. GraphOS injects its gateway route composer through `ApplicationComposer`.
4. Agent WebUI mounts the single-page application after every typed API route.
5. Security and observability middleware wrap the complete application.

The standalone Agent WebUI server deliberately omits GraphOS-owned routes. Use
the GraphOS-hosted composition for the complete platform surface.

## Browser request path

<ol class="site-flow">
  <li class="site-flow__step">
    <h3 class="site-flow__title">Browser</h3>
    <p class="site-flow__body">React sends same-origin HTTP, SSE, AG-UI, ACP, or browser-control requests to the WebUI host.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">WebUI host</h3>
    <p class="site-flow__body">FastAPI validates browser boundaries and converts UI intent into a typed, server-side operation.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">GraphOS</h3>
    <p class="site-flow__body">The injected gateway verifies identity, applies runtime policy, and delegates to the owning service.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">Owned authority</h3>
    <p class="site-flow__body">Agent, graph, or connector code executes the operation and returns typed evidence and receipts.</p>
  </li>
</ol>

## Authority boundaries

| Boundary | Owns | Does not own |
|---|---|---|
| React application | Presentation, interaction state, route metadata, accessibility | Service credentials, policy truth, durable graph state |
| Agent WebUI FastAPI host | Same-origin browser endpoints, SPA serving, host checks, request bounds, CSP | GraphOS fleet lifecycle or graph-engine implementation |
| GraphOS composition | Verified identity, public routing, runtime policy, fleet supervision, injected gateway routes | Agent reasoning, durable knowledge, vendor-specific transport |
| agent-utilities | Agent decisions, workflows, evaluation, skills | Public gateway hosting or database semantics |
| epistemic-graph | Durable data, reasoning, provenance, transactions | Agent orchestration or browser presentation |
| Connector services | Authorized source reads and writes through SDK contracts | Global policy or graph authority |

## Identity and credentials

The browser never receives a GraphOS service bearer. The WebUI host terminates
the browser session, derives the request actor from the verified server
context, and uses host-injected delegation ports for privileged operations.
Role metadata affects navigation, but the server remains authoritative for
every permission decision.

A local loopback deployment can run without SSO and resolves to the documented
single-operator posture. A configured OIDC deployment verifies the session and
maps its realm roles to the WebUI role ladder before a protected route renders.

## Streaming and activity

AG-UI is the primary conversation stream. ACP sessions use the same composed
agent runtime, and WebUI event components render specialist routing, parallel
activity, tool invocations, approvals, and sources from typed runtime events.
Conversation history combines server-owned records with per-user local
presentation state.

## Knowledge workspace

Atlas is the shared entry point for graph, RDF, schema, object, table, document,
code, and memory exploration. Each view uses the same GraphOS-injected request
context. Query and reasoning semantics remain in epistemic-graph; the browser
selects a view and renders the returned typed result.

## Contact boundary

`POST /api/contact` accepts only bounded contact fields and a client
idempotency key. It requires an authenticated actor and exact same-origin
request. Delivery is available only when the host injects an adapter with a
durable idempotency fence, deployment-wide abuse control, a fixed destination,
and an explicit retention decision. Successful delivery returns only an opaque
receipt.

## Related reference

- [Agents and events](agents.md)
- [Atlas workspace](atlas.md)
- [Capability Workbench](capability-workbench.md)
- [Feature reference](features.md)
- [Deployment and operations](deployment.md)
