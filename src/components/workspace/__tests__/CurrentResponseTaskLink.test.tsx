// spec: OVERSTORY-APPS-R049.1.5
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { parseWorkState } from '@/lib/work-workspace'
import { CurrentResponseTaskLink } from '../CurrentResponseTaskLink'
const tools = vi.hoisted(() => ({ current: [] as WebMcpToolDefinition[] }))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (value: WebMcpToolDefinition[]) => {
    tools.current = value
  },
}))
function message(task = 'task/explicit'): UIMessage {
  return {
    id: 'response-a',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Complete' }],
    metadata: {
      arbora_run: {
        conversation_context: 'webui:/conversation-a',
        task_id: task,
        context_id: 'opaque-context',
        run_id: 'opaque-run',
        run_trace_ref: 'opaque-trace',
      },
    },
  }
}
const props = { conversationId: '/conversation-a', status: 'ready', role: 'user' as const }
afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})
describe('current-response task navigation', () => {
  it('uses the same typed native destination for manual and WebMCP navigation without decoding trace references', async () => {
    render(<CurrentResponseTaskLink {...props} message={message()} />)
    const link = screen.getByRole('link', { name: 'Inspect response task' })
    expect(link).toHaveAttribute('href', '/workspace/work?conversation=%2Fconversation-a&task=task%2Fexplicit')
    fireEvent.click(link)
    expect(parseWorkState(window.location.href)).toEqual({
      conversation: '/conversation-a',
      task: 'task/explicit',
      run: null,
      node: null,
    })
    window.history.replaceState({}, '', '/')
    await act(async () => {
      expect(await tools.current[0].execute({}, { signal: new AbortController().signal })).toEqual({ selected: true })
    })
    expect(window.location.pathname + window.location.search).toBe(link.getAttribute('href'))
  })
  it('does not label an interrupted ready response as completed or decode its task outcome', () => {
    const interrupted = message()
    interrupted.parts = []
    render(<CurrentResponseTaskLink {...props} message={interrupted} />)
    expect(screen.getByRole('link', { name: 'Inspect response task' })).toBeInTheDocument()
    expect(screen.queryByText(/completed|success|failed/i)).not.toBeInTheDocument()
  })
  it('does not intercept modified native links', () => {
    render(<CurrentResponseTaskLink {...props} message={message()} />)
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(screen.getByRole('link'), { ctrlKey: true })
    expect(push).not.toHaveBeenCalled()
  })
  it('withdraws links and rejects stale held handles when a newer response has no metadata or the component retires', async () => {
    const view = render(<CurrentResponseTaskLink {...props} message={message()} />)
    const stale = tools.current[0]
    view.rerender(<CurrentResponseTaskLink {...props} message={{ id: 'response-b', role: 'assistant', parts: [] }} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(tools.current).toHaveLength(0)
    await expect(stale.execute({}, { signal: new AbortController().signal })).rejects.toThrow()
    view.rerender(<CurrentResponseTaskLink {...props} message={message()} />)
    const retired = tools.current[0]
    view.unmount()
    await expect(retired.execute({}, { signal: new AbortController().signal })).rejects.toThrow()
  })
  it.each(['streaming', 'submitted', 'error'])('does not publish a task during %s', (status) => {
    render(<CurrentResponseTaskLink {...props} status={status} message={message()} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(tools.current).toHaveLength(0)
  })
  it('refuses mismatched conversation, insufficient role, malformed identifiers and arbitrary tool parameters', async () => {
    const view = render(<CurrentResponseTaskLink {...props} conversationId="/other" message={message()} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    view.rerender(<CurrentResponseTaskLink {...props} role="reader" message={message()} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    view.rerender(<CurrentResponseTaskLink {...props} message={message('\ud800')} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    view.rerender(<CurrentResponseTaskLink {...props} message={message()} />)
    await expect(
      tools.current[0].execute({ task: 'arbitrary' }, { signal: new AbortController().signal }),
    ).rejects.toThrow()
    expect(window.location.pathname).toBe('/')
  })
})
