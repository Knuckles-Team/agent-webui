import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WebMcpControl } from './WebMcpControl'
import type { WebMcpChannelView } from '@/lib/webmcp/channel'

function fakeChannel(initial: WebMcpChannelView) {
  let view = initial
  const listeners = new Set<() => void>()
  const channel = {
    arm: vi.fn(async () => undefined),
    confirm: vi.fn(),
    deny: vi.fn(),
    revoke: vi.fn(),
    getView: () => view,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    channel,
    update(next: Partial<WebMcpChannelView>) {
      view = { ...view, ...next }
      listeners.forEach((listener) => {
        listener()
      })
    },
  }
}

const IDLE: WebMcpChannelView = {
  status: 'idle',
  toolIds: [],
  pendingConfirmation: null,
  message: null,
  expiresAt: null,
}

describe('attended WebMCP controls', () => {
  it('requires an explicit user gesture to arm and exposes revoke with scope', async () => {
    const controlled = fakeChannel(IDLE)
    const user = userEvent.setup()
    render(<WebMcpControl visible channel={controlled.channel} isAttendedGesture={() => true} />)

    expect(controlled.channel.arm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Arm browser control' }))
    expect(controlled.channel.arm).toHaveBeenCalledOnce()

    act(() => {
      controlled.update({ status: 'armed', toolIds: ['agent-webui.read', 'agent-webui.navigate'] })
    })
    expect(screen.getByRole('status')).toHaveTextContent('Armed for 2 local browser tools')
    expect(screen.getByRole('list', { name: 'Armed browser tools' })).toHaveTextContent('agent-webui.navigate')
    await user.click(screen.getByRole('button', { name: 'Revoke browser control' }))
    expect(controlled.channel.revoke).toHaveBeenCalledOnce()
  })

  it('shows exact-request digests without rendering raw arguments', async () => {
    const controlled = fakeChannel({
      ...IDLE,
      status: 'armed',
      toolIds: ['agent-webui.navigate'],
      pendingConfirmation: {
        callId: 'call-1',
        leaseId: 'lease-1',
        toolId: 'agent-webui.navigate',
        toolTitle: 'Navigate in Agent WebUI',
        toolVersion: '1.0.0',
        schemaDigest: `sha256:${'a'.repeat(64)}`,
        argumentDigest: `sha256:${'b'.repeat(64)}`,
        confirmationDigest: `sha256:${'c'.repeat(64)}`,
      },
    })
    const user = userEvent.setup()
    render(<WebMcpControl visible channel={controlled.channel} isAttendedGesture={() => true} />)

    expect(screen.getByRole('dialog', { name: 'Confirm browser action' })).toBeVisible()
    expect(screen.getByText('agent-webui.navigate@1.0.0')).toBeVisible()
    expect(screen.getByText(`sha256:${'a'.repeat(64)}`)).toBeVisible()
    expect(screen.getByText(`sha256:${'b'.repeat(64)}`)).toBeVisible()
    expect(document.body).not.toHaveTextContent('/private/raw/argument')

    await user.click(screen.getByRole('button', { name: 'Confirm this action' }))
    expect(controlled.channel.confirm).toHaveBeenCalledWith('call-1')
  })

  it('lets the operator deny the pending call and hides all controls when ineligible', async () => {
    const controlled = fakeChannel({
      ...IDLE,
      pendingConfirmation: {
        callId: 'call-2',
        leaseId: 'lease-2',
        toolId: 'agent-webui.mutate',
        toolTitle: 'Mutate',
        toolVersion: '1.0.0',
        schemaDigest: `sha256:${'d'.repeat(64)}`,
        argumentDigest: `sha256:${'e'.repeat(64)}`,
        confirmationDigest: `sha256:${'f'.repeat(64)}`,
      },
    })
    const user = userEvent.setup()
    const rendered = render(<WebMcpControl visible channel={controlled.channel} isAttendedGesture={() => true} />)
    await user.click(screen.getByRole('button', { name: 'Deny' }))
    expect(controlled.channel.deny).toHaveBeenCalledWith('call-2')

    rendered.rerender(<WebMcpControl visible={false} channel={controlled.channel} isAttendedGesture={() => true} />)
    expect(screen.queryByRole('complementary', { name: 'Remote browser control' })).not.toBeInTheDocument()
  })

  it('refuses a synthetic click that is not a trusted attended browser gesture', async () => {
    const controlled = fakeChannel(IDLE)
    const user = userEvent.setup()
    render(<WebMcpControl visible channel={controlled.channel} />)

    await user.click(screen.getByRole('button', { name: 'Arm browser control' }))

    expect(controlled.channel.arm).not.toHaveBeenCalled()
  })

  it('refuses synthetic confirmation without a trusted attended browser gesture', async () => {
    const controlled = fakeChannel({
      ...IDLE,
      pendingConfirmation: {
        callId: 'call-untrusted',
        leaseId: 'lease-untrusted',
        toolId: 'agent-webui.navigate',
        toolTitle: 'Navigate',
        toolVersion: '1.0.0',
        schemaDigest: `sha256:${'1'.repeat(64)}`,
        argumentDigest: `sha256:${'2'.repeat(64)}`,
        confirmationDigest: `sha256:${'3'.repeat(64)}`,
      },
    })
    const user = userEvent.setup()
    render(<WebMcpControl visible channel={controlled.channel} />)

    await user.click(screen.getByRole('button', { name: 'Confirm this action' }))

    expect(controlled.channel.confirm).not.toHaveBeenCalled()
  })
})
