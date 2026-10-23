import { describe, expect, it } from 'vitest'
import { readRunIdentity } from '../run-identity'

describe('explicit admitted run references', () => {
  const identity = {
    conversation_context: 'webui:/one',
    task_id: 'task-one',
    context_id: 'opaque-owned-context',
    run_id: 'run-one',
    run_trace_ref: 'opaque-reference',
  }
  it('preserves references without converting them to trace or subagent IDs', () => {
    expect(readRunIdentity({ arbora_run: identity }, '/one')).toEqual(identity)
  })
  it('refuses unrelated conversation metadata', () => {
    expect(readRunIdentity({ arbora_run: identity }, '/two')).toBeNull()
  })
  it.each([
    null,
    {},
    { arbora_run: { ...identity, task_id: 1 } },
    { arbora_run: { ...identity, trace_id: 'invented' } },
  ])('refuses missing or malformed identity %j', (value) => {
    expect(readRunIdentity(value, '/one')).toBeNull()
  })
})
