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
