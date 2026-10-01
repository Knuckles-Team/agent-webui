import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StatusMessage, type StatusKind } from '@/components/ui/status-message'

/** DS-05 fixture: the seven named states with a representative detail. */
const STATES: { status: StatusKind; detail?: string }[] = [
  { status: 'loading' },
  { status: 'empty' },
  { status: 'stale', detail: 'last updated 14 minutes ago' },
  { status: 'denied', detail: 'you do not have the operator role' },
  { status: 'error', detail: 'the request timed out' },
  { status: 'success', detail: 'changes saved' },
  { status: 'pending', detail: 'awaiting approval' },
]

describe('StatusMessage (DS-05 state-fixture rendered tests)', () => {
  it('renders every named state with text that is distinct from every other state', () => {
    const texts = STATES.map(({ status, detail }) => {
      const { unmount } = render(<StatusMessage status={status} detail={detail} />)
      const text = screen.getByTestId('status-message').textContent ?? ''
      unmount()
      return text
    })
    expect(new Set(texts).size).toBe(texts.length)
  })

  const EXPECTED_TEXT: Record<StatusKind, string> = {
    loading: 'loading',
    empty: 'nothing here yet',
    stale: 'stale',
    denied: 'denied',
    error: 'error',
    success: 'succeeded',
    pending: 'pending',
  }

  it.each(STATES)('shows the $status label in the DOM as real text, not only via color', ({ status, detail }) => {
    render(<StatusMessage status={status} detail={detail} />)
    const node = screen.getByTestId('status-message')
    // The distinguishing word is present as text content a screen reader or
    // a color-blind/high-contrast reading of the page still receives.
    expect(node.textContent?.toLowerCase()).toContain(EXPECTED_TEXT[status])
  })

  it('uses role=alert for denied and error, and role=status for the ambient states', () => {
    const alertStates: StatusKind[] = ['denied', 'error']
    const statusStates: StatusKind[] = ['loading', 'empty', 'stale', 'success', 'pending']
    for (const status of alertStates) {
      const { unmount } = render(<StatusMessage status={status} />)
      expect(screen.getByRole('alert')).toBeInTheDocument()
      unmount()
    }
    for (const status of statusStates) {
      const { unmount } = render(<StatusMessage status={status} />)
      expect(screen.getByRole('status')).toBeInTheDocument()
      unmount()
    }
  })

  it('appends the optional detail after the label rather than replacing it', () => {
    render(<StatusMessage status="error" detail="the request timed out" />)
    expect(screen.getByText(/error\./i)).toBeInTheDocument()
    expect(screen.getByText(/the request timed out/)).toBeInTheDocument()
  })

  it('renders no Cancel affordance by default', () => {
    render(<StatusMessage status="pending" detail="awaiting approval" />)
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })

  it('renders an interrupt affordance only when the caller confirms cancellation is safe', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<StatusMessage status="loading" onCancel={onCancel} />)
    const button = screen.getByRole('button', { name: /cancel/i })
    await user.click(button)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('marks the spinning loading icon reduced-motion safe without hiding the text', () => {
    render(<StatusMessage status="loading" />)
    const node = screen.getByTestId('status-message')
    expect(node.querySelector('svg')).toHaveClass('motion-reduce:animate-none')
    expect(screen.getByText(/loading/i)).toBeVisible()
  })

  it('ADVERSARIAL: escapes an HTML-bearing detail as plain text, never innerHTML', () => {
    const hostileDetail = '<img src=x onerror=alert(1)>detail text'
    render(<StatusMessage status="error" detail={hostileDetail} />)
    expect(screen.getByText(/detail text/)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('associates the message with a field via the optional id for aria-describedby', () => {
    render(<StatusMessage status="error" detail="required" id="email-error" />)
    expect(screen.getByTestId('status-message')).toHaveAttribute('id', 'email-error')
  })

  it('uses a caller-supplied label in place of the default, keeping the status icon/role/color', () => {
    render(<StatusMessage status="empty" label="No knowledge bases found" />)
    const node = screen.getByTestId('status-message')
    expect(node).toHaveTextContent('No knowledge bases found')
    expect(node).not.toHaveTextContent('Nothing here yet')
    expect(node).toHaveAttribute('data-status', 'empty')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
