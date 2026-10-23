// spec: WEBUI-APPS-R049.1.6
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/lib/nav-registry'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import {
  WorkspaceCommandPalette,
  WorkspaceCommandsProvider,
  useWorkspaceCommands,
  type WorkspaceCommand,
} from '../WorkspaceCommands'
const tools = vi.hoisted(() => ({ current: [] as WebMcpToolDefinition[] }))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (value: WebMcpToolDefinition[]) => {
    tools.current = value
  },
}))
const loaded = [{ id: 'a', label: 'Evidence Alpha', href: '/workspace/explore?q=kept&entity=a' }]
function Loaded({ entries }: { entries: WorkspaceCommand[] }) {
  useWorkspaceCommands(entries, 'tenant-a')
  return null
}
function Surface({
  owner = 'tenant-a',
  role = 'user',
  entries = loaded,
  enabled = true,
}: {
  owner?: string
  role?: Role
  entries?: WorkspaceCommand[]
  enabled?: boolean
}) {
  return (
    <WorkspaceCommandsProvider owner={owner} role={role} enabled={enabled}>
      <WorkspaceCommandPalette />
      <Loaded entries={entries} />
    </WorkspaceCommandsProvider>
  )
}
function commandId(index: number) {
  return (tools.current[0].inputSchema as { properties: { commandId: { enum: string[] } } }).properties.commandId.enum[
    index
  ]
}
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Find destination' }))
}
afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})
describe('bounded workspace commands', () => {
  it('searches loaded evidence and uses native typed destinations', () => {
    render(<Surface />)
    open()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: 'Work' })).toHaveAttribute('href', '/workspace/work')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search destinations' }), { target: { value: 'Alpha' } })
    const link = screen.getByRole('link', { name: 'Evidence Alpha' })
    expect(link).toHaveAttribute('href', loaded[0].href)
    fireEvent.click(link)
    expect(window.location.pathname + window.location.search).toBe(loaded[0].href)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('preserves modified links and uses the same semantic tool dispatcher', async () => {
    render(<Surface />)
    open()
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(screen.getByRole('link', { name: 'Evidence Alpha' }), { ctrlKey: true })
    expect(push).not.toHaveBeenCalled()
    await act(async () => {
      await tools.current[0].execute({ commandId: commandId(3) }, { signal: new AbortController().signal })
    })
    expect(window.location.pathname + window.location.search).toBe(loaded[0].href)
  })
  it('filters denied roles, arbitrary paths and malformed destinations', () => {
    render(
      <Surface
        role="reader"
        entries={[
          ...loaded,
          { id: 'x', label: 'Outside', href: '//evil.invalid/' },
          { id: 'y', label: 'Legacy', href: '/configuration' },
        ]}
      />,
    )
    open()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Operate' })).toBeInTheDocument()
  })
  it('withdraws denied-session commands and rejects held handles', async () => {
    const view = render(<Surface />)
    const held = tools.current[0]
    const oldId = commandId(0)
    view.rerender(<Surface enabled={false} />)
    expect(tools.current).toHaveLength(0)
    await expect(held.execute({ commandId: oldId }, { signal: new AbortController().signal })).rejects.toThrow('stale')
  })
  it('retires held handles and dialog state on owner change', async () => {
    const view = render(<Surface />)
    open()
    const held = tools.current[0]
    const oldId = commandId(0)
    view.rerender(<Surface owner="tenant-b" entries={[]} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(held.execute({ commandId: oldId }, { signal: new AbortController().signal })).rejects.toThrow('stale')
    open()
    expect(screen.queryByRole('link', { name: 'Evidence Alpha' })).not.toBeInTheDocument()
  })
  it('does not reassign old loaded entries to a new owner', () => {
    const view = render(<Surface />)
    view.rerender(<Surface owner="tenant-b" />)
    open()
    expect(screen.queryByRole('link', { name: 'Evidence Alpha' })).not.toBeInTheDocument()
  })
  it('gives blank result labels an accessible identity fallback', () => {
    render(<Surface entries={[{ id: 'object-a', label: '   ', href: '/workspace/explore?entity=object-a' }]} />)
    open()
    expect(screen.getByRole('link', { name: 'object-a' })).toBeInTheDocument()
  })
  it('paginates tool results below the output bound without query URLs', async () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      label: '🌳'.repeat(256),
      href: `/workspace/explore?q=private-query&entity=${index}`,
    }))
    render(<Surface entries={entries} />)
    const catalog = tools.current[1]
    const page = await catalog.execute({ offset: 3 }, { signal: new AbortController().signal })
    const text = JSON.stringify(page)
    expect(new TextEncoder().encode(text).length).toBeLessThan(1500)
    expect(text).not.toContain('private-query')
    expect(page).toMatchObject({ total: 103, nextOffset: 8 })
  })
  it('rejects a previously listed identifier through the new selection handle', async () => {
    const view = render(<Surface />)
    const oldId = commandId(3)
    view.rerender(<Surface entries={[{ id: 'b', label: 'Other', href: '/workspace/explore?entity=b' }]} />)
    await expect(
      tools.current[0].execute({ commandId: oldId }, { signal: new AbortController().signal }),
    ).rejects.toThrow()
    expect(window.location.pathname).toBe('/')
  })
  it('repairs invalid UTF-16 labels in tool results', async () => {
    render(<Surface entries={[{ id: 'a', label: 'bad\ud800label', href: '/workspace/explore?entity=a' }]} />)
    const page = await tools.current[1].execute({ offset: 3 }, { signal: new AbortController().signal })
    expect(JSON.stringify(page)).not.toContain('\\ud800')
  })
  it('retires old context handles and closes search on navigation', async () => {
    render(<Surface />)
    open()
    const held = tools.current[0]
    const oldId = commandId(0)
    act(() => {
      window.history.pushState({}, '', '/workspace/operate')
      window.dispatchEvent(new Event('history-state-changed'))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(held.execute({ commandId: oldId }, { signal: new AbortController().signal })).rejects.toThrow('stale')
  })
  it('supports the keyboard shortcut, focusable search and explicit dismissal', () => {
    render(<Surface />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('textbox', { name: 'Search destinations' })).toHaveFocus()
    expect(screen.getByRole('dialog')).toHaveClass('max-h-[85dvh]', 'overflow-auto')
    fireEvent.click(screen.getByRole('button', { name: 'Close destination search' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
