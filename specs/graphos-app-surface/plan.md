# GraphOS shell and app architecture

## Reuse and ownership

`src/lib/nav-registry.ts` owns sections/routes; `src/lib/frontend-contributions.ts` validates contributed descriptors; `src/lib/webmcp/` owns attended page tools; `src/lib/atlas/renderers.ts` and `src/components/atlas/renderers/index.ts` own renderer registration. `src/App.tsx` mounts the shell. `public/`, `index.html`, `src/index.css` and the existing asset generator own brand presentation. `agent/agent_webui/server.py` serves packaged assets. Extend these seams; do not create another router, renderer registry, app permission database or client-side Graph OS authority. The first native app lives under `src/apps/markets/`; its finance behavior is specified separately in this repository.

## AppSurface contract

Each app has a stable ID, manifest version, route definitions from the same `RouteDef` shape, capability/min-role declaration, generated API client binding, WebMCP page/tool IDs and optional typed Atlas renderer registrations. Resolve the app catalog before constructing navigation. A native app registers a statically imported component. A package descriptor carries declarative metadata and a trusted, bounded contribution reference; the host validates it through the existing frontend-contribution schema and policy before exposing a route. A denied app is absent from privileged navigation and direct URL access returns a denied state. WebMCP tools remain attended and call the host-mediated Graph OS operation path; they cannot execute merely because a page registered them.

## Brand and migration

Regenerate favicon/icon/social images using the repository asset script and check generated files against source. Move Python import and distribution metadata, npm package metadata and release image naming in one cutover with Graph OS's consumer dependency. Keep the npm package private when the SPA is shipped in the Python wheel. Change WebMCP tool IDs to `graphos.*` and regenerate digests; old grants drain by expiry and are not silently reinterpreted. Browser storage keys receive a version bump and explicit re-consent. Environment names use one canonical prefix and reject stale aliases after the documented cutover. Preserve browser route paths except those required for the Apps section. Published Pages navigation resolves to the new site after publication; broken links are measured.

## Failure and portability

A missing catalog, unsupported manifest version, denied capability, unavailable API or failed app load has a distinct visible state. Fail closed on invalid descriptors and do not import remote executable code. A fresh checkout runs `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'`, then `pnpm run dev:server` and `pnpm run dev`; fixtures provide native and contributed app manifests locally. No private host is needed for normal PR validation.

## Run harness surface (WEBUI-APPS-R004)

Data flow: Observability run view (`ObservabilityView.tsx:602`) → `gatewayPost` (`gateway.ts:129`) → graph-os `runs.get` / `runs.metrics` → harness block beside the DAG.

Types and fields (names from the design brief): `harness_config` (`context_policy` with `soft_threshold`, `hard_threshold`, `recent_window_fraction`; `plan_scaffold`; `action_space`), `peakContextTokens`, `contextBudgetTokens`, `costUsd`, `terminationReason` (`final_answer` | `context_overflow` | `stuck` | `step_budget` | `error`), and the run's plan state.

Attach point: the run list and DAG panel in `src/components/views/ObservabilityView.tsx` (`loadRuns` :602, `loadDag` :619, `RunRow` :41), which calls `gatewayPost` (`src/lib/gateway.ts:129`) on `/traces`; a new harness block renders beside the selected run's DAG.

Failure behaviour: a refused or absent operation yields "not available". The client invents no value and shows no zero for an absent number. Each termination reason has its own label; `context_overflow` and `stuck` carry their own text.

Reuse and new: the run view above stays; the harness block is new.

Decisions: the client reads `runs.get` and `runs.metrics` only. Rejected alternative: computing context use or cost in the client.
The engine owns the run trace, and a client copy drifts.

Cross-repository: depends on three rows. The `GRAPHOS-OPS` row for run metrics serves `runs.get` and `runs.metrics`. The `AU-HARNESS` row for the run trace writes the fields. The `AU-HARNESS` row for `update_plan` owns the plan state.

## WEBUI-APPS-R005 role-aware navigation and per-user dashboards

Data flow: principal role → nav registry filter → DashboardView layout read and write → rendered page.
Attach point: src/lib/nav-registry.ts and src/components/views/DashboardView.tsx.
Reused: the identity session from `IDUI-02` and the AppSurface contract. Role definitions stay with `GRAPHOS-IDENTITY` rows.
Decision: filter navigation by the declared role in the client. Graph OS still authorizes each call. Rejected alternative: a separate client role table.

