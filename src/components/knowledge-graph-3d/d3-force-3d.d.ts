/**
 * @file d3-force-3d.d.ts
 * @description Minimal ambient types for `d3-force-3d` (MIT), which ships no
 * `.d.ts` of its own and has no `@types/` package. Declares ONLY the four
 * entry points `layout.worker.ts` actually calls -- deliberately not a full
 * port of the library's surface, so it cannot drift into claiming more than
 * this codebase uses.
 */
declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number
    x?: number
    y?: number
    z?: number
    vx?: number
    vy?: number
    vz?: number
    fx?: number | null
    fy?: number | null
    fz?: number | null
  }
  export interface SimLink {
    source: number | SimNode
    target: number | SimNode
  }
  export interface Force {
    (alpha: number): void
    initialize?: (nodes: SimNode[], random?: () => number, dimensions?: number) => void
  }
  export interface ManyBodyForce extends Force {
    strength(value: number | ((node: SimNode) => number)): ManyBodyForce
    theta(value: number): ManyBodyForce
    distanceMax(value: number): ManyBodyForce
  }
  export interface LinkForce extends Force {
    id(accessor: (node: SimNode) => number | string): LinkForce
    distance(value: number | ((link: SimLink) => number)): LinkForce
    strength(value: number | ((link: SimLink) => number)): LinkForce
    iterations(value: number): LinkForce
  }
  export interface Simulation {
    nodes(): SimNode[]
    force(name: string, force: Force | null): Simulation
    alpha(value: number): Simulation
    alphaDecay(value: number): Simulation
    alphaMin(value: number): Simulation
    velocityDecay(value: number): Simulation
    stop(): Simulation
    tick(iterations?: number): Simulation
    randomSource(source: () => number): Simulation
  }
  export function forceSimulation(nodes?: SimNode[], numDimensions?: number): Simulation
  export function forceManyBody(): ManyBodyForce
  export function forceLink(links?: SimLink[]): LinkForce
  export function forceCenter(x?: number, y?: number, z?: number): Force
}
