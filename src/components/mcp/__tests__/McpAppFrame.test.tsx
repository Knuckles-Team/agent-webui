import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MCP_APP_SANDBOX, McpAppFrame } from '../McpAppFrame'

const baseMeta = { resourceUri: 'ui://graph-os/task-progress.html' }

describe('McpAppFrame', () => {
  it('renders the app in the minimum sandbox, with no same-origin/popup escape', () => {
    render(
      <McpAppFrame
        meta={baseMeta}
        html="<html><head></head><body>app</body></html>"
        allowedTools={() => true}
        callTool={vi.fn()}
        title="Task Progress"
      />,
    )
    const frame = screen.getByTitle('Task Progress')
    expect(MCP_APP_SANDBOX).toBe('allow-scripts')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-popups')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-forms')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('never applies a server-declared CSP domain the host did not also allow', () => {
    render(
      <McpAppFrame
        meta={{
          ...baseMeta,
          csp: { connectDomains: ['https://not-allowed.example'] },
        }}
        html="<html><head></head><body>app</body></html>"
        allowedTools={() => true}
        allowedDomains={['https://trusted.example']}
        callTool={vi.fn()}
        title="Task Progress"
      />,
    )
    const frame = screen.getByTitle('Task Progress') as HTMLIFrameElement
    expect(frame.srcdoc).toContain("connect-src 'none'")
    expect(frame.srcdoc).not.toContain('not-allowed.example')
  })

  it('applies a host-allowed CSP domain the server also declared', () => {
    render(
      <McpAppFrame
        meta={{
          ...baseMeta,
          csp: { connectDomains: ['https://trusted.example'] },
        }}
        html="<html><head></head><body>app</body></html>"
        allowedTools={() => true}
        allowedDomains={['https://trusted.example']}
        callTool={vi.fn()}
        title="Task Progress"
      />,
    )
    const frame = screen.getByTitle('Task Progress') as HTMLIFrameElement
    expect(frame.srcdoc).toContain('connect-src https://trusted.example')
  })
})
