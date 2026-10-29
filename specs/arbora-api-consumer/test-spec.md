# API consumer test contract

| Test | Fixture and level | Pass condition |
|---|---|---|
| Schema regeneration | Pinned public OpenAPI/registry fixture | Generated client and digest have zero uncommitted diff |
| Error parity | Arbora contract fixture with validation, auth, forbidden, conflict, unavailable | Stable codes preserved; no legacy fallback |
| Effect confirmation | Browser with plan/step-up fixture | User sees effect/scope; changed principal, stale plan or missing step-up denied |
| Decisions and Markets/apps | Rendered route + host contract | Same caller and typed result; no domain host computation |
| Ontology/graph/Atlas/object set | Positive, malformed and two-tenant fixtures | Pagination and shape preserved; denied tenant body absent |
| Other domain families | Route-census table tests | Every old route classified and required op mapped |
| Streaming/cancel | Host and browser fixture | Auth retained; cancel stops stream and repeats safely |
| Architecture | Static import/route census on changed tree | Zero direct AU-internal imports and zero unclassified domain routes |
| Architecture lint route introduction | Add a synthetic unclassified domain handler, then a declared UI-local handler | Lint rejects the domain route and accepts only the explicitly inventoried UI-local route |
| Registry unavailable or mismatched | Remove an operation or change pinned digest in local fixture | Caller presents unavailable/upgrade state. No legacy endpoint, guessed payload or effect request |
| Confirmation replay | Expired and reused `plan_ref`, changed principal/tenant, missing step-up | Host and Arbora refuse action. No side effect and no sensitive body in logs |
| Ambient correlation id (OVERSTORY-API-R004) | Bind an id on the serving context, then serve two requests without a header | Each request gets a distinct fresh id; the ambient id never appears |
| Failure log error code (OVERSTORY-API-R005) | Raise an error with `engine_error_code=ACCESS_DENIED`, a malformed code, and no code | Log line names `error_code=ACCESS_DENIED` or `error_code=none`. Message text is absent |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, `uv run --all-extras pytest agent/agent_webui/__tests__` and `pre-commit run --config .config/pre-commit.yaml --all-files`. E2E provisions a local Arbora fixture or uses hosted CI; an inaccessible private deployment is not a PR blocker. CCCC: no new function over cyclomatic 10/cognitive 15 and no regression per configured hook. Run jscpd/Dupehound if configured; missing configuration is a documented gap, not a pass. KISS: one generated client, one host seam and no duplicate domain API. Record exact commands, exit codes, registry digest, route census and commit in `tasks.md`.

## OVERSTORY-API-R011.1 host composition

`agent/agent_webui/__tests__/test_served_operations.py` drives the real factory
with a fake Arbora transport. Verify each wired route sends its served
operation and each unwired route answers 501 `not_available`. No live
credentials or stores.

## Workspace action coverage consumer

For OVERSTORY-API-R003.2, add an unclassified visible action fixture. It has no generated operation, browser-local disposition or explicit unavailable capability. CI must reject it. Compare manual and WebMCP invocation against the same typed gateway error, tenant/purpose scope and preview-confirm-step-up result (R007/R011).

Catalog/source tests use existing query operations. Cover owner, glossary, upstream/downstream lineage, parent-class asset and prompt-candidate questions. Assert no removed bespoke catalog-read operation appears in the generated client, visible action registry or WebMCP descriptors. A UI or mocked answer alone is not query-engine acceptance. Verify real authorized results and unavailable/denied scope against the composed host.

## OVERSTORY-API-R011.2 conversation and run identity

Run `test_run_identity.py` and the mounted Chat identity tests. Verify equal prompts in distinct conversations never create a shared text-derived context. Reject conflicting history identity before invocation. Verify concurrent streams retain only their own admitted task/context/run references, and legacy text-only results do not fabricate linkage. Test first submit, repeated turns, selection changes and caller changes. Composed live acceptance remains required; these tests do not prove durable conversation resume.

Owner-key migration preserves old subject-only and global cache entries without automatic adoption. Local-only history is not losslessly migrated. Recovery requires an explicit owner-verified migration; callers must keep the original browser data until that migration is available. Denied or unresolved sessions must not hydrate or query conversations. Explicit no-auth conversation admission remains a separate contract requirement.

## Conversation identity source and composed residual

OVERSTORY-API-R011.2.1 binds the run-identity host fixtures and mounted chat source tests. Preserve their exact identity and refusal assertions. Source test linkage does not establish installed provider acceptance.

OVERSTORY-API-R011.2.2 retains the full R011.2 acceptance matrix. Run real browser transport and host streaming against the installed Arbora provider. Verify caller and tenant isolation, first-turn identity, conflicting and missing identity, and exact returned references. This qualification remains planned.

## Shared public execution adapter

For OVERSTORY-API-R011.3, plan `test_execution_projection.py::test_public_execution_adapter` at the real host model seam.
Plan `execution-projection.test.ts::binding_and_refusal` through the existing browser adapter.
Use generated producer fixtures with parent/child/grandchild and fan-out/fan-in identities.
Verify unchanged replay-v1 decoding before negotiating the new projection.
Verify root tasks versus run-local steps, shared run IDs, owner/context mismatch and absent target bindings.
Verify ordered replay, duplicate events, cursor gaps, partial snapshots and reconnect resnapshot.
Assert public summary, tool and transcript categories remain distinct and private/unknown fields never reach browser state.
Absent capabilities must disable controls; denial after success must withdraw previous records and bindings.
Legacy final-text replies must remain readable without claiming rich-part delivery.
Then qualify the installed host/browser/Arbora path with the same scenarios and exact producer versions.
No mapping fixture alone establishes served capability availability or child messaging.

## Flat execution read source proof

OVERSTORY-API-R011.4 uses `execution-graph.test.ts` and mounted `WorkExecutionGraph.test.tsx` through canonical session and invoke transport.
Require exact root-task/run identity, decoded tuple equality, Unicode preservation, unique evidence and a bounded acyclic dependency graph.
Reject foreign or malformed keys, duplicates, dangling edges, conflicting evidence and unexpected schema or capability values.
Missing operations stay unavailable without a fallback. Source fixtures do not establish installed-provider acceptance under R011.3.

## Embedded tracing and console ownership

OVERSTORY-API-R011.1: test_import_preserves_disabled_host_or_routes_enabled_console imports the actual server in isolated child processes. Disabled mode preserves an existing in-memory host exporter without a configure call. Enabled mode preserves the explicit export policy, emits a real diagnostic on stderr and leaves stdout as one JSON value. These source tests do not qualify a released package pair or browser operation authority.
