import { render, screen } from '@testing-library/react'
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
})
