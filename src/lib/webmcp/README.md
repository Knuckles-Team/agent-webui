# Experimental WebMCP browser tools

This directory contains an optional integration with the current proposed
[WebMCP community draft](https://webmachinelearning.github.io/webmcp/)'s imperative
`document.modelContext.registerTool()` API. The
adapter is feature-detected at runtime and is a no-op when the browser, secure
context, or Permissions Policy does not provide that API. It does not polyfill
WebMCP and does not use the older `navigator.modelContext` spelling.

The initial namespaced surface is deliberately UI-local:

- `agent-webui.get-page-context` reads the route, view, selection, and filter
  context, excluding page action affordances and credential-shaped query keys.
- `agent-webui.navigate` visits a registered same-origin route after the
  current role is checked against `nav-registry`.
- `agent-webui.atlas.get-state` reads bounded Atlas adapter/filter/selection
  state, excluding console text, submitted queries, result payloads, and
  adapter options. Credential-shaped route/filter names are redacted from
  state echoes as an additional boundary safeguard.
- `agent-webui.atlas.set-filters` and `agent-webui.atlas.select` update only
  local Atlas editor/selection state. They do not run a query or write data.

All tool inputs and outputs pass strict Zod validation. The executor accepts an
object or the equivalent JSON string because draft implementations have used
both callback forms. Invalid input or output rejects the tool call; arbitrary
coercion is not performed. Every execution consumes the draft callback's
`AbortSignal`, checks cancellation before dispatch, and caps serialized output
at Chrome's recommended 1,500-character security budget. Once a local action
may have been applied, the callback owns cooperative cancellation so the
browser never receives a false rollback claim. Mutating Atlas tools validate
their complete public result before changing local state.

No raw Cypher, SQL, SPARQL, REST/MCP, credentials, chat sending, workflows,
goals, configuration, OpenBao, or backend write surface is registered here.
Tools are same-origin by default: the registration never supplies `exposedTo`.
Each registration has an `AbortSignal`, and the provider retires it on unmount,
identity changes, or page-context changes. A registration is only reported as
active after the browser acknowledges it; pending, failed, aborted, and
unsupported registrations remain unavailable. The Atlas registrar exists only
while the Atlas workbench is mounted. Agent navigation accepts only registered,
role-visible application-relative paths; query strings and fragments are
rejected so credentials or private route state cannot be persisted and echoed.

The provider is mounted below the existing `PageContextProvider` in `App.tsx`;
the Atlas registrar is mounted inside `AtlasWorkbench`. This keeps the browser
surface separate from graph-os/backend MCP context and gives each tool only the
typed callback seam it needs.

## Browser and deployment prerequisites

WebMCP remains experimental. Chrome exposes it through an origin trial starting
with Chrome 149 or the local `chrome://flags/#enable-webmcp-testing` flag; Edge
uses a separate origin trial. The page must be a secure, origin-isolated context
and permitted to use the `tools` Permissions Policy (whose top-level/same-origin
default is `self`). A deployment that enables `document.domain`, including via
`Origin-Agent-Cluster: ?0`, disables the API. No cross-origin `exposedTo` access
is configured here.

## Graph OS leased browser control

WebMCP tools live in, and act on, one open browser document. Browser-native agents
can use the registered draft API directly. An authenticated operator may also
explicitly arm the Graph OS bridge from the visible control in the WebUI. Arming
opens the same-origin `/ws/browser-control` channel with the existing OIDC cookie;
JavaScript never receives or sends a Keycloak token, service bearer, OpenBao
value, tenant assertion, or principal assertion.

```mermaid
sequenceDiagram
  participant User
  participant IdP
  participant Page as WebMcpProvider
  participant Channel as /ws/browser-control
  participant GraphOS as BrowserControlService

  Page->>Page: Register and acknowledge local definitions
  User->>Page: Arm current visible page
  Page->>Channel: POST route and path-only return for attended step-up
  Channel-->>Page: IdP authorization URL (no receipt)
  Page->>IdP: Top-level recent-auth redirect
  IdP->>Channel: Verified callback sets HttpOnly recent-auth grant
  Page->>Page: Rebuild and acknowledge the current local catalog
  Page->>Channel: POST current generation/catalog/tool digests to finalize
  Channel-->>Page: Non-secret armed status; HttpOnly one-use receipt set
  Page->>Channel: channel.open + versioned catalog
  Channel->>GraphOS: Verify session, route, generation, policy
  GraphOS-->>Page: channel.ready for exact route + generation
  GraphOS-->>Page: control.confirmation_request (mutation only)
  User->>Page: Confirm exact call/tool/schema/argument digest
  Page->>GraphOS: control.confirm
  GraphOS-->>Page: control.call (read or confirmed mutation)
  Page->>Page: Invoke retained validated definition
  Page->>GraphOS: bounded result or honest cancellation effect
```

`ActiveWebMcpRegistry` retains only browser-acknowledged definitions from the
current identity, document, route, page context, and generation. The capability
catalog is deterministic and versioned. Each tool carries its input/output JSON
schemas, a canonical SHA-256 schema digest, current role and route binding,
read/mutation class, exact-request confirmation policy, and source reference.
The browser sends the language-neutral catalog projection to Graph OS, while the
original validated `execute` callback remains the sole local executor.

The trusted click is local UX evidence only. Server authority comes from the
existing OIDC provider's recent-auth step-up. Its callback creates only a
server-owned recent-auth grant. After reload, the page rebuilds its catalog and
finalizes that grant against the current route, generation, catalog digest, and
tool scope. The server then creates a short-lived one-use HttpOnly receipt.
The receipt is consumed by the WebSocket handshake and is never exposed to
JavaScript. The redirect continuation contains only the path, with query and
fragment removed. Authorization and global revoke operations are serialized so
stale cleanup completes before another arm can start.

Graph OS owns authorization, leases, replay fences, call state, durable receipts,
and terminal outcomes. The WebUI retains only the active local definitions,
in-flight abort controllers, and the attended confirmation being displayed. A
mutation uses two phases: the initial confirmation request never executes; only
the later `control.call` carrying Graph OS's `confirmed_mutation` authorization
and the exact approved digest reaches the local definition. Arguments, schemas,
channel frames, and UTF-8 results are bounded; result errors are reduced to safe
codes. Denied or cancelled confirmations retain a bounded call/digest tombstone
for the channel lifetime so a replay cannot reopen the prompt.

Sign-out, identity/tenant/session expiry change, page context or active generation
change, hidden documents, page unload, explicit revoke, and channel loss retire
the channel. Cancellation is best effort and reports only `none`,
`browser_reported_committed`, or `unknown`; it never claims rollback. Unsupported,
insecure, unpermitted, anonymous, or local-development sessions retain the honest
browser-local no-op behavior and cannot arm remote control.
