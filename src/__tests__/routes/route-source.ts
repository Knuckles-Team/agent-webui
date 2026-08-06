/**
 * @file route-source.ts
 * @description The ONE line the render-test generator depends on for its
 * route list. `src/lib/nav-registry.ts` (PROGRAM.md R1, sibling lane
 * `w0-webui-registry`) has landed on `main` (`ad1cb76`) — this is the real
 * registry, not the temporary local fallback.
 */
export { ROUTES } from '@/lib/nav-registry'
export type { RouteDef } from '@/lib/nav-registry'
