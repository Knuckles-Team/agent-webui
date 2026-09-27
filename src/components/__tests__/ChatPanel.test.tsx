import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ChatPanel from '../ChatPanel'
import { PageContextProvider } from '@/lib/page-context'

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))

vi.mock('../../Chat', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    default: function MockChat() {
      const [instanceId] = React.useState(() => {
        lifecycle.mounts += 1
        return lifecycle.mounts
      })
      React.useEffect(
        () => () => {
          lifecycle.unmounts += 1
        },
        [],
      )
      return <div data-testid="chat-instance">{instanceId}</div>
    },
  }
})

describe('ChatPanel', () => {
  it('keeps one Chat instance mounted when switching between drawer and primary layouts', () => {
    lifecycle.mounts = 0
    lifecycle.unmounts = 0
    const { rerender } = render(
      <PageContextProvider route="/graph" view="graph">
        <ChatPanel currentView="graph" isPrimary={false} />
      </PageContextProvider>,
    )
    const instanceId = screen.getByTestId('chat-instance').textContent

    rerender(
      <PageContextProvider route="/chat" view="chat">
        <ChatPanel currentView="chat" isPrimary />
      </PageContextProvider>,
    )

    expect(screen.getAllByTestId('chat-instance')).toHaveLength(1)
    expect(screen.getByTestId('chat-instance').textContent).toBe(instanceId)
    expect(lifecycle.mounts).toBe(1)
    expect(lifecycle.unmounts).toBe(0)
  })

  it('keeps the closed drawer out of keyboard order and names the opened region', async () => {
    const user = userEvent.setup()
    render(
      <PageContextProvider route="/graph" view="graph">
        <ChatPanel currentView="graph" isPrimary={false} />
      </PageContextProvider>,
    )

    const open = screen.getByRole('button', { name: 'Open chat' })
    expect(open).toBeEnabled()
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('complementary', { name: 'Agent Chat' })).not.toBeInTheDocument()
    await user.click(open)
    expect(open).toBeDisabled()
    expect(open).toHaveAttribute('aria-expanded', 'true')
    const region = screen.getByRole('complementary', { name: 'Agent Chat' })
    expect(region).toBeInTheDocument()
    expect(open).toHaveAttribute('aria-controls', region.id)
    const close = screen.getByRole('button', { name: 'Close chat' })
    expect(close).toHaveFocus()
    await user.click(close)
    expect(open).toBeEnabled()
    expect(open).toHaveFocus()
    expect(open).toHaveAttribute('aria-expanded', 'false')
    await user.click(open)
    await user.keyboard('{Escape}')
    expect(open).toHaveFocus()
    expect(screen.queryByRole('complementary', { name: 'Agent Chat' })).not.toBeInTheDocument()
  })
})
