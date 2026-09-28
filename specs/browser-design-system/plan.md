# Design-system architecture

## Reuse

`src/index.css` defines theme tokens. `src/components/ui/` supplies primitives; `src/lib/nav-registry.ts` supplies navigation; `src/components/atlas/` and `src/Chat.tsx` are the first journey surfaces. Reuse their actual components rather than cloning a button, dialog, filter, tooltip or renderer. Keep interaction rules in a concise local design contract and examples in tests/stories. The design contract defines focus ring, control label, touch target, contrast, responsive breakpoint behavior, reduced-motion replacement and status-language conventions. It should describe the visible behavior rather than prescribe a new framework.

## Interaction model

Inputs and actions expose name, role, state and error association. Dynamic results announce concise status through a live region without announcing entire datasets. A dialog receives focus on open and restores it on close; destructive actions use a confirmation step bound to the selected object. Filter clauses use index/field/operator information in their labels. Keyboard interaction never depends on hidden hover controls; touch gestures have visible buttons. A progress state has a cancel affordance only if cancellation is safe. Motion is removed or shortened under reduced-motion while state changes remain legible.

## Review evidence

Create reproducible synthetic fixtures for chat, Atlas and an operational form, with viewport widths 320, 375, 768 and 1440px, light/dark and reduced-motion variants. Commit small baseline/after screenshots only if the repository's artifact policy permits; otherwise publish CI artifacts and record URLs/digests in `tasks.md`. No screenshot may contain real tenant, personal or secret data. Assess contrast and accessible names automatically, then perform keyboard and screen-reader manual review with a short result record. Check copied patterns and external text against licensing before adoption; do not add a telemetry network call.

## Fresh checkout

Run `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'`; browser tests start local host/API fixtures. Existing `pnpm run dev` and `dev:server` support exploratory review. All required evidence is generated from the checkout and CI fixtures, independent of a shared deployment.
