import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BlockedState } from '@/components/renderers/BlockedState'

describe('BlockedState', () => {
  it('renders the reason and status label, never an action button', () => {
    render(<BlockedState status="blocked" reason="signature verification failed" />)
    expect(screen.getByText(/signature verification failed/)).toBeInTheDocument()
    expect(screen.getByText(/blocked/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('uses role=alert for blocked and role=status for softer states', () => {
    const { rerender } = render(<BlockedState status="blocked" reason="x" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(<BlockedState status="not_configured" reason="x" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders a docs link for a safe https docsRef', () => {
    render(<BlockedState status="blocked" reason="x" docsRef="https://docs.example.com/guide" />)
    const link = screen.getByRole('link', { name: /documentation/i })
    expect(link).toHaveAttribute('href', 'https://docs.example.com/guide')
  })

  it('ADVERSARIAL: never renders a javascript: docsRef as a link', () => {
    render(<BlockedState status="blocked" reason="x" docsRef="javascript:alert(1)" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('ADVERSARIAL: never renders a data: docsRef as a link', () => {
    render(<BlockedState status="blocked" reason="x" docsRef="data:text/html,<script>alert(1)</script>" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('ADVERSARIAL: escapes an HTML-bearing reason as plain text, never innerHTML', () => {
    const hostileReason = '<img src=x onerror=alert(1)>reason text'
    render(<BlockedState status="degraded" reason={hostileReason} />)
    // Testing-library's DOM never parses this as an element because React
    // renders it as a text node -- assert the literal markup text is
    // visible (proving it was NOT interpreted as HTML) and no such <img>
    // element exists in the document.
    expect(screen.getByText(/reason text/)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('omits the docs link entirely when docsRef is absent', () => {
    render(<BlockedState status="unavailable" reason="x" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
