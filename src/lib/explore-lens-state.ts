import { exploreHref, navigateExplore, parseExploreState, type ExploreState } from './explore-workspace'
import { roleAtLeast, type Role } from './nav-registry'

export const EXPLORE_LENSES = ['evidence', 'query', 'validation'] as const
export type ExploreLens = (typeof EXPLORE_LENSES)[number]
export interface ExploreLensState extends ExploreState {
  lens: ExploreLens
}

/** Integration seam only. The rendered workspace must opt in when its lenses are available. */
export function parseExploreLensState(location: string): ExploreLensState {
  const url = new URL(location, 'https://workspace.invalid')
  if (url.searchParams.getAll('lens').length > 1) throw new Error('Ambiguous Explore lens')
  const lens = url.searchParams.get('lens') ?? 'evidence'
  if (!EXPLORE_LENSES.some((value) => value === lens)) throw new Error('Unknown Explore lens')
  url.searchParams.delete('lens')
  return { ...parseExploreState(`${url.pathname}${url.search}`), lens: lens as ExploreLens }
}

export function exploreLensHref(state: ExploreLensState): string {
  if (!EXPLORE_LENSES.some((value) => value === state.lens)) throw new Error('Unknown Explore lens')
  const url = new URL(exploreHref(state), 'https://workspace.invalid')
  if (state.lens !== 'evidence') url.searchParams.set('lens', state.lens)
  return `${url.pathname}${url.search}`
}

/** Explicit capability list prevents navigation to an unmounted or unavailable lens. */
export function navigateExploreLens(state: ExploreLensState, role: Role, available: readonly ExploreLens[]) {
  if (!roleAtLeast(role, state.lens === 'evidence' ? 'user' : 'maintainer'))
    throw new Error('Explore is not permitted for this role')
  const href = exploreLensHref(state)
  if (!available.includes(state.lens)) throw new Error('This Explore lens is unavailable')
  if (state.lens === 'evidence') {
    navigateExplore(state, role)
    return state
  }
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.pushState({}, '', href)
    window.dispatchEvent(new Event('history-state-changed'))
  }
  return state
}
