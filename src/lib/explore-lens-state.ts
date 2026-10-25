import { exploreHref, parseExploreState, validEntityId, type ExploreState } from './explore-workspace'
import { roleAtLeast, type Role } from './nav-registry'

export const EXPLORE_LENSES = ['evidence', 'graph', 'query', 'validation'] as const
export type ExploreLens = (typeof EXPLORE_LENSES)[number]
export interface ExploreLensState extends ExploreState {
  lens: ExploreLens
  /** Graph IDs are not assumed to identify ontology evidence. */
  graphNode?: string
  graphType?: string
}

export function canUseExploreLens(role: Role, lens: ExploreLens): boolean {
  // Explore retains its user gate; embedding the reader-admitted graph does not widen it.
  return roleAtLeast(role, lens === 'query' || lens === 'validation' ? 'maintainer' : 'user')
}

export function parseExploreLensState(location: string): ExploreLensState {
  const url = new URL(location, 'https://workspace.invalid')
  if (['lens', 'graphNode', 'graphType'].some((key) => url.searchParams.getAll(key).length > 1))
    throw new Error('Ambiguous Explore lens')
  const lens = url.searchParams.get('lens') ?? 'evidence'
  if (!EXPLORE_LENSES.some((value) => value === lens)) throw new Error('Unknown Explore lens')
  const graphNode = url.searchParams.get('graphNode')
  const graphType = url.searchParams.get('graphType')
  if (graphNode !== null && !validEntityId(graphNode)) throw new Error('Invalid graph selection')
  if (graphType !== null && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(graphType)) throw new Error('Invalid graph type')
  for (const key of ['lens', 'graphNode', 'graphType']) url.searchParams.delete(key)
  return {
    ...parseExploreState(`${url.pathname}${url.search}`),
    lens: lens as ExploreLens,
    ...(graphNode !== null ? { graphNode } : {}),
    ...(graphType !== null ? { graphType } : {}),
  }
}

export function exploreLensHref(state: ExploreLensState): string {
  if (!EXPLORE_LENSES.some((value) => value === state.lens)) throw new Error('Unknown Explore lens')
  const url = new URL(exploreHref(state), 'https://workspace.invalid')
  if (state.lens !== 'evidence') url.searchParams.set('lens', state.lens)
  if (state.graphNode !== undefined) url.searchParams.set('graphNode', state.graphNode)
  if (state.graphType !== undefined) url.searchParams.set('graphType', state.graphType)
  const href = `${url.pathname}${url.search}`
  parseExploreLensState(href)
  return href
}

/** Explicit capability list prevents navigation to an unmounted or unavailable lens. */
export function navigateExploreLens(state: ExploreLensState, role: Role, available: readonly ExploreLens[]) {
  if (!canUseExploreLens(role, state.lens)) throw new Error('Explore is not permitted for this role')
  const href = exploreLensHref(state)
  if (!available.includes(state.lens)) throw new Error('This Explore lens is unavailable')
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.pushState({}, '', href)
    window.dispatchEvent(new Event('history-state-changed'))
  }
  return state
}
