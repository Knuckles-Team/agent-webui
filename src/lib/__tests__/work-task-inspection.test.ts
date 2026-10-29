// spec: OVERSTORY-APPS-R049.1.3
import { describe, expect, it } from 'vitest'
import { taskOutput, taskReferences } from '../work-task-inspection'
const artifact = { artifactId: 'reply-a', name: 'Reply', parts: [{ kind: 'text', text: 'Recorded answer' }] }
describe('served task projection', () => {
  it('accepts the producer text artifact and explicit references without deriving links', () => {
    const task = {
      artifacts: [artifact],
      contextId: 'opaque-context',
      metadata: {
        arbora: {
          runId: 'opaque-run',
          runTraceRef: 'urn:trace:opaque',
          routing: { secret: 'not projected' },
        },
      },
    }
    expect(taskOutput(task)).toEqual({ artifacts: [artifact], message: null })
    expect(taskReferences(task)).toEqual({ context: 'opaque-context', run: 'opaque-run', trace: 'urn:trace:opaque' })
    expect(taskReferences({ id: 'same-as-run' })).toEqual({
      context: 'Not supplied',
      run: 'Not supplied',
      trace: 'Not supplied',
    })
  })
  it('distinguishes missing, empty and explicitly unavailable output', () => {
    expect(taskOutput({}).message).toBe('Task output is not supplied.')
    expect(taskOutput({ artifacts: [] }).message).toBe('No output artifacts were returned.')
    expect(
      taskOutput({
        artifacts: [artifact],
        metadata: { arbora: { reply: { status: 'unavailable', reason: 'reply_too_large' } } },
      }),
    ).toEqual({ artifacts: [], message: 'The producer reports that the reply exceeds its output limit.' })
  })
  it.each([
    [{ ...artifact, parts: [{ kind: 'file', file: { uri: 'https://example.invalid/file' } }] }],
    [{ ...artifact, parts: [{ kind: 'text', text: 'x'.repeat(65537) }] }],
    [artifact, artifact],
    Array.from({ length: 5 }, (_, index) => ({
      ...artifact,
      artifactId: String(index),
      parts: [{ kind: 'text', text: 'x'.repeat(65536) }],
    })),
  ])('refuses unsupported or oversized output without partial rendering', (...artifacts) => {
    expect(taskOutput({ artifacts }).artifacts).toEqual([])
    expect(taskOutput({ artifacts }).message).toContain('unsupported format or display limit')
  })
  it('refuses malformed reference and refusal fields without exposing arbitrary metadata', () => {
    expect(taskReferences({ contextId: { malicious: true } })).toBeNull()
    expect(
      taskOutput({
        artifacts: [artifact],
        metadata: { arbora: { reply: { status: 'unavailable', reason: 'unrecognized' } } },
      }).artifacts,
    ).toEqual([])
  })
})
