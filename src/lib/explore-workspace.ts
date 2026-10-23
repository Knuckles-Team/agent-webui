import { roleAtLeast, type Role } from '@/lib/nav-registry'

export const EXPLORE_TOOLS = ['overview', 'relationships', 'history'] as const
export type ExploreTool = (typeof EXPLORE_TOOLS)[number]
export interface ExploreState {
  entity: string | null
  tool: ExploreTool
  query?: string
}
export const EXPLORE_PATH = '/workspace/explore'

export function validEntityId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
}

export function parseExploreState(location: string): ExploreState {
  const url = new URL(location, 'https://workspace.invalid')
  // Fragments are not semantic workspace state; never copy them into typed transitions.
  if (
    Array.from(url.searchParams.keys()).some((key) => key !== 'entity' && key !== 'tool' && key !== 'q') ||
    url.searchParams.getAll('entity').length > 1 ||
    url.searchParams.getAll('tool').length > 1 ||
    url.searchParams.getAll('q').length > 1
  ) {
    throw new Error('Unknown or ambiguous workspace state')
  }
  const query = url.searchParams.get('q')
  if (query !== null && query.length > 4096) throw new Error('Collection query is too long')
  const entity = url.searchParams.get('entity')
  const tool = url.searchParams.get('tool') ?? 'overview'
  if (
    url.pathname !== EXPLORE_PATH ||
    (entity !== null && !validEntityId(entity)) ||
    !EXPLORE_TOOLS.some((value) => value === tool) ||
    (!entity && tool !== 'overview')
  ) {
    throw new Error('This workspace destination is invalid. Return to the collection to continue.')
  }
  return { entity, tool: tool as ExploreTool, ...(query !== null ? { query } : {}) }
}

export function exploreHref(state: ExploreState): string {
  const url = new URL(EXPLORE_PATH, 'https://workspace.invalid')
  if (state.query !== undefined) url.searchParams.set('q', state.query)
  if (state.entity) url.searchParams.set('entity', state.entity)
  if (state.tool !== 'overview') url.searchParams.set('tool', state.tool)
  parseExploreState(`${url.pathname}${url.search}`)
  return `${url.pathname}${url.search}`
}

/** One typed semantic transition for links, keyboard controls and mounted WebMCP. */
export function navigateExplore(state: ExploreState, role: Role): ExploreState {
  if (!roleAtLeast(role, 'user')) throw new Error('Explore is not permitted for this role')
  const href = exploreHref(state)
  if (`${window.location.pathname}${window.location.search}` === href) return state
  window.history.pushState({}, '', href)
  window.dispatchEvent(new Event('history-state-changed'))
  return state
}
