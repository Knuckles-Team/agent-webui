// spec: WEBUI-DESIGN-R005.1
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceCommandPalette, WorkspaceCommandsProvider } from '../WorkspaceCommands'
import { WorkspaceHeaderDisclosure } from '../WorkspaceHeaderDisclosure'

vi.mock('@/lib/webmcp/provider', () => ({ useWebMcpToolSet: () => undefined }))

function setup() {
  const view = (showTask: boolean) => (
    <WorkspaceCommandsProvider owner="focus-test" role="user">
      {showTask && <input aria-label="Native task" />}
      <WorkspaceHeaderDisclosure id="workspace-more-options" label="More workspace options" caption="More">
        <WorkspaceCommandPalette />
      </WorkspaceHeaderDisclosure>
    </WorkspaceCommandsProvider>
  )
  const { rerender } = render(view(true))
  const trigger = screen.getByRole('button', { name: 'Find destination' })
  const more = screen.getByRole('button', { name: 'More workspace options' })
  const task = screen.getByRole('textbox', { name: 'Native task' })
  let narrow = true
  // jsdom has no layout. Model only the responsive trigger visibility;
  // use the real mounted Radix dialog and its actual focus lifecycle.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    const visible = this !== trigger || !narrow || more.getAttribute('aria-expanded') === 'true'
    return (visible ? [new DOMRect(0, 0, 100, 40)] : []) as unknown as DOMRectList
  })
  return {
    trigger,
    more,
    task,
    removeTask: () => {
      rerender(view(false))
    },
    setNarrow: (value: boolean) => {
      narrow = value
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('palette cancellation focus', () => {
  it.each(['Escape', 'Close'])('restores native task focus after narrow shortcut %s', async (close) => {
    const { task, more } = setup()
    task.focus()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    if (close === 'Escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    else fireEvent.click(screen.getByRole('button', { name: 'Close destination search' }))
    await waitFor(() => expect(task).toHaveFocus())
    expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  it('returns to visible More when the desktop opener becomes hidden during the dialog', async () => {
    const { trigger, more, setNarrow } = setup()
    setNarrow(false)
    trigger.focus()
    fireEvent.click(trigger)
    setNarrow(true)
    fireEvent(window, new Event('resize'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(more).toHaveFocus())
    expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  it('preserves the deliberately open compact disclosure when its trigger opened the palette', async () => {
    const { trigger, more } = setup()
    fireEvent.click(more)
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Close destination search' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(more).toHaveAttribute('aria-expanded', 'true')
  })

  it('uses visible More when the shortcut opener was removed', async () => {
    const { task, more, removeTask } = setup()
    task.focus()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    removeTask()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(more).toHaveFocus())
  })

  it('does not steal focus assigned by the native destination after selection', async () => {
    const { task, trigger, setNarrow } = setup()
    setNarrow(false)
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('link', { name: /^Chat & tasks$/ }))
    task.focus()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(task).toHaveFocus()
    expect(window.location.pathname).toBe('/workspace/work')
  })
})
