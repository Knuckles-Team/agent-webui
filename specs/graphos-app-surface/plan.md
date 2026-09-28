# GraphOS shell and app architecture

## Reuse and ownership

`src/lib/nav-registry.ts` owns sections/routes; `src/lib/frontend-contributions.ts` validates contributed descriptors; `src/lib/webmcp/` owns attended page tools; `src/lib/atlas/renderers.ts` and `src/components/atlas/renderers/index.ts` own renderer registration. `src/App.tsx` mounts the shell. `public/`, `index.html`, `src/index.css` and the existing asset generator own brand presentation. `agent/agent_webui/server.py` serves packaged assets. Extend these seams; do not create another router, renderer registry, app permission database or client-side Graph OS authority. The first native app lives under `src/apps/markets/`; its finance behavior is specified separately in this repository.

## AppSurface contract

Each app has a stable ID, manifest version, route definitions from the same `RouteDef` shape, capability/min-role declaration, generated API client binding, WebMCP page/tool IDs and optional typed Atlas renderer registrations. Resolve the app catalog before constructing navigation. A native app registers a statically imported component. A package descriptor carries declarative metadata and a trusted, bounded contribution reference; the host validates it through the existing frontend-contribution schema and policy before exposing a route. A denied app is absent from privileged navigation and direct URL access returns a denied state. WebMCP tools remain attended and call the host-mediated Graph OS operation path; they cannot execute merely because a page registered them.

## Brand and migration

Regenerate favicon/icon/social images using the repository asset script and check generated files against source. Move Python import and distribution metadata, npm package metadata and release image naming in one cutover with Graph OS's consumer dependency. Keep the npm package private when the SPA is shipped in the Python wheel. Change WebMCP tool IDs to `graphos.*` and regenerate digests; old grants drain by expiry and are not silently reinterpreted. Browser storage keys receive a version bump and explicit re-consent. Environment names use one canonical prefix and reject stale aliases after the documented cutover. Preserve browser route paths except those required for the Apps section. Published Pages navigation resolves to the new site after publication; broken links are measured.

## Failure and portability

A missing catalog, unsupported manifest version, denied capability, unavailable API or failed app load has a distinct visible state. Fail closed on invalid descriptors and do not import remote executable code. A fresh checkout runs `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'`, then `pnpm run dev:server` and `pnpm run dev`; fixtures provide native and contributed app manifests locally. No private host is needed for normal PR validation.
