// spec: WEBUI-APPS-R005.4, WEBUI-APPS-R049.1.3
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from '../ChatPanel'
import { PageContextProvider, type PageContextEnvelope } from '@/lib/page-context'

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0, approval: false }))
vi.mock('../../Chat', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    default: function MockChat({ pageContext }: { pageContext: PageContextEnvelope }) {
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
function surface(view = 'explore', primary = false) {
  return (
    <PageContextProvider route={`/workspace/${view}`} view={view}>
      <button>Route navigation</button>
      <ChatPanel currentView={view} contextLabel={`${view} context`} isPrimary={primary} />
    </PageContextProvider>
  )
}
beforeEach(() => {
  lifecycle.mounts = 0
  lifecycle.unmounts = 0
  lifecycle.approval = false
})
describe('native workspace assistant', () => {
  it('shows a named in-flow assistant and composer without a launcher, overlay or hidden drawer', () => {
    render(surface())
    const panel = screen.getByRole('region', { name: 'Workspace assistant' })
    expect(panel).toBeVisible()
    expect(panel).not.toHaveAttribute('inert')
    expect(panel).not.toHaveAttribute('aria-hidden')
    expect(panel).toHaveClass('workspace-assistant')
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Open chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close chat' })).not.toBeInTheDocument()
    expect(document.querySelector('#chat-panel-toggle, #agent-chat-drawer, .fixed')).toBeNull()
  })
  it('retains the same draft and instance through every context, compatibility surface and expansion', async () => {
    const user = userEvent.setup()
    const view = render(surface())
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
    await user.click(screen.getByRole('button', { name: 'Expand chat' }))
    expect(screen.getByRole('button', { name: 'Restore chat size' })).toHaveFocus()
    expect(input).toHaveValue('Keep this unsent draft')
    view.rerender(surface('chat', true))
    expect(screen.getByRole('region', { name: 'Workspace assistant' })).toHaveAttribute('data-primary', 'true')
    expect(input).toHaveValue('Keep this unsent draft')
    expect(lifecycle.mounts).toBe(1)
    expect(lifecycle.unmounts).toBe(0)
  })
  it('keeps nested or unrelated Escape handling separate and restores size without hiding chat', async () => {
    const user = userEvent.setup()
    render(surface())
    const panel = screen.getByRole('region', { name: 'Workspace assistant' })
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
    expect(input).toHaveFocus()
    expect(panel).toHaveAttribute('data-expanded', 'false')
    expect(panel).toBeVisible()
  })
  it('does not steal route focus when changing presentation', () => {
    const view = render(surface())
    const navigation = screen.getByRole('button', { name: 'Route navigation' })
    navigation.focus()
    view.rerender(surface('chat', true))
    expect(navigation).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Expand chat' })).not.toBeInTheDocument()
  })
  it('shows selected context as plain text without inventing connection status', () => {
    render(
      <PageContextProvider
        route="/workspace/explore"
        view="explore"
        baseSelection={[{ kind: 'entity', id: 'entity-1', label: '<script>Evidence</script>' }]}
      >
        <ChatPanel currentView="explore" contextLabel="Explore" isPrimary={false} />
      </PageContextProvider>,
    )
    expect(screen.getByText('<script>Evidence</script>')).toBeVisible()
    expect(document.querySelector('.animate-pulse, script')).toBeNull()
  })
})

it.each(['Transcript action', 'Message setting'])(
  'restores focus when compact layout hides %s on Escape',
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
    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Workspace assistant' })).toHaveAttribute('data-expanded', 'false')
  },
)

it('restores hidden focus on container resize without taking focus from another workspace control', () => {
  const view = render(
    <>
      <style>{`.simulate-narrow .chat-transcript { display: none; }`}</style>
      {surface()}
    </>,
  )
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
