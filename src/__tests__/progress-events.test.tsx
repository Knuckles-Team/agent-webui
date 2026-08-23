import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProgressTimeline, extractProgressEvents, isProgressEventPart, parseProgressEventPayload } from '@/Chat'

/**
 * Coverage for the webui half of the "chat spins for minutes then answers" fix
 * (D-W6-BSF-1-ish follow-up): the core orchestrator's `ProgressEvent` stream
 * (agent-utilities' `agent_runner.py`) reaches this frontend as a JSON payload
 * riding each `reasoning` message part (`orchestrator_model.py::_reply_stream`
 * -- pydantic-ai's `FunctionModel.stream_function` has no distinct custom-data
 * frame type available, see that module's docstring). These tests drive the
 * REAL parsing/rendering functions this file exports, not a re-implementation
 * of them.
 */

describe('parseProgressEventPayload', () => {
  it('parses a well-formed progress-event JSON payload', () => {
    const payload = parseProgressEventPayload(
      JSON.stringify({ stage: 'route', status: 'ok', detail: 'routed to au-expert', evidence: { agents: ['x'] } }),
    )
    expect(payload).toEqual({
      stage: 'route',
      status: 'ok',
      detail: 'routed to au-expert',
      evidence: { agents: ['x'] },
    })
  })

  it('returns null for ordinary free-text reasoning content', () => {
    expect(parseProgressEventPayload('Let me think about this step by step...')).toBeNull()
  })

  it('returns null for JSON missing the stage/status shape', () => {
    expect(parseProgressEventPayload(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })

  it('returns null for malformed JSON without throwing', () => {
    expect(() => parseProgressEventPayload('{not json')).not.toThrow()
    expect(parseProgressEventPayload('{not json')).toBeNull()
  })
})

describe('isProgressEventPart / extractProgressEvents', () => {
  it('identifies a reasoning part carrying a progress payload and excludes plain text/other types', () => {
    const progressPart = { type: 'reasoning', text: JSON.stringify({ stage: 'start', status: 'started' }) }
    const thinkingPart = { type: 'reasoning', text: 'genuine chain of thought' }
    const textPart = { type: 'text', text: 'the final answer' }

    expect(isProgressEventPart(progressPart)).toBe(true)
    expect(isProgressEventPart(thinkingPart)).toBe(false)
    expect(isProgressEventPart(textPart)).toBe(false)
  })

  it('extracts progress events IN ORDER from a mixed parts array, ignoring non-progress parts', () => {
    const parts = [
      { type: 'reasoning', text: JSON.stringify({ stage: 'start', status: 'started' }) },
      { type: 'reasoning', text: JSON.stringify({ stage: 'route', status: 'ok', detail: 'routed' }) },
      { type: 'text', text: 'ANSWER' },
      { type: 'reasoning', text: JSON.stringify({ stage: 'done', status: 'ok' }) },
    ]

    const events = extractProgressEvents(parts)
    expect(events.map((e) => e.stage)).toEqual(['start', 'route', 'done'])
  })

  it('is defensive against a missing/non-array parts list', () => {
    expect(extractProgressEvents(undefined)).toEqual([])
  })
})

describe('ProgressTimeline', () => {
  it('renders nothing when there are no progress events yet', () => {
    const { container } = render(<ProgressTimeline events={[]} isStreaming={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a badge for the FIRST progress event even before the run (or the final answer) completes', () => {
    // The whole point of the fix: this must be visible from ONE event, not
    // requiring the terminal "done" event or the final answer text.
    render(
      <ProgressTimeline
        events={[{ stage: 'start', status: 'started', detail: 'webui-assistant' }]}
        isStreaming={true}
      />,
    )
    expect(screen.getByText(/Starting: webui-assistant/i)).toBeInTheDocument()
  })

  it('renders one badge per event, in order, and flags a failed stage distinctly', () => {
    render(
      <ProgressTimeline
        events={[
          { stage: 'start', status: 'started' },
          { stage: 'route', status: 'ok', detail: 'routed to au-expert' },
          { stage: 'evidence_gate', status: 'failed', detail: 'no relevant evidence' },
        ]}
        isStreaming={false}
      />,
    )
    expect(screen.getByText('Starting')).toBeInTheDocument()
    expect(screen.getByText(/Routing: routed to au-expert/)).toBeInTheDocument()
    const failedBadge = screen.getByText(/Evidence gate: no relevant evidence/)
    expect(failedBadge).toBeInTheDocument()
  })
})
