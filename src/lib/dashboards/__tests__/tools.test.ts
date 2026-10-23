import { describe, expect, it } from 'vitest'
import { WEBMCP_OUTPUT_BYTE_BUDGET } from '@/lib/webmcp/validation'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { applyEdit, openDocument, undo, type HistoryState } from '../history'
import { createDashboard, type Dashboard } from '../model'
import type { QueryOutcome } from '../query'
import { createDashboardTools, DASHBOARD_TOOL_PREFIX, type DashboardController } from '../tools'

function harness(options: { approve?: boolean; outcome?: QueryOutcome } = {}) {
  let state: HistoryState = openDocument(null)
  const asked: string[] = []
  const controller: DashboardController = {
    current: () => state.doc,
    create: (title) => {
      const doc = createDashboard(title)
      state = applyEdit(state, 'agent', 'create', doc)
      return doc
    },
    edit: (label, change) => {
      if (!state.doc) throw new Error('none')
      const after = change(state.doc)
      state = applyEdit(state, 'agent', label, after)
      return after
    },
    confirm: (message) => {
      asked.push(message)
      return Promise.resolve(options.approve ?? false)
    },
    runQuery: () => Promise.resolve(options.outcome ?? { state: 'empty', note: 'none' }),
    listSources: () => Promise.resolve([{ name: 'Agent', count: 3 }]),
  }
  const tools = new Map<string, WebMcpToolDefinition>(createDashboardTools(controller).map((t) => [t.name, t]))
  const call = async (name: string, input: unknown): Promise<Record<string, unknown>> => {
    const tool = tools.get(`${DASHBOARD_TOOL_PREFIX}${name}`)
    if (!tool) throw new Error(`no tool ${name}`)
    return (await tool.execute(input, { signal: new AbortController().signal })) as Record<string, unknown>
  }
  return {
    call,
    tools,
    asked,
    doc: (): Dashboard | null => state.doc,
    state: () => state,
    undoAll: () => {
      state = undo(state)
    },
  }
}

// spec: WEBUI-DASH-R007
describe('dashboard WebMCP tools (WEBUI-DASH-R007)', () => {
  it('registers the seven tools with strict capability metadata', () => {
    const { tools } = harness()
    expect([...tools.keys()].map((n) => n.replace(DASHBOARD_TOOL_PREFIX, '')).sort()).toEqual([
      'add_panel',
      'create',
      'list_data_sources',
      'preview_query',
      'remove_panel',
      'set_layout',
      'update_panel',
    ])
    expect(tools.get(`${DASHBOARD_TOOL_PREFIX}preview_query`)?.annotations?.readOnlyHint).toBe(true)
    expect(tools.get(`${DASHBOARD_TOOL_PREFIX}add_panel`)?.capability?.mutationClass).toBe('local-ui-mutation')
  })

  it('creates a dashboard, adds, updates and lays out a panel', async () => {
    const h = harness()
    expect(await h.call('add_panel', { title: 'x', viz: 'table', query: 'q' })).toMatchObject({ ok: false })
    expect(await h.call('create', { title: 'Ops' })).toMatchObject({ ok: true, dashboard_id: 'ops', revision: 0 })
    expect(
      await h.call('add_panel', { title: 'Agents', viz: 'bar', query: 'MATCH (:Agent) |> LIMIT 5', x_column: 'name' }),
    ).toMatchObject({ ok: true, panel_id: 'agents', panels: 1, revision: 1 })
    expect(await h.call('update_panel', { panel_id: 'agents', viz: 'line' })).toMatchObject({ ok: true, revision: 2 })
    expect(await h.call('set_layout', { layouts: [{ panel_id: 'agents', x: 6, y: 0, w: 6, h: 3 }] })).toMatchObject({
      ok: true,
    })
    expect(h.doc()?.panels[0]).toMatchObject({ viz: 'line', options: { x: 'name' }, layout: { x: 6 } })
    expect(h.state().log.every((e) => e.actor === 'agent')).toBe(true)
  })

  it('rejects invalid input and returns typed refusals', async () => {
    const h = harness()
    await h.call('create', { title: 'Ops' })
    await expect(h.call('add_panel', { title: 'x', viz: 'pie', query: 'q' })).rejects.toThrow()
    await expect(h.call('create', { title: 'x', extra: 1 })).rejects.toThrow()
    expect(await h.call('update_panel', { panel_id: 'missing', title: 'y' })).toMatchObject({ ok: false })
    expect(await h.call('set_layout', { layouts: [{ panel_id: 'zz', x: 0, y: 0, w: 1, h: 1 }] })).toMatchObject({
      ok: false,
    })
  })

  it('previews queries and lists sources within the output budget', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ name: `row-${String(i)}`.repeat(30), n: i }))
    const h = harness({ outcome: { state: 'ok', data: { columns: ['name', 'n'], rows } } })
    const preview = await h.call('preview_query', { query: 'MATCH (:A) |> LIMIT 50' })
    expect(preview).toMatchObject({ ok: true, row_count: 50, columns: ['name', 'n'] })
    expect(JSON.stringify(preview).length).toBeLessThan(WEBMCP_OUTPUT_BYTE_BUDGET)
    expect(await h.call('list_data_sources', {})).toMatchObject({
      query_language: 'uql',
      node_types: [{ name: 'Agent', count: 3 }],
    })
    const failing = harness({ outcome: { state: 'error', error: 'denied' } })
    expect(await failing.call('preview_query', { query: 'q' })).toMatchObject({ ok: false, error: 'denied' })
  })
})

// spec: WEBUI-DASH-R009
describe('destructive agent changes (WEBUI-DASH-R009)', () => {
  async function withPanel(approve: boolean) {
    const h = harness({ approve })
    await h.call('create', { title: 'Ops' })
    await h.call('add_panel', { title: 'Agents', viz: 'table', query: 'q' })
    return h
  }

  it('removes the panel only after approval', async () => {
    const h = await withPanel(true)
    expect(await h.call('remove_panel', { panel_id: 'agents' })).toMatchObject({ ok: true, panels: 0 })
    expect(h.asked).toHaveLength(1)
  })

  it('leaves the dashboard unchanged on denial', async () => {
    const h = await withPanel(false)
    const before = h.doc()
    expect(await h.call('remove_panel', { panel_id: 'agents' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('denied'),
    })
    expect(h.doc()).toBe(before)
  })

  it('refuses a missing panel without asking', async () => {
    const h = await withPanel(true)
    expect(await h.call('remove_panel', { panel_id: 'nope' })).toMatchObject({ ok: false })
    expect(h.asked).toHaveLength(0)
  })
})
