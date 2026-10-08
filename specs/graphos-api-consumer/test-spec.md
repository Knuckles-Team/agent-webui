# API consumer test contract

| Test | Fixture and level | Pass condition |
|---|---|---|
| Schema regeneration | Pinned public OpenAPI/registry fixture | Generated client and digest have zero uncommitted diff |
| Error parity | Graph OS contract fixture with validation, auth, forbidden, conflict, unavailable | Stable codes preserved; no legacy fallback |
| Effect confirmation | Browser with plan/step-up fixture | User sees effect/scope; changed principal, stale plan or missing step-up denied |
| Decisions and Markets/apps | Rendered route + host contract | Same caller and typed result; no domain host computation |
| Ontology/graph/Atlas/object set | Positive, malformed and two-tenant fixtures | Pagination and shape preserved; denied tenant body absent |
| Other domain families | Route-census table tests | Every old route classified and required op mapped |
| Streaming/cancel | Host and browser fixture | Auth retained; cancel stops stream and repeats safely |
| Architecture | Static import/route census on changed tree | Zero direct AU-internal imports and zero unclassified domain routes |
| Architecture lint route introduction | Add a synthetic unclassified domain handler, then a declared UI-local handler | Lint rejects the domain route and accepts only the explicitly inventoried UI-local route |
| Registry unavailable or mismatched | Remove an operation or change pinned digest in local fixture | Caller presents unavailable/upgrade state; no legacy endpoint, guessed payload or effect request |
| Confirmation replay | Expired and reused `plan_ref`, changed principal/tenant, missing step-up | Host and Graph OS refuse action; no side effect and no sensitive body in logs |
| Ambient correlation id (WEBUI-API-R004) | Bind an id on the serving context, then serve two requests without a header | Each request gets a distinct fresh id; the ambient id never appears |
| Failure log error code (WEBUI-API-R005) | Raise an error with `engine_error_code=ACCESS_DENIED`, a malformed code, and no code | Log line names `error_code=ACCESS_DENIED` or `error_code=none`; message text is absent |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, `uv run --all-extras pytest agent/agent_webui/__tests__` and `pre-commit run --config .config/pre-commit.yaml --all-files`. E2E provisions a local Graph OS fixture or uses hosted CI; an inaccessible private deployment is not a PR blocker. CCCC: no new function over cyclomatic 10/cognitive 15 and no regression per configured hook. Run jscpd/Dupehound if configured; missing configuration is a documented gap, not a pass. KISS: one generated client, one host seam and no duplicate domain API. Record exact commands, exit codes, registry digest, route census and commit in `tasks.md`.
