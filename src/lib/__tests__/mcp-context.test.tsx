import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MCPProvider, useMCP } from '@/lib/mcp-context'

function ToolsProbe() {
  const { tools, isLoadingTools } = useMCP()
  return (
    <pre data-testid="mcp-tools-probe">
      {JSON.stringify({ tools, isLoadingTools })}
    </pre>
  )
}

describe('MCPProvider', () => {
  // `tools` is honestly always null today: the real MCP client
  // (`src/lib/mcp-client.ts`) and its two backend routes only exist on the
  // unmerged `feat/mcp-client-wiring` branch, not on this repo's current
  // `main` — see the comment above `MCPProvider` in `mcp-context.tsx`. This
  // test pins that honest behavior so a future silent regression (someone
  // reintroducing a `useState` setter that never resolves, as the previous
  // half-implementation did) is caught, and so that landing the real wiring
  // means updating this test on purpose rather than by accident.
  it('reports tools as null and isLoadingTools as settled immediately after mounting, without hanging in a perpetual loading state', () => {
    render(
      <MCPProvider>
        <ToolsProbe />
      </MCPProvider>,
    )

    const probe = JSON.parse(screen.getByTestId('mcp-tools-probe').textContent ?? '{}') as {
      tools: unknown
      isLoadingTools: unknown
    }
    expect(probe.tools).toBeNull()
    expect(probe.isLoadingTools).toBe(false)
  })

  it('throws when useMCP is called outside a provider', () => {
    // Suppress the expected React error-boundary console noise for this assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ToolsProbe />)).toThrow('useMCP must be used within MCPProvider')
    spy.mockRestore()
  })
})
