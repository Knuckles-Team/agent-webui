// spec: WEBUI-APPS-R005.4, WEBUI-APPS-R049.1.3
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from '../ChatPanel'
import { PageContextProvider, type PageContextEnvelope } from '@/lib/page-context'

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0, approval: false, status: 'idle' }))
vi.mock('../../Chat', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const { createPortal } = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    default: function MockChat({
      pageContext,
      compactStatusTarget,
    }: {
      pageContext: PageContextEnvelope
      compactStatusTarget?: HTMLElement | null
    }) {
      const [instanceId] = React.useState(() => ++lifecycle.mounts)
      const [draft, setDraft] = React.useState('')
      React.useEffect(
        () => () => {
          lifecycle.unmounts += 1
        },
        [],
      )
      return (
        <div data-testid="chat-instance" data-instance={instanceId}>
          {compactStatusTarget &&
            lifecycle.status !== 'idle' &&
            createPortal(<p role="status">Reply in progress. Expand to review.</p>, compactStatusTarget)}
          <p>{pageContext.view}</p>
          <div className="chat-transcript">
            <button>Transcript action</button>
          </div>
          <div className="chat-composer-options">
            <button>Message setting</button>
          </div>
          {lifecycle.approval && (
            <div data-chat-approval-pending="" tabIndex={-1} role="group" aria-label="Required approval">
              Review parameters
            </div>
          )}
          <button
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.preventDefault()
            }}
          >
            Nested keyboard control
          </button>
          <textarea
            id="chat-message-input"
            aria-label="Message input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
            }}
          />
        </div>
      )
    },
  }
})
function surface(view = 'explore', primary = false, headerKey = 'initial') {
  return (
    <PageContextProvider route={`/workspace/${view}`} view={view}>
      <header key={headerKey}>
        <div id="workspace-assistant-entry-slot" />
      </header>
      <button>Route navigation</button>
      <ChatPanel currentView={view} contextLabel={`${view} context`} isPrimary={primary} />
    </PageContextProvider>
  )
}
beforeEach(() => {
  lifecycle.mounts = 0
  lifecycle.unmounts = 0
  lifecycle.approval = false
  lifecycle.status = 'idle'
})
describe('native workspace assistant', () => {
  it('keeps the assistant mounted with no reserved surface behind its contextual header entry', () => {
    render(surface())
    const panel = document.getElementById('workspace-assistant')!
    expect(panel).not.toBeVisible()
    expect(panel).toHaveAttribute('hidden')
    expect(panel).toHaveClass('workspace-assistant')
    expect(screen.getByLabelText('Message input')).not.toBeVisible()
    const entry = screen.getByRole('button', { name: 'Expand chat' })
    expect(entry).toHaveAttribute('aria-expanded', 'false')
    expect(entry).toHaveAttribute('aria-controls', 'workspace-assistant')
    expect(document.getElementById('workspace-assistant-entry-slot')).toContainElement(entry)
    expect(document.querySelector('#chat-panel-toggle, #agent-chat-drawer, .fixed')).toBeNull()
    expect(lifecycle.mounts).toBe(1)
  })
  it('retains the same draft and instance through every context, compatibility surface and expansion', async () => {
    const user = userEvent.setup()
    const view = render(surface())
    await user.click(screen.getByRole('button', { name: 'Expand chat' }))
    const input = screen.getByRole('textbox', { name: 'Message input' })
    await user.type(input, 'Keep this unsent draft')
    for (const next of ['work', 'operate', 'explore', 'files']) {
      view.rerender(surface(next))
      expect(screen.getByRole('textbox', { name: 'Message input' })).toBe(input)
      expect(input).toHaveValue('Keep this unsent draft')
      expect(input).toHaveFocus()
      expect(screen.getByText(`${next} context`)).toBeVisible()
      expect(screen.getByTestId('chat-instance')).toHaveAttribute('data-instance', '1')
    }
    await user.click(screen.getByRole('button', { name: 'Restore chat size' }))
    expect(screen.getByRole('button', { name: 'Expand chat' })).toHaveFocus()
    expect(input).not.toBeVisible()
    expect(input).toHaveValue('Keep this unsent draft')
    await user.click(screen.getByRole('button', { name: 'Expand chat' }))
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBe(input)
    view.rerender(surface('chat', true))
    expect(screen.getByRole('region', { name: 'Workspace assistant' })).toHaveAttribute('data-primary', 'true')
    expect(input).toHaveValue('Keep this unsent draft')
    expect(lifecycle.mounts).toBe(1)
    expect(lifecycle.unmounts).toBe(0)
  })
  it('keeps nested or unrelated Escape handling separate and returns focus to the contextual entry', async () => {
    const user = userEvent.setup()
    render(surface())
    const panel = document.getElementById('workspace-assistant')!
    await user.click(screen.getByRole('button', { name: 'Expand chat' }))
    const resize = screen.getByRole('button', { name: 'Restore chat size' })
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    consumed.preventDefault()
    fireEvent(resize, consumed)
    expect(panel).toHaveAttribute('data-expanded', 'true')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Nested keyboard control' }), { key: 'Escape' })
    expect(panel).toHaveAttribute('data-expanded', 'true')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Route navigation' }), { key: 'Escape' })
    expect(panel).toHaveAttribute('data-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Focus message input' }))
    const input = screen.getByRole('textbox', { name: 'Message input' })
    expect(input).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Expand chat' })).toHaveFocus()
    expect(panel).toHaveAttribute('data-expanded', 'false')
    expect(panel).not.toBeVisible()
    expect(input).not.toBeVisible()
  })
  it('does not steal route focus when changing presentation', () => {
    const view = render(surface())
    const navigation = screen.getByRole('button', { name: 'Route navigation' })
    navigation.focus()
    view.rerender(surface('chat', true))
    expect(navigation).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Expand chat' })).not.toBeInTheDocument()
  })
  it('shows selected context as plain text without inventing connection status', async () => {
    const user = userEvent.setup()
    render(
      <PageContextProvider
        route="/workspace/explore"
        view="explore"
        baseSelection={[{ kind: 'entity', id: 'entity-1', label: '<script>Evidence</script>' }]}
      >
        <ChatPanel currentView="explore" contextLabel="Explore" isPrimary={false} />
      </PageContextProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Expand chat' }))
    expect(screen.getByText('<script>Evidence</script>')).toBeVisible()
    expect(document.querySelector('.animate-pulse, script')).toBeNull()
  })
})

