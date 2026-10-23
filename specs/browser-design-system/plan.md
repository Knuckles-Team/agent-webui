# Design-system architecture

## Reuse

`src/index.css` defines theme tokens. `src/components/ui/` supplies primitives; `src/lib/nav-registry.ts` supplies navigation; `src/components/atlas/` and `src/Chat.tsx` are the first journey surfaces. Reuse their actual components rather than cloning a button, dialog, filter, tooltip or renderer. Keep interaction rules in a concise local design contract and examples in tests/stories. The design contract defines focus ring, control label, touch target, contrast, responsive breakpoint behavior, reduced-motion replacement and status-language conventions. It should describe the visible behavior rather than prescribe a new framework.

## Interaction model

Inputs and actions expose name, role, state and error association. Dynamic results announce concise status through a live region without announcing entire datasets. A dialog receives focus on open and restores it on close. Destructive actions use a confirmation step bound to the selected object. Filter clauses use index/field/operator information in their labels. Keyboard interaction never depends on hidden hover controls. Touch gestures have visible buttons. A progress state has a cancel affordance only if cancellation is safe. Motion is removed or shortened under reduced-motion while state changes remain legible.

## Review evidence

Create synthetic chat, Atlas and operational-form fixtures. Cover viewport widths 320, 375, 768 and 1440px, with light/dark and reduced-motion variants. Commit small baseline/after screenshots only if the repository's artifact policy permits; otherwise publish CI artifacts and record URLs/digests in `tasks.md`. No screenshot may contain real tenant, personal or secret data. Assess contrast and accessible names automatically, then perform keyboard and screen-reader manual review with a short result record. Check copied patterns and external text against licensing before adoption; do not add a telemetry network call.

## Fresh checkout

Run `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'`; browser tests start local host/API fixtures. Existing `pnpm run dev` and `dev:server` support exploratory review. All required evidence is generated from the checkout and CI fixtures, independent of a shared deployment.

## Free-scaling workspace design

WEBUI-DESIGN-R002.1/R004.1/R004.2/R005.1/R010 extend the current token, accessibility and responsive owners. A single focused pane on small screens retains persistent context and a visible pane switcher; larger screens progressively add related panes. Container/visual viewport constraints, content size and pointer capability determine layout, not a whitelist of device names. Test representative CSS dimensions and generated intermediate sizes; do not invent Galaxy Fold hardware specifications. Internal wide-data regions are labelled and keyboard-scrollable. Every editor, chart, admin action and leaf remains reachable.

Prefer compact native DOM controls and the existing primitives. Coarse-pointer 44 px targets can coexist with compact desktop 32–36 px targets when accessibility requirements allow. Suggested motion ranges are feedback 120 ms, panel 180–240 ms and semantic transition 240–320 ms, subordinate to measured budgets and reduced-motion preferences. Animations use transform/opacity where appropriate, are cancellable, and never become an essential information channel. No perpetual background decoration or continuous idle requestAnimationFrame. Respect CSP nonces and same-origin font requirements.

Reuse table virtualization, graph worker layout and LOD transport rather than adding a second renderer/data pipeline. Cancel superseded requests, bound streams and caches, preserve focus during virtualization and supply readable table/list alternatives to visual graphs. Acceptance reports fixture cardinality, browser/device, network, cold/warm state and measurement method. A failed budget remains open even if screenshots look good. Representative mobile and desktop journeys, not a single fast developer machine, determine release qualification.
