# API consumer architecture

## Current and target wiring

Current WebUI calls are concentrated in `src/lib/api.ts`, `src/lib/admin-api.ts`, `src/lib/atlas/`, `src/lib/webmcp/`, and the FastAPI `agent/agent_webui/api_extensions.py` facade. The host is assembled in `agent/agent_webui/server.py`; `src/lib/nav-registry.ts` is the route authority. Audit every current browser route and host handler before deleting it. Target path: browser → same-origin WebUI session host → generated Graph OS `/api/v1` client → Graph OS operation registry → authorized owning service. Graph OS owns credentials, operation schema, scope, effect gate, audit and stable errors; the WebUI owns rendering, interaction and browser-safe session forwarding.

Generate the client into `src/lib/graphos-api/` from a pinned published schema with a repeatable command and checked-in lock/digest. The adapter accepts typed operation name and params, supplies correlation/request ID and caller context through the host, validates error envelopes, and returns a discriminated success/error result. It must not synthesize scopes, bypass server policy or accept arbitrary URL targets from browser input. For effects, the response carries a `plan_ref`, effect class and required confirmation/step-up; confirmation posts the exact unmodified plan reference and binds it to the current principal/session. Denial codes and database codes remain intact for display and debugging without leaking sensitive detail.

## Cutover sequence

1. Freeze a route census with classifications: UI-local, session/protocol, generated Graph OS operation, and retire. Save the census with this spec when implementation starts.
2. Introduce the generated client and prove read/error/auth parity for one route family, then migrate decisions/apps/WebMCP, ontology/graph/Atlas/object-set, and remaining domain families.
3. Move server-side adapters into the same operation path. Delete retired `api_extensions.py` domain blocks and AU-internal imports only after each family's regression tests pass. Do not keep a hidden fallback to the old path.
4. Add an architecture gate that rejects new browser-domain endpoints in the host and direct AU-internal imports. UI-local endpoints must be allowlisted with owner and reason.

## Compatibility and failure

The `/api/v1` version and schema digest are visible to the client. A version mismatch fails with a concise upgrade state; no call is sent with guessed fields. Preserve pagination cursors, result shapes and cancellation. Timeouts, forbidden, conflict, validation and unavailable responses remain distinguishable. Streaming uses existing authenticated browser transport and the same caller; cancellation is idempotent. Never log request bodies carrying prompts, secrets or tenant data. For fresh checkout, install `pnpm`/`uv` dependencies as in `AGENTS.md`; use a checked-in schema fixture or a locally provisioned Graph OS service to regenerate and test without a shared deployment.
