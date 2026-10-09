# Pinned GraphOS operation schema

`openapi.json` is `graph_os`'s own `Caller-filtered OpenAPI projection of the
shared operation registry` (`graph_os/api/http/openapi.py::document`), built
from the live registry (`graph_os.api.ops.{agents,browser,fleet}` plus every
wire-callable EG method `graph_os.api.registry.eg_binding.load_eg_bindings`
exposes). `schema.ts` is generated from it with `pnpm run graphos:client:gen`
(openapi-typescript).

## Known limitation in this snapshot

The curated ops (`agents.*`, `rlm.*`, `browser.*`, `fleet.*`) carry their real
Pydantic-derived JSON schemas. The EG-bound generated ops (`eg.<domain>.<Method>`,
for example `identity.*`'s backing methods) carry a placeholder `{"type":
"object"}` body in this snapshot: the graph-os commit this was built from and
the `epistemic-graph` checkout used to resolve `eg_schema` pointers were not
digest-pinned to each other, so `graph_os.api.registry.digest.canonical_registry`'s
strict schema-pointer resolution failed for several methods (for example
`Identity`) and had to be bypassed in favor of `graph_os.api.http.openapi.document`,
which degrades an unresolvable schema to a generic object instead of failing
closed. Operation **ids and HTTP paths are real and authoritative**; EG-bound
operation **field-level schemas are not** until regenerated from a
digest-matched pair.

Regenerate from a digest-matched graph-os + epistemic-graph pair with
`graph-os/scripts/gen_api.py`, which produces `docs/api/openapi.json`
(the canonical source `openapi.json` here is copied from), then re-run
`pnpm run graphos:client:gen`.

## WEBUI-API-R001 / APIUI-02 finding

There is no `decide.*` operation namespace. The real decision-related
operations are `eg.query.Decide`, `eg.coordination.DecisionLog`,
`eg.coordination.DecisionEval`, `eg.coordination.DecisionFit`, and
`eg.storage.DecisionCommit` — each multiplexes several named actions in one
operation (for example `DecisionLog` carries `get`/`aggregate`/`commit`/
`evaluate`/`compact`/`learn`/`resolve`/`verify`, selected by a request field,
not by separate operation ids). `graphos-decisions-transport.ts`'s
`decide.records.*` / `decide.outcomes.aggregate` / `decide.receipts.*` ids
predate this schema and do not match it; retargeting that file needs the
real per-action request/result shapes, not a rename, and is tracked
separately rather than patched here.
