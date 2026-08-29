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
`AbortSignal`, checks cancellation before and after work, and caps serialized
output at Chrome's recommended 1,500-character security budget. Mutating Atlas
tools validate their complete public result before changing local state.

No raw Cypher, SQL, SPARQL, REST/MCP, credentials, chat sending, workflows,
goals, configuration, OpenBao, or backend write surface is registered here.
Tools are same-origin by default: the registration never supplies `exposedTo`.
Each registration has an `AbortSignal`, and the provider retires it on unmount,
identity changes, or page-context changes. The Atlas registrar exists only
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

## Why this is not lazy-loaded by graph-os

WebMCP tools live in, and act on, a particular open browser document. They are
discovered only after an agent visits that page; they are not remote MCP server
tools and cannot truthfully be registered in graph-os when no user browser is
present. Browser-native agents can use this surface directly.

A future graph-os-to-browser bridge must therefore be an explicit, short-lived,
user-bound capability lease associated with one authenticated browser session.
It must preserve role checks, cancellation, confirmation, and per-tool audit
provenance and must never forward Keycloak bearer tokens, OpenBao material, or a
generic backend request primitive. A permanent fleet registration or synthetic
"lazy loader" would erase those browser security and lifecycle boundaries and
is intentionally out of scope for this adapter.