## WEBUI-APPS-R006 goals, sessions and fleets panel

Data flow: goals, sessions and fleets operations → link builder → panel filtered by goal.
Attach point: first child row locates the current goals and sessions views and replaces them.
Reused: the typed client of `APIUI-04`. Fleet execution stays with `AU-CONTROL` rows.
Decision: relate by returned identifiers. Rejected alternative: infer links by name matching in the browser.
## Graph edits through the engine (WEBUI-APPS-R030)

The graph overlay save (`GraphCanvas.tsx:605`) calls `handleUpdateNode` (`GraphView.tsx:792`). It calls the new `sendGraphEdit` export in `src/lib/graph-edit.ts`, then `gatewayPost` (`gateway.ts:129`). The authenticated GraphOS invoke pipeline serves `eg.graph.AddNode`, `eg.graph.ApplyMutation` and `eg.graph.RemoveNode`. The fixture engine commits the durable mutation. The client updates local state from the verdict and authoritative readback.

Types: `GraphEditRequest`, `GraphEditVerdict` (`applied` | `refused` | `unavailable`), `ViewPersona`. Attach point: the three handlers at `GraphView.tsx:792-801`, called by `GraphCanvas.tsx:605-609`.

Failure behaviour: a refused edit leaves the node unchanged and shows the engine reason. An absent operation shows "not available".

Existing code: `src/components/views/GraphView.tsx:792`, `:796`, `:801`; `src/components/knowledge-graph/GraphCanvas.tsx:379`, `:605`; `src/lib/nav-registry.ts:73`. Reachable today: no. The handlers run, but no production caller reaches an engine write. Persona search terms (`persona`, `ViewPersona`) found nothing, so persona modes are new.

Decision: the engine decides authorization and the client shows the verdict. Rejected alternative: a client-side role check, which drifts from the engine policy.

Cross-repository: `GRAPHOS-OPS-R008` generates the engine-bound operations, `GRAPHOS-OPS-R009` enforces invoke authority and `GRAPHOS-OPS-R013` serves `POST /api/v1/ops/{op_id}`. EG owns the served `ApplyMutation` version check (`EG-DURABLE-KERNEL-R084.3`) and unchanged-state conflict refusal (`EG-DURABLE-KERNEL-R084.4`). Embedded read parity in `EG-TYPED-PACKS-R088` is not proof of served write authorization.

## Memory files (WEBUI-APPS-R031)

### Current source and producer prerequisites

