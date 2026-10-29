import { describe, expect, it } from 'vitest'
import { applyEdit, openDocument, redo, undo } from '../history'
import { addPanel, createDashboard } from '../model'

// spec: OVERSTORY-DASH-R008
describe('undo history and activity log (OVERSTORY-DASH-R008)', () => {
  it('logs the actor, undoes and redoes agent edits', () => {
    const base = createDashboard('d')
    let state = openDocument(base)
    const after = addPanel(base, { title: 'A', viz: 'table', query: 'q' }).doc
    state = applyEdit(state, 'agent', 'Added panel "A"', after)
    expect(state.log.at(-1)).toMatchObject({ actor: 'agent', label: 'Added panel "A"' })
    state = undo(state)
    expect(state.doc?.panels).toHaveLength(0)
    state = redo(state)
    expect(state.doc?.panels).toHaveLength(1)
  })

  it('clears redo after a new edit and ignores empty undo', () => {
    const base = createDashboard('d')
    let state = undo(openDocument(base))
    expect(state.doc).toBe(base)
    state = applyEdit(state, 'user', 'one', addPanel(base, { title: 'A', viz: 'table', query: 'q' }).doc)
    state = undo(state)
    state = applyEdit(state, 'user', 'two', addPanel(base, { title: 'B', viz: 'table', query: 'q' }).doc)
    expect(state.future).toHaveLength(0)
  })
})
