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
    respondProposal: vi.fn(),
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
  pendingProposal: null,
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
      controlled.update({ status: 'armed', toolIds: ['overstory.read', 'overstory.navigate'] })
    })
    expect(screen.getByRole('status')).toHaveTextContent('Armed for 2 local browser tools')
    expect(screen.getByRole('list', { name: 'Armed browser tools' })).toHaveTextContent('overstory.navigate')
    await user.click(screen.getByRole('button', { name: 'Revoke browser control' }))
    expect(controlled.channel.revoke).toHaveBeenCalledOnce()
  })

  it('shows exact-request digests without rendering raw arguments', async () => {
    const controlled = fakeChannel({
      ...IDLE,
      status: 'armed',
      toolIds: ['overstory.navigate'],
      pendingConfirmation: {
        callId: 'call-1',
        leaseId: 'lease-1',
        toolId: 'overstory.navigate',
        toolTitle: 'Navigate in Arbora',
        toolVersion: '1.0.0',
        schemaDigest: `sha256:${'a'.repeat(64)}`,
        argumentDigest: `sha256:${'b'.repeat(64)}`,
        confirmationDigest: `sha256:${'c'.repeat(64)}`,
      },
    })
    const user = userEvent.setup()
    render(<WebMcpControl visible channel={controlled.channel} isAttendedGesture={() => true} />)

    expect(screen.getByRole('dialog', { name: 'Confirm browser action' })).toBeVisible()
    expect(screen.getByText('overstory.navigate@1.0.0')).toBeVisible()
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
        toolId: 'overstory.mutate',
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
        toolId: 'overstory.navigate',
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

// spec: OVERSTORY-APPS-R005.6.2
it('keeps legacy browser controls in a dismissible flow disclosure without arming on disclosure', async () => {
  const controlled = fakeChannel(IDLE)
  const user = userEvent.setup()
  render(
    <WebMcpControl
      visible
      collapsible
      placement="workspace"
      channel={controlled.channel}
      isAttendedGesture={() => true}
    />,
  )
  const summary = screen.getByText('Browser control settings · idle')
  const disclosure = summary.closest('details')!
  expect(disclosure).not.toHaveAttribute('open')
  expect(disclosure.querySelector('aside')).not.toHaveClass('fixed')
  await user.click(summary)
  expect(disclosure).toHaveAttribute('open')
  expect(controlled.channel.arm).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Arm browser control' }))
  expect(controlled.channel.arm).toHaveBeenCalledOnce()
  act(() => {
    controlled.update({ status: 'armed', toolIds: ['navigate'] })
  })
  expect(summary).toHaveTextContent('armed')
  await user.click(screen.getByRole('button', { name: 'Revoke browser control' }))
  expect(controlled.channel.revoke).toHaveBeenCalledOnce()
  await user.click(summary)
  expect(disclosure).not.toHaveAttribute('open')
  expect(summary).toHaveFocus()
})

const PROPOSAL = {
  proposalId: 'proposal-1',
  proposalDigest: `sha256:${'d'.repeat(64)}`,
  toolId: 'overstory.navigate',
  toolTitle: 'Navigate to branch',
  argumentsJson: '{"target":"/atlas?tip=branch-2"}',
  requesterAgent: 'web-agent',
  requesterRunRef: 'run-42',
  expiresAt: 2_000_000_000,
}

describe('agent proposal review surface', () => {
  it('displays the exact tool, arguments and requester before trusted human acceptance', async () => {
    const controlled = fakeChannel({ ...IDLE, status: 'armed', pendingProposal: PROPOSAL })
    const user = userEvent.setup()
    render(<WebMcpControl visible channel={controlled.channel} isAttendedGesture={() => true} />)
    expect(screen.getByRole('dialog', { name: 'Review agent browser request' })).toBeVisible()
    expect(screen.getByText(PROPOSAL.argumentsJson)).toBeVisible()
    expect(screen.getByText(PROPOSAL.requesterAgent)).toBeVisible()
    expect(screen.getByText(PROPOSAL.requesterRunRef)).toBeVisible()
    expect(screen.getByText('Navigate to branch (overstory.navigate)')).toBeVisible()
    expect(controlled.channel.respondProposal).not.toHaveBeenCalled()
    expect(controlled.channel.arm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Accept request' }))
    expect(controlled.channel.respondProposal).toHaveBeenCalledWith('proposal-1', true)
    expect(controlled.channel.confirm).not.toHaveBeenCalled()
    act(() => {
      controlled.update({ pendingProposal: null })
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects synthetic acceptance and permits declining without arming', async () => {
    const controlled = fakeChannel({ ...IDLE, status: 'armed', pendingProposal: PROPOSAL })
    const user = userEvent.setup()
    render(<WebMcpControl visible channel={controlled.channel} />)
    await user.click(screen.getByRole('button', { name: 'Accept request' }))
    expect(controlled.channel.respondProposal).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Decline request' }))
    expect(controlled.channel.respondProposal).toHaveBeenCalledWith('proposal-1', false)
    expect(controlled.channel.arm).not.toHaveBeenCalled()
  })
})

it('preserves long proposal content in bounded, keyboard-scrollable review', () => {
  const longProposal = {
    ...PROPOSAL,
    requesterAgent: 'a'.repeat(512),
    requesterRunRef: 'r'.repeat(128),
    argumentsJson: JSON.stringify({ target: 'x'.repeat(8000) }),
  }
  const controlled = fakeChannel({ ...IDLE, status: 'armed', pendingProposal: longProposal })
  render(<WebMcpControl visible channel={controlled.channel} />)
  const dialog = screen.getByRole('dialog', { name: 'Review agent browser request' })
  expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto', '[overflow-wrap:anywhere]')
  const args = screen.getByText(longProposal.argumentsJson)
  expect(args.textContent).toBe(longProposal.argumentsJson)
  expect(args).toHaveAttribute('tabindex', '0')
  expect(args).toHaveClass('max-h-[40dvh]', 'overflow-y-auto', 'whitespace-pre-wrap')
  expect(screen.getByText(longProposal.requesterAgent).textContent).toBe(longProposal.requesterAgent)
  expect(screen.getByText(longProposal.requesterRunRef).textContent).toBe(longProposal.requesterRunRef)
  expect(screen.getByRole('button', { name: 'Accept request' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Decline request' })).toBeInTheDocument()
  expect(controlled.channel.respondProposal).not.toHaveBeenCalled()
})
