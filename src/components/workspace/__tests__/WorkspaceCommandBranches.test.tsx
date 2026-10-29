// spec: OVERSTORY-DESIGN-R005.1
// spec: OVERSTORY-APPS-R046.2.2
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceCommandBranches } from '../WorkspaceCommandBranches'
import { workspaceCommandBranches } from '../workspace-command-branches'

const entries = [
  { id: 'operate', label: 'Operate', href: '/workspace/operate' },
  { id: 'server:catalog', label: 'Fleet: catalog', href: '/workspace/operate?server=catalog' },
  { id: 'capability:search', label: 'Capability: Search', href: '/workspace/operate?server=catalog&item=search' },
]

describe('loaded workspace branches', () => {
  it('drills into confirmed relationships without navigating and restores breadcrumb focus', () => {
    const select = vi.fn()
    render(<WorkspaceCommandBranches entries={entries} onSelect={select} visible />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse Operate' }))
    expect(screen.getByRole('heading', { name: 'Operate destinations' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Browse Fleet: catalog' }))
    expect(screen.getByRole('heading', { name: 'Fleet: catalog destinations' })).toHaveFocus()
    expect(select).not.toHaveBeenCalled()
    const leaf = screen.getByRole('link', { name: 'Capability: Search' })
    expect(leaf).toHaveAttribute('href', entries[2].href)
    fireEvent.click(leaf, { ctrlKey: true })
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(leaf)
    expect(select).toHaveBeenCalledWith(entries[2].href)
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Workspace' }))
    expect(screen.getByRole('heading', { name: 'Workspace contexts' })).toHaveFocus()
  })

  it('retires a removed branch and its descendants without retaining stale links', () => {
    const view = render(<WorkspaceCommandBranches entries={entries} onSelect={vi.fn()} visible />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse Operate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse Fleet: catalog' }))
    view.rerender(<WorkspaceCommandBranches entries={entries.slice(0, 1)} onSelect={vi.fn()} visible />)
    expect(screen.getByRole('heading', { name: 'Workspace contexts' })).toHaveFocus()
    expect(screen.queryByRole('link', { name: 'Capability: Search' })).not.toBeInTheDocument()
  })

  it('never invents a server or trace relationship from label text', () => {
    const roots = workspaceCommandBranches([
      entries[0],
      entries[2],
      { id: 'work', label: 'Work', href: '/workspace/work' },
      { id: 'task:a', label: 'Task: same', href: '/workspace/work?task=a' },
      { id: 'trace:a', label: 'Trace: same', href: '/workspace/work?run=a' },
      { id: 'node:a', label: 'Trace node: same', href: '/workspace/work?run=a&node=a' },
    ])
    expect(roots[0].children.map((node) => node.command.href)).toEqual([entries[2].href])
    expect(roots[1].children.map((node) => node.command.id)).toEqual(['task:a', 'trace:a'])
    expect(roots[1].children[0].children).toEqual([])
    expect(roots[1].children[1].children[0].command.id).toBe('node:a')
  })

  it('retires hidden branches without stealing focus from search', () => {
    function Searchable({ available = entries, visible = true }) {
      return (
        <>
          <input aria-label="Search destinations" />
          <div hidden={!visible}>
            <WorkspaceCommandBranches entries={available} onSelect={vi.fn()} visible={visible} />
          </div>
        </>
      )
    }
    const view = render(<Searchable />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse Operate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse Fleet: catalog' }))
    screen.getByRole('textbox').focus()
    view.rerender(<Searchable available={entries.slice(0, 1)} visible={false} />)
    expect(screen.getByRole('textbox')).toHaveFocus()
    view.rerender(<Searchable available={entries.slice(0, 1)} />)
    expect(screen.getByRole('heading', { name: 'Workspace contexts' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Capability: Search' })).not.toBeInTheDocument()
  })

  it('keeps the same entity reached from distinct loaded contexts as separate destinations', () => {
    const roots = workspaceCommandBranches([
      { id: 'explore', label: 'Explore', href: '/workspace/explore' },
      { id: 'entity:a', label: 'Shared entity', href: '/workspace/explore?q=first&entity=a' },
      { id: 'entity:a', label: 'Shared entity', href: '/workspace/explore?q=second&entity=a' },
    ])
    expect(roots[0].children).toHaveLength(2)
    expect(new Set(roots[0].children.map((node) => node.command.href)).size).toBe(2)
  })
})