it.each(['Transcript action', 'Message setting'])(
  'returns focus to the contextual entry when closing from %s',
  async (name) => {
    const user = userEvent.setup()
    render(
      <>
        <style>{`#workspace-assistant[data-expanded='false'] :is(.chat-transcript, .chat-composer-options) { display: none; }`}</style>
        {surface()}
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Expand chat' }))
    screen.getByRole('button', { name }).focus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Expand chat' })).toHaveFocus()
    expect(document.getElementById('workspace-assistant')).toHaveAttribute('hidden')
  },
)

it('restores hidden focus on container resize without taking focus from another workspace control', async () => {
  const user = userEvent.setup()
  const view = render(
    <>
      <style>{`.simulate-narrow .chat-transcript { display: none; }`}</style>
      {surface()}
    </>,
  )
  await user.click(screen.getByRole('button', { name: 'Expand chat' }))
  screen.getByRole('button', { name: 'Transcript action' }).focus()
  view.container.classList.add('simulate-narrow')
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
  expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveFocus()
  const navigation = screen.getByRole('button', { name: 'Route navigation' })
  navigation.focus()
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
  expect(navigation).toHaveFocus()
})

it('reviews the existing pending approval without making a decision', async () => {
  lifecycle.approval = true
  const user = userEvent.setup()
  const view = render(surface())
  await user.click(screen.getByRole('button', { name: 'Review required approval' }))
  expect(screen.getByRole('group', { name: 'Required approval' })).toHaveFocus()
  expect(screen.getByRole('region', { name: 'Workspace assistant' })).toHaveAttribute('data-expanded', 'true')
  lifecycle.approval = false
  view.rerender(surface())
  expect(document.querySelector('[data-chat-approval-pending]')).toBeNull()
})

it('keeps real activity and pending review visible outside the closed conversation', async () => {
  lifecycle.status = 'streaming'
  lifecycle.approval = true
  const view = render(surface())
  expect(document.getElementById('workspace-assistant')).not.toBeVisible()
  expect(await screen.findByRole('status')).toHaveTextContent('Reply in progress. Expand to review.')
  expect(await screen.findByRole('button', { name: 'Review required approval' })).toBeVisible()
  expect(document.getElementById('workspace-assistant-entry-slot')).toContainElement(screen.getByRole('status'))
  lifecycle.status = 'idle'
  lifecycle.approval = false
  view.rerender(surface())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  await vi.waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Review required approval' })).not.toBeInTheDocument(),
  )
  expect(lifecycle.mounts).toBe(1)
})

it('rebinds a replaced same-route header without moving or remounting the conversation', async () => {
  const user = userEvent.setup()
  const view = render(surface())
  const oldSlot = document.getElementById('workspace-assistant-entry-slot')!
  await user.click(screen.getByRole('button', { name: 'Expand chat' }))
  const input = screen.getByRole('textbox', { name: 'Message input' })
  await user.type(input, 'Retained presentation draft')
  view.rerender(surface('explore', false, 'replacement'))
  const nextSlot = document.getElementById('workspace-assistant-entry-slot')!
  expect(nextSlot).not.toBe(oldSlot)
  expect(oldSlot).not.toBeInTheDocument()
  expect(nextSlot).toContainElement(screen.getByRole('button', { name: 'Restore chat size' }))
  expect(screen.getByRole('textbox', { name: 'Message input' })).toBe(input)
  expect(input).toHaveValue('Retained presentation draft')
  expect(lifecycle.mounts).toBe(1)
  expect(lifecycle.unmounts).toBe(0)
})
