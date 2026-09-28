# Decision evidence architecture

## Existing components and reuse

The browser application is assembled in `src/App.tsx`; shared identity and requests live in `src/lib/auth.ts` and `src/lib/api.ts`; `src/components/views/` contains route views; `src/components/atlas/` provides reusable result and graph renderers. The FastAPI host in `agent/agent_webui/server.py` currently adapts browser protocols. Implementation must inventory the exact current decision route before editing, then extend its typed read client and route registration. Existing graph canvas and table renderers may display structure, but must not change decision semantics. Do not introduce a second decision engine or a browser-to-database credential.

## Data and interaction contract

The WebUI consumes a versioned Graph OS read response shaped as `{decision_id, tenant_id, option_id, chosen, premise_refs[], derivation_refs[], constraint_results[], certificate_ref, why_not?, decided_at, record_version}` and a separate evaluation response `{decision_id, evaluation_id, cohort, label_provenance, independent, n_items, n_min, target_coverage, observed_coverage?, observed_risk?, window, method_version, evaluated_at, receipt_ref}`. These are conceptual UI contracts: generated API types prevail when the Graph OS operation registry is available. Unknown fields are ignored safely; missing required identifiers fail parsing into an error state. Browser responses carry no service bearer. Why-not is a separate bounded request and never rewrites the committed record.

Query keys include principal/tenant, decision ID, record version, evaluation ID and purpose. Abort old requests on selection or identity change. A receipt is displayable only when `independent=true`, `n_items>=n_min`, matching decision/version and nonexpired window; the server remains authoritative and the browser independently withholds unsupported claims. Links to premises open authorized read routes and propagate refusal. Do not turn a ref into raw HTML.

## Failure, privacy and migration

Treat authorization refusal, absent record, unavailable evaluation, insufficient sample, timed-out why-not and transport failure as distinct typed states. Redact private premise text from analytics and client logs. Existing saved links should resolve by stable decision ID; if a legacy route exists, keep only a bounded redirect to the canonical route. Server-generated stale or synthetic labels are displayed as diagnostics, never as calibrated evidence. No client-side write path is introduced.

## Independent development

From a clone, run `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'`, then `pnpm run dev:server` and `pnpm run dev`. A test Graph OS base URL and OIDC test realm may be supplied through documented environment variables; unit/contract tests use checked-in synthetic fixtures and start without a shared deployment. The browser acceptance test provisions its own service/identity fixture or runs in hosted CI. See `test-spec.md` for exact gates.