[EG R085](https://github.com/Knuckles-Team/epistemic-graph/tree/c0b952776129fd509b9f87b411a298593c2591ec/specs/durable-graph-kernel) defines authoritative memory versions, conflicts, retention and synchronization evidence.
[GraphOS R024.4.1–.6](https://github.com/Knuckles-Team/graph-os/tree/4947963af19b13cc8cc7eed8f180e5939594d114/specs/hosted-api-operations) defines hosted files and serving in [PR 272](https://github.com/Knuckles-Team/graph-os/pull/272), currently a proposed producer dependency.
Neither definition establishes installed operations or runtime acceptance.
EG owns content, compare-and-set, retention and sync decisions. GraphOS owns authenticated serving, hosted projection and authenticated materialization acknowledgments. AU consumes EG decisions. WebUI renders the returned state.

Current main `28df14e42c751d5fb99b60c973a5164144ef090d` has Memory-node CRUD in `src/components/views/MemoryView.tsx:439`, mounted from `src/lib/nav-registry.ts:664`; it has no Files tab or `src/lib/memory-files.ts`.
The existing `src/lib/graphos-api/invoke.ts:56` sends generated operations to `/api/v1/ops/{op_id}` with same-origin credentials, CSRF handling, idempotency options and validated envelopes. Reuse that adapter under `WEBUI-API-R001`, `APIUI-01` and `APIUI-06`.
`gatewayPost` prefixes the graph facade and is not the operation adapter. Served tests must prove the real same-origin host route and installed schemas. The browser helper alone does not prove them.

### Explicit wire and view mapping

| Planned helper/view | GraphOS producer | EG producer | Required mapping |
|---|---|---|---|
| listMemoryFiles | memory.files.list; R024.4.1/.2/.6 | R085.1/.2/.4 | Generated metadata-only page, optional kind, limit 1–100, opaque cursor; stable authorized snapshot, no hidden counts or hashes |
| readMemoryFile | memory.files.read; R024.4.1/.2/.6 | R085.1/.2/.4/.5 | Document identity and optional exact revision; only authorized snapshot bytes, digest, sync state and conflict references |
| saveMemoryFile | memory.files.save; R024.4.1/.3/.5/.6 | R085.1/.3–.5/.7 | Generated submit/resolve only; exact precondition, UTF-8 bytes and digest; explicit absent-head creation; same identity/body retry |
| conflict and refusal views | R024.4.3/.5 | R085.3/.5/.7 | Authorized conflict_retained versus head-free refused; do not convert retained conflict to a generic failure |
| sync label | R024.4.4 | R085.6/.8 | Render in_sync, graph_ahead, file_ahead, conflict or unavailable exactly from served evidence |

These operation names are proposed producer IDs, not registration claims. Do not alias generic memory.read/write to them or maintain another authoritative browser store. Use generated bounded schemas: 1 MiB content, 256-byte document IDs and 1024-byte logical paths, preserving stricter serving limits. Logical paths are labels, never browser-controlled filesystem authority.

Refused/expired cursors require an explicit restart, not concatenation of incompatible snapshots. Recheck authorization on every page/read/save/conflict read/replay. Discard late responses across principal, tenant, graph or document changes; clear protected content after access loss. Refused results carry only error code and request-local correlation, with no result-derived metadata in the envelope, errors or activity view. Denied existing, absent and creation attempts have equal disclosure. A changed-body replay refuses without mutation.

Authorized stale saves return conflict_retained only after both versions are durably retained. Show both immutable contents/digests via authorized reads; never overwrite the accepted head. Retention-capacity failure refuses and cannot be presented as retained. Resolution binds the current accepted head and retained conflict. EG, not the client or hosted artifact deletion, determines release of retained history.

### Host observations and acknowledgment races

The browser cannot invoke observe_file or acknowledge_materialization. A save result is not a host acknowledgment. GraphOS must preserve local edits and submit observations before replacing hosted bytes. Its acknowledgment binds graph incarnation, document, accepted revision, digest, observation_generation and attempt. EG atomically checks head and generation. A newer observed edit invalidates an old acknowledgment even if the accepted head has not changed. Pending edits or unresolved conflicts prevent in_sync; missing evidence yields unavailable. The UI must render that state after reread and never infer in_sync from HTTP success or matching local text.

All helper, tab, registered-operation and host-materializer work remains SPECIFIED. Planned tests below are acceptance requirements, not implementation evidence.

## 2026-10-11 ownership and served-acceptance correction

Checked owner snapshots: GraphOS `9d035d692475a7f513c2b3e99171d729b4ca5d08`
and EG `3137ad4a02c50540a94c0523acc9638281532c9e`.
GraphOS `graph_os/api/registry/eg_binding.py` generates `eg.{domain}.{method_id}`;
its exclusions list is empty at this snapshot. EG `contract/methods.json`
marks AddNode, ApplyMutation and RemoveNode in the graph domain wire-callable.
The installed registry and generated schemas remain the deployment authority;
source availability is not a served acceptance receipt.

The versioned-memory ownership contract is now the R085/R024.4 mapping above.
Generic memory.read/write and ApplyMutation concurrency remain insufficient to establish file synchronization.

The graph-edit browser path uses its typed export and gatewayPost. The memory-file path uses its typed export and canonical invoke adapter. Both require the real WebUI host.
The authenticated GraphOS operation invokes its real handler and the actual fixture engine.
An independent durable readback completes the acceptance path. Local React state or helper
spies prove presentation/wiring only. R030.7 and R031.7 require browser journeys
through that complete path with no client/gateway/host-handler/engine-transport
mocks. Fixture credentials and temporary storage are allowed; replacing the
owners with canned verdicts is not. Persist and reload both conflict versions;
unauthorized graph edits must leave durable graph state unchanged.

All R030/R031 children remain SPECIFIED until their own acceptance runs. The
requirements describe product-neutral graph and memory behavior. Research
citations, including arXiv papers, are inspiration only, never protocol
contracts, owner authority, implementation evidence or acceptance receipts.
