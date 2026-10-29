/**
 * @file history.ts
 * @description Undo, redo and the visible activity log (OVERSTORY-DASH-R008). Agent and
 * user edits take the same path; each entry records its actor so the page can show
 * who changed what.
 */
import type { Dashboard } from './model'

export type Actor = 'user' | 'agent'

export interface Activity {
  readonly seq: number
  readonly actor: Actor
  readonly label: string
}

interface Entry extends Activity {
  readonly before: Dashboard
  readonly after: Dashboard
}

export interface HistoryState {
  readonly doc: Dashboard | null
  readonly past: readonly Entry[]
  readonly future: readonly Entry[]
  readonly log: readonly Activity[]
  readonly seq: number
}

export const MAX_HISTORY = 100
export const EMPTY_HISTORY: HistoryState = { doc: null, past: [], future: [], log: [], seq: 0 }

/** Open a dashboard; history starts fresh. */
export function openDocument(doc: Dashboard | null): HistoryState {
  return { ...EMPTY_HISTORY, doc }
}

export function applyEdit(state: HistoryState, actor: Actor, label: string, after: Dashboard): HistoryState {
  const before = state.doc
  if (!before)
    return {
      ...state,
      doc: after,
      log: [...state.log, { seq: state.seq + 1, actor, label }].slice(-MAX_HISTORY),
      seq: state.seq + 1,
    }
  const seq = state.seq + 1
  const entry: Entry = { seq, actor, label, before, after }
  return {
    doc: after,
    past: [...state.past, entry].slice(-MAX_HISTORY),
    future: [],
    log: [...state.log, { seq, actor, label }].slice(-MAX_HISTORY),
    seq,
  }
}

export function undo(state: HistoryState): HistoryState {
  const entry = state.past.at(-1)
  if (!entry) return state
  const seq = state.seq + 1
  return {
    doc: entry.before,
    past: state.past.slice(0, -1),
    future: [...state.future, entry],
    log: [...state.log, { seq, actor: 'user' as const, label: `Undid: ${entry.label}` }].slice(-MAX_HISTORY),
    seq,
  }
}

export function redo(state: HistoryState): HistoryState {
  const entry = state.future.at(-1)
  if (!entry) return state
  const seq = state.seq + 1
  return {
    doc: entry.after,
    past: [...state.past, entry],
    future: state.future.slice(0, -1),
    log: [...state.log, { seq, actor: 'user' as const, label: `Redid: ${entry.label}` }].slice(-MAX_HISTORY),
    seq,
  }
}
