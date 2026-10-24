// spec: WEBUI-APPS-R049.1.4
// spec: WEBUI-APPS-R049.1.3
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceContextRail } from '../WorkspaceContextRail'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
function Surface() {
  const location = useWorkspaceLocation()
  return (
    <WorkspaceContextRail
      role="user"
      active={
        location.startsWith('/workspace/work')
          ? 'work'
          : location.startsWith('/workspace/operate')
            ? 'operate'
            : 'explore'
      }
    />
  )
}
afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})
describe('anchored workspace context rail', () => {
  it('retains each validated context destination across tab switches and exposes the same native href', () => {
    window.history.replaceState({}, '', '/workspace/work?task=task-a&run=trace-a&node=node-a')
    render(<Surface />)
    fireEvent.click(screen.getByRole('link', { name: 'explore' }))
    expect(window.location.pathname).toBe('/workspace/explore')
    act(() => {
      window.history.pushState({}, '', '/workspace/explore?q=retained&entity=record-a')
      window.dispatchEvent(new Event('history-state-changed'))
    })
    expect(screen.getByRole('link', { name: 'work' })).toHaveAttribute(
      'href',
      '/workspace/work?task=task-a&run=trace-a&node=node-a',
    )
    fireEvent.click(screen.getByRole('link', { name: 'work' }))
    expect(window.location.search).toBe('?task=task-a&run=trace-a&node=node-a')
    expect(screen.getByRole('link', { name: 'explore' })).toHaveAttribute(
      'href',
      '/workspace/explore?q=retained&entity=record-a',
    )
    fireEvent.click(screen.getByRole('link', { name: 'explore' }))
    expect(window.location.search).toBe('?q=retained&entity=record-a')
    fireEvent.click(screen.getByRole('link', { name: 'operate' }))
    act(() => {
      window.history.pushState({}, '', '/workspace/operate?server=server-a&item=tool-a&q=retained')
      window.dispatchEvent(new Event('history-state-changed'))
    })
    fireEvent.click(screen.getByRole('link', { name: 'work' }))
    expect(screen.getByRole('link', { name: 'operate' })).toHaveAttribute(
      'href',
      '/workspace/operate?server=server-a&item=tool-a&q=retained',
    )
    fireEvent.click(screen.getByRole('link', { name: 'operate' }))
    expect(window.location.search).toBe('?server=server-a&item=tool-a&q=retained')
    expect(screen.getByRole('navigation', { name: 'Primary workspace contexts' }).closest('header')).toHaveClass(
      'shrink-0',
    )
  })
  it('falls back to retained evidence when a remembered query lens loses maintainer permission', () => {
    window.history.replaceState({}, '', '/workspace/explore?q=kept&lens=query')
    const view = render(<WorkspaceContextRail role="maintainer" active="explore" />)
    expect(screen.getByRole('link', { name: 'explore' })).toHaveAttribute(
      'href',
      '/workspace/explore?q=kept&lens=query',
    )
    view.rerender(<WorkspaceContextRail role="user" active="explore" />)
    expect(screen.getByRole('link', { name: 'explore' })).toHaveAttribute('href', '/workspace/explore?q=kept')
    fireEvent.click(screen.getByRole('link', { name: 'explore' }))
    expect(window.location.search).toBe('?q=kept')
  })
  it('does not intercept modified links or navigate an insufficient role', () => {
    window.history.replaceState({}, '', '/workspace/work')
    const view = render(<WorkspaceContextRail role="user" active="work" />)
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(screen.getByRole('link', { name: 'explore' }), { ctrlKey: true })
    expect(push).not.toHaveBeenCalled()
    view.rerender(<WorkspaceContextRail role="reader" active="work" />)
    fireEvent.click(screen.getByRole('link', { name: 'explore' }))
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'explore' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('link', { name: 'operate' }))
    expect(window.location.pathname).toBe('/workspace/operate')
    expect(screen.getByRole('link', { name: 'Arbora' })).toHaveAttribute('href', '/workspace/operate')
    fireEvent.click(screen.getByRole('link', { name: 'Arbora' }))
    expect(window.location.pathname).toBe('/workspace/operate')
  })
})

// spec: WEBUI-DESIGN-R004.1.1
it('keeps primary navigation inline instead of placing it behind a compact disclosure', () => {
  render(<WorkspaceContextRail role="user" active="explore" />)
  const navigation = screen.getByRole('navigation', { name: 'Primary workspace contexts' })
  expect(navigation.closest('.workspace-header-disclosure')).toBeNull()
  expect(screen.queryByRole('button', { name: 'More workspace controls' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument()
})
