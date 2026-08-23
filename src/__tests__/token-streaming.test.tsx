import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

import { Part } from '@/Part'
import { ProgressTimeline, extractProgressEvents, isProgressEventPart } from '@/Chat'

/**
 * Coverage for the token-streaming half of the progress-event work
 * (`agent_utilities.orchestration.agent_runner._stream_agent_run` ->
 * `orchestrator_model.py::_reply_stream`): the core now streams the answer's own
 * token deltas as ordinary `str` chunks on the SAME wire the checkpoint events
 * already use. `@ai-sdk/react`'s `useChat` appends each delta chunk to the
 * assistant message's `text` part, so this file drives the REAL rendering path
 * those growing `text` parts hit (`<Part type="text">` -> `<Response>`) instead
 * of re-implementing the accumulation logic, which lives in the `ai` package,
 * not this repo.
 */

function textMessage(text: string): UIMessage {
  return {
    id: 'm1',
    role: 'assistant',
    parts: [{ type: 'text', text }],
  } as unknown as UIMessage
}

const noop = vi.fn()

describe('Part renders a streaming text part progressively', () => {
  it('the rendered message body grows across re-renders as more deltas arrive', () => {
    const { rerender } = render(
      <Part
        part={{ type: 'text', text: 'agent-' } as never}
        message={textMessage('agent-')}
        status="streaming"
        regen={noop}
        index={0}
        lastMessage={true}
      />,
    )
    expect(screen.getByText('agent-')).toBeInTheDocument()

    // Simulate the next SSE text-delta chunk growing the SAME text part -- exactly
    // what `useChat` does to `message.parts[i].text` on each `text-delta` event.
    rerender(
      <Part
        part={{ type: 'text', text: 'agent-utilities is ' } as never}
        message={textMessage('agent-utilities is ')}
        status="streaming"
        regen={noop}
        index={0}
        lastMessage={true}
      />,
    )
    expect(screen.getByText('agent-utilities is')).toBeInTheDocument()
    expect(screen.queryByText('agent-', { exact: true })).not.toBeInTheDocument()

    rerender(
      <Part
        part={{ type: 'text', text: 'agent-utilities is a platform.' } as never}
        message={textMessage('agent-utilities is a platform.')}
        status="streaming"
        regen={noop}
        index={0}
        lastMessage={true}
      />,
    )
    expect(screen.getByText('agent-utilities is a platform.')).toBeInTheDocument()
  })
})

describe('text-delta chunks never get mistaken for progress-timeline events', () => {
  it('isProgressEventPart rejects a plain text part carrying delta-shaped content', () => {
    // A token delta ("agent-") happens to be short/plain like a stage name, so this
    // guards against the two channels being confused now that both stream: only a
    // `reasoning` part whose text parses as {stage, status} is a progress event.
    expect(isProgressEventPart({ type: 'text', text: 'agent-' })).toBe(false)
    expect(isProgressEventPart({ type: 'text', text: '{"stage":"route","status":"ok"}' })).toBe(false)
  })

  it('extractProgressEvents ignores growing text-delta parts interleaved with real progress parts', () => {
    const parts = [
      { type: 'reasoning', text: JSON.stringify({ stage: 'route', status: 'ok' }) },
      { type: 'text', text: 'agent-' },
      { type: 'text', text: 'agent-utilities is ' },
      { type: 'reasoning', text: JSON.stringify({ stage: 'done', status: 'ok' }) },
    ]
    const events = extractProgressEvents(parts)
    expect(events.map((e) => e.stage)).toEqual(['route', 'done'])
  })
})

describe('ProgressTimeline keeps rendering the loader while the answer streams alongside it', () => {
  it('the FIRST event of the run clears a loading state, independent of whether the answer has started', () => {
    // Mirrors how Chat.tsx drives `isStreaming`: true while `status === 'streaming'`
    // for the in-flight message, regardless of whether that message ALSO already
    // carries streamed answer text -- the two are independent signals rendered
    // side by side, never one gating the other's visibility.
    const { rerender } = render(<ProgressTimeline events={[]} isStreaming={false} />)
    expect(screen.queryByText(/Routing/)).not.toBeInTheDocument()

    rerender(<ProgressTimeline events={[{ stage: 'route', status: 'ok', detail: 'routed' }]} isStreaming={true} />)
    expect(screen.getByText(/Routing: routed/)).toBeInTheDocument()
  })
})
