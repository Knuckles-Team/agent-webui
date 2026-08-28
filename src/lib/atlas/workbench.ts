/**
 * @file workbench.ts
 * @description The Atlas workbench state machine — pure, React-free, and testable.
 *
 * Every interaction in `/explore` (pick a modality, edit filters, type a query, click
 * a node, take a pivot) is one action against this reducer. Keeping it out of the
 * component means the interesting behaviour — "a pivot switches modality AND replaces
 * the filters AND resets the selection" — is unit-testable without a DOM.
 *
 * The reducer never calls an adapter. `compile`/`describe` are derived in the view
 * layer from `filters`, which is what keeps this file pure and its complexity flat.
 */
import type { AtlasContext, FilterSet, Pivot, Selection } from './types'
import { DEFAULT_ATLAS_CONTEXT, EMPTY_FILTER_SET } from './types'

/** The snapshot a run was launched from. Changing it is what re-runs the query. */
export interface SubmittedQuery {
  adapterId: string
  /** Raw console text when the user edited it and the adapter can `parse`; else `null`. */
  text: string | null
  filters: FilterSet
  ctx: AtlasContext
  /** Bumped on every explicit Run so an identical query can be re-run deliberately. */
  nonce: number
}

export interface AtlasState {
  adapterId: string
  filters: FilterSet
  /** Only meaningful while `consoleDirty`; otherwise the console shows `describe(compile(filters))`. */
  consoleText: string
  consoleDirty: boolean
  /** The user's explicit renderer choice, honoured whenever it still accepts. */
  rendererId: string | null
  selection: Selection | null
  ctx: AtlasContext
  submitted: SubmittedQuery | null
}

export type AtlasAction =
  | { type: 'selectAdapter'; adapterId: string }
  | { type: 'setFilters'; filters: FilterSet }
  | { type: 'setConsoleText'; text: string }
  | { type: 'setRenderer'; rendererId: string }
  | { type: 'select'; selection: Selection | null }
  | { type: 'setContext'; ctx: Partial<AtlasContext> }
  | { type: 'seedQuery'; text: string }
  | { type: 'applyPivot'; pivot: Pivot }
  | { type: 'run' }

export function initialAtlasState(adapterId: string): AtlasState {
  return {
    adapterId,
    filters: EMPTY_FILTER_SET,
    consoleText: '',
    consoleDirty: false,
    rendererId: null,
    selection: null,
    ctx: DEFAULT_ATLAS_CONTEXT,
    submitted: null,
  }
}

function nextNonce(state: AtlasState): number {
  return (state.submitted?.nonce ?? 0) + 1
}

/** Snapshot the current state as a run. `text` is sent only when the user actually edited it. */
function submit(state: AtlasState): SubmittedQuery {
  return {
    adapterId: state.adapterId,
    text: state.consoleDirty ? state.consoleText : null,
    filters: state.filters,
    ctx: state.ctx,
    nonce: nextNonce(state),
  }
}

type Handler = (state: AtlasState, action: AtlasAction) => AtlasState

/**
 * One handler per action. A dispatch table rather than a switch: the reducer itself
 * stays at complexity 1 and each behaviour is independently readable.
 */
const HANDLERS: Readonly<Record<AtlasAction['type'], Handler>> = {
  selectAdapter: (state, action) => ({
    ...state,
    adapterId: (action as { adapterId: string }).adapterId,
    // Filters are field-scoped to a modality's schema, so carrying them across would
    // silently reference fields the new modality has never heard of.
    filters: EMPTY_FILTER_SET,
    consoleText: '',
    consoleDirty: false,
    selection: null,
    submitted: null,
  }),
  setFilters: (state, action) => ({
    ...state,
    filters: (action as { filters: FilterSet }).filters,
    consoleDirty: false,
  }),
  setConsoleText: (state, action) => ({
    ...state,
    consoleText: (action as { text: string }).text,
    consoleDirty: true,
  }),
  setRenderer: (state, action) => ({ ...state, rendererId: (action as { rendererId: string }).rendererId }),
  select: (state, action) => ({ ...state, selection: (action as { selection: Selection | null }).selection }),
  setContext: (state, action) => ({
    ...state,
    ctx: { ...state.ctx, ...(action as { ctx: Partial<AtlasContext> }).ctx },
  }),
  seedQuery: (state, action) => ({ ...state, consoleText: (action as { text: string }).text, consoleDirty: true }),
  applyPivot: (state, action) => applyPivot(state, (action as { pivot: Pivot }).pivot),
  run: (state) => ({ ...state, submitted: submit(state) }),
}

/**
 * A pivot is DATA (`{targetAdapterId, filters, seedQuery}`), so applying it is a pure
 * state transition: switch modality, replace filters, seed the console if the pivot
 * carries text, drop the selection, and run immediately — a drill-through that made
 * the user press Run again would not be a drill-through.
 */
function applyPivot(state: AtlasState, pivot: Pivot): AtlasState {
  const seeded: AtlasState = {
    ...state,
    adapterId: pivot.targetAdapterId,
    filters: pivot.filters,
    consoleText: pivot.seedQuery ?? '',
    consoleDirty: pivot.seedQuery !== undefined,
    selection: null,
    rendererId: state.rendererId,
    // Kept (not nulled) so `nextNonce` keeps counting up — a pivot back to a query
    // that was already run must still re-run, and an identical cache key would not.
    submitted: state.submitted,
  }
  return { ...seeded, submitted: submit(seeded) }
}

export function atlasReducer(state: AtlasState, action: AtlasAction): AtlasState {
  return HANDLERS[action.type](state, action)
}
