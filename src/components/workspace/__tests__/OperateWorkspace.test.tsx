// spec: WEBUI-APPS-R049.1.4
import { useState } from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { operateApi } from '@/lib/operate-workspace'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import OperateWorkspace from '../OperateWorkspace'
const state = vi.hoisted(() => ({
  tools: [] as WebMcpToolDefinition[],
  needsSignIn: false,
  role: 'reader',
  csrf: 'session-a',
  roles: ['mcp:discover'],
}))
vi.mock('@/components/workspace/OperateReadinessPanel', () => ({ OperateReadinessPanel: () => null }))
vi.mock('@/lib/operate-catalog', () => ({
  readOperateCatalog: vi.fn(async () => ({ source: 'epistemic_graph', servers: [], components: [] })),
}))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    identity: {
      userKey: 'a',
      role: state.role,
      needsSignIn: state.needsSignIn,
      raw: { tenant: 't', csrf_token: state.csrf, roles: state.roles },
    },
    loading: false,
  }),
}))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    state.tools = tools
  },
}))
vi.mock('@/lib/operate-workspace', async (original) => ({
  ...(await original<object>()),
  operateApi: {
    status: vi.fn(async () => ({
      value: { children: { source: { state: 'running', mounted_tools: 2 }, other: { state: 'stopped' } } },
    })),
    catalog: vi.fn(async () => ({
      value: {
        items: [{ id: 'tool-a', server: 'source', kind: 'tool', name: 'Read records', description: 'Read a record.' }],
        next_cursor: null,
      },
    })),
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
  state.tools = []
  state.needsSignIn = false
  state.role = 'reader'
  state.csrf = 'session-a'
  state.roles = ['mcp:discover']
  window.history.replaceState({}, '', '/workspace/operate')
})
describe('Operate retained composition', () => {
  it.each(['session', 'scopes'])(
    'discards earlier admission data and stale tool handles after same-principal %s change',
    async (change) => {
      function Harness() {
        const [n, setN] = useState(0)
        return (
          <>
            <button
              onClick={() => {
                setN(n + 1)
              }}
            >
              Update identity
            </button>
            <OperateWorkspace />
          </>
        )
      }
      renderWithProviders(<Harness />)
      await screen.findByRole('link', { name: 'source' })
      const stale = state.tools[0]
      vi.mocked(operateApi.status).mockImplementationOnce(
        () =>
          new Promise(() => {
            /* Deliberately keep the new authority response pending. */
          }),
      )
      vi.mocked(operateApi.catalog).mockImplementationOnce(
        () =>
          new Promise(() => {
            /* Deliberately keep the new authority response pending. */
          }),
      )
      if (change === 'session') state.csrf = 'session-b'
      else state.roles = ['mcp:read']
      fireEvent.click(screen.getByRole('button', { name: 'Update identity' }))
      expect(screen.queryByRole('link', { name: 'source' })).not.toBeInTheDocument()
      await expect(
        stale.execute({ server: 'source', item: null, q: '' }, { signal: new AbortController().signal }),
      ).rejects.toThrow('admission has changed')
    },
  )
  it('refuses retained tool handles after a failed fleet refresh', async () => {
    renderWithProviders(<OperateWorkspace />)
    await screen.findByRole('link', { name: 'source' })
    const stale = state.tools[0]
    vi.mocked(operateApi.status).mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh fleet' }))
    await screen.findByRole('alert')
    await expect(
      stale.execute({ server: 'source', item: null, q: '' }, { signal: new AbortController().signal }),
    ).rejects.toThrow('outside loaded fleet')
  })
  it('labels cursor cycles as a partial preview', async () => {
    vi.mocked(operateApi.catalog)
      .mockResolvedValueOnce({ value: { items: [], next_cursor: 'same' } })
      .mockResolvedValueOnce({ value: { items: [], next_cursor: 'same' } })
    renderWithProviders(<OperateWorkspace />)
    fireEvent.click(await screen.findByRole('link', { name: 'source' }))
    const next = screen.getByRole('button', { name: 'Load more capabilities' })
    await vi.waitFor(() => expect(next).toBeEnabled())
    fireEvent.click(next)
    expect(await screen.findByText(/pagination repeated a cursor/)).toBeVisible()
    expect(next).toBeDisabled()
  })
  it('labels a short tenth page as a page cap, not 1000 records', async () => {
    for (let page = 0; page < 10; page++)
      vi.mocked(operateApi.catalog).mockResolvedValueOnce({ value: { items: [], next_cursor: `cursor-${page}` } })
    renderWithProviders(<OperateWorkspace />)
    fireEvent.click(await screen.findByRole('link', { name: 'source' }))
    const next = screen.getByRole('button', { name: 'Load more capabilities' })
    for (let page = 1; page < 10; page++) {
      await vi.waitFor(() => expect(next).toBeEnabled())
      fireEvent.click(next)
      await screen.findByText(`Loaded 0 capabilities across ${page + 1} catalog pages.`)
    }
    expect(await screen.findByText(/10-page preview limit/)).toBeVisible()
    expect(next).toBeDisabled()
  })
  it('preserves filter input focus while changing the typed query', async () => {
    renderWithProviders(<OperateWorkspace />)
    await screen.findByRole('link', { name: 'source' })
    const input = screen.getByRole('textbox', { name: 'Filter fleet children' })
    input.focus()
    fireEvent.change(input, { target: { value: 's' } })
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'so' } })
    expect(input).toHaveFocus()
    expect(input).toHaveValue('so')
  })
  it('retains fleet and filter through connector/capability detail using native links', async () => {
    renderWithProviders(<OperateWorkspace />)
    const source = await screen.findByRole('link', { name: 'source' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter fleet children' }), { target: { value: 'sou' } })
    fireEvent.click(source)
    const item = await screen.findByRole('link', { name: 'Read records' })
    expect(item.getAttribute('href')).toContain('q=sou')
    fireEvent.click(item)
    expect(await screen.findByRole('article', { name: 'Capability detail' })).toHaveTextContent('Read a record.')
    expect(screen.getByRole('link', { name: 'source' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Filter fleet children' })).toHaveValue('sou')
    expect(screen.queryByRole('button', { name: /^Execute$/ })).not.toBeInTheDocument()
  })
  it('manual and WebMCP use the same validated destination', async () => {
    renderWithProviders(<OperateWorkspace />)
    await screen.findByRole('link', { name: 'source' })
    await act(async () => {
      await state.tools[0].execute(
        { server: 'source', item: 'tool-a', q: '' },
        { signal: new AbortController().signal },
      )
    })
    expect(await screen.findByRole('article', { name: 'Capability detail' })).toBeVisible()
    await expect(
      state.tools[0].execute({ server: 'other', item: 'tool-a', q: '' }, { signal: new AbortController().signal }),
    ).rejects.toThrow()
    await expect(
      state.tools[0].execute({ server: 'unknown', item: null, q: '' }, { signal: new AbortController().signal }),
    ).rejects.toThrow()
  })
  it('refuses unsigned identity before issuing reads', () => {
    state.needsSignIn = true
    renderWithProviders(<OperateWorkspace />)
    expect(screen.getByRole('alert')).toHaveTextContent('not available')
    expect(operateApi.status).not.toHaveBeenCalled()
  })
  it('does not convert failed status into an empty healthy fleet', async () => {
    vi.mocked(operateApi.status).mockRejectedValueOnce(new Error('unavailable'))
    renderWithProviders(<OperateWorkspace />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed')
    expect(screen.queryByText('No matching fleet children.')).not.toBeInTheDocument()
  })
  it('rejects malformed routes without fetching', () => {
    window.history.replaceState({}, '', '/workspace/operate?item=orphan')
    renderWithProviders(<OperateWorkspace />)
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid Operate')
    expect(operateApi.status).not.toHaveBeenCalled()
    expect(state.tools).toEqual([])
  })
})
