import { describe, expect, it } from 'vitest'
import {
  addPanel,
  createDashboard,
  DashboardError,
  DashboardSchema,
  removePanel,
  setLayout,
  swapPanels,
  updatePanel,
} from '../model'

// spec: WEBUI-DASH-R001
describe('dashboard document model (WEBUI-DASH-R001)', () => {
  it('creates a versioned, empty document with a slug id', () => {
    const doc = createDashboard('Fleet Health!')
    expect(doc).toMatchObject({ schema_version: 1, id: 'fleet-health', revision: 0, panels: [], params: [] })
  })

  it('allocates a unique id when the slug is taken', () => {
    expect(createDashboard('Fleet', ['fleet']).id).toBe('fleet-2')
  })

  it('raises the revision by one per edit and stacks new panels without overlap', () => {
    let doc = createDashboard('d')
    const first = addPanel(doc, { title: 'Counts', viz: 'bar', query: 'MATCH (:Agent) |> LIMIT 10' })
    doc = addPanel(first.doc, { title: 'Counts', viz: 'kpi', query: 'MATCH (:Agent) |> LIMIT 1' }).doc
    expect(doc.revision).toBe(2)
    expect(doc.panels.map((p) => p.id)).toEqual(['counts', 'counts-2'])
    expect(doc.panels[1].layout.y).toBe(doc.panels[0].layout.y + doc.panels[0].layout.h)
  })

  it('updates, swaps, lays out and removes panels', () => {
    let doc = createDashboard('d')
    doc = addPanel(doc, { title: 'A', viz: 'table', query: 'q1' }).doc
    doc = addPanel(doc, { title: 'B', viz: 'line', query: 'q2' }).doc
    doc = updatePanel(doc, 'a', { viz: 'bar', options: { x: 'name' } })
    expect(doc.panels[0]).toMatchObject({ viz: 'bar', options: { x: 'name' } })
    const swapped = swapPanels(doc, 'a', 'b')
    expect(swapped.panels[0].layout).toEqual(doc.panels[1].layout)
    expect(setLayout(doc, { a: { x: 6, y: 0, w: 6, h: 2 } }).panels[0].layout.x).toBe(6)
    expect(removePanel(doc, 'a').panels.map((p) => p.id)).toEqual(['b'])
  })

  it('refuses unknown panels, off-grid layouts and unknown fields', () => {
    const doc = addPanel(createDashboard('d'), { title: 'A', viz: 'table', query: 'q' }).doc
    expect(() => removePanel(doc, 'missing')).toThrow(DashboardError)
    expect(() => setLayout(doc, { a: { x: 8, y: 0, w: 6, h: 2 } })).toThrow(/grid width/)
    expect(DashboardSchema.safeParse({ ...doc, extra: 1 }).success).toBe(false)
    expect(() => updatePanel(doc, 'a', { viz: 'pie' as never })).toThrow(DashboardError)
  })
})
