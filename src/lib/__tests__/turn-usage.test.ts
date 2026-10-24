import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { readRunIdentity } from '@/lib/run-identity'
import { isArboraMetadata, readTurnUsage, turnUsageByMessage } from '@/lib/turn-usage'

function metadata(counts: Record<string, unknown> = { requests: 0, input_tokens: 12 }) {
  return {
    arbora_run: { conversation_context: 'webui:chat', task_id: 'task', context_id: 'context', run_id: 'run' },
    arbora: { usage: { runId: 'run', taskId: 'task', contextId: 'context', scope: 'turn', counts } },
  }
}

function message(id: string, data: unknown = metadata(), role: UIMessage['role'] = 'assistant'): UIMessage {
  return { id, role, metadata: data, parts: [] }
}

function decode(data: unknown) {
  return readTurnUsage(data, readRunIdentity(metadata(), 'chat')!)
}

describe('canonical turn receipts', () => {
  it('preserves zero, maximum and absent counters without deriving totals', () => {
    const data = metadata({ requests: 0, input_tokens: Number.MAX_SAFE_INTEGER })
    expect(decode(data)).toEqual(data.arbora.usage)
    expect(decode(data)?.counts).not.toHaveProperty('output_tokens')
    expect(decode(data)?.counts).not.toHaveProperty('total_tokens')
    expect(decode(metadata({}))?.counts).toEqual({})
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, true, null, '1', [], {}])(
    'rejects the whole receipt for invalid count %j',
    (value) => {
      expect(decode(metadata({ requests: 0, tool_calls: value }))).toBeNull()
    },
  )

  it.each(['runId', 'taskId', 'contextId', 'scope'])('rejects a mismatched %s', (field) => {
    const data = metadata()
    Object.assign(data.arbora.usage, { [field]: 'foreign' })
    expect(decode(data)).toBeNull()
  })

  it('rejects unknown fields, denied/unavailable data and legacy aliases', () => {
    expect(decode(metadata({ inputTokens: 1 }))).toBeNull()
    expect(decode({ ...metadata(), arbora: { usage: { ...metadata().arbora.usage, cost: 0 } } })).toBeNull()
    for (const usage of [null, [], { status: 'unavailable' }, { status: 'denied', counts: { requests: 2 } }]) {
      expect(decode({ ...metadata(), arbora: { usage } })).toBeNull()
    }
    expect(decode({ usage: { totalTokens: 7 } })).toBeNull()
    expect(decode({ ...metadata(), arbora: {} })).toBeNull()
  })

  it('deduplicates replay and clears earlier values when the latest receipt is unavailable', () => {
    const first = message('first')
    expect([...turnUsageByMessage([first, message('replay')], 'chat').keys()]).toEqual(['replay'])
    const unavailable = message('unavailable', { ...metadata(), arbora: { usage: { status: 'unavailable' } } })
    expect([...turnUsageByMessage([first, unavailable], 'chat')]).toEqual([['unavailable', null]])
    const denied = message('denied', { ...metadata(), arbora: { usage: { status: 'denied' } } })
    expect([...turnUsageByMessage([first, denied], 'chat')]).toEqual([['denied', null]])
    const malformed = message('invalid', metadata({ requests: -1 }))
    expect([...turnUsageByMessage([first, malformed], 'chat')]).toEqual([['invalid', null]])
  })

  it.each([undefined, 'other-run'])('invalidates counts when replay changes the admitted run to %s', (run) => {
    const data = metadata()
    const identity: { run_id?: string } = data.arbora_run
    identity.run_id = run
    if (run) data.arbora.usage.runId = run
    expect([...turnUsageByMessage([message('first'), message('changed', data)], 'chat')]).toEqual([['changed', null]])
    expect([
      ...turnUsageByMessage([message('first'), message('changed', data), message('restored')], 'chat').keys(),
    ]).toEqual(['restored'])
  })

  it('uses current conversation identity and only assistant messages', () => {
    expect(turnUsageByMessage([message('foreign')], 'other').size).toBe(0)
    expect(turnUsageByMessage([message('user', metadata(), 'user')], 'chat').size).toBe(0)
    expect(turnUsageByMessage([message('legacy', { usage: { total_tokens: 12 } })], 'chat').size).toBe(0)
    const noRun = metadata()
    delete (noRun.arbora_run as { run_id?: string }).run_id
    expect([...turnUsageByMessage([message('missing-run', noRun)], 'chat')]).toEqual([['missing-run', null]])
  })

  it('keeps legitimate new tasks separate and does not invalidate unrelated task or context identities', () => {
    const next = metadata({ output_tokens: 8 })
    Object.assign(next.arbora_run, { task_id: 'next-task', run_id: 'next-run' })
    Object.assign(next.arbora.usage, { taskId: 'next-task', runId: 'next-run' })
    const first = message('first')
    const rows = turnUsageByMessage([first, message('next', next)], 'chat')
    expect([...rows.keys()]).toEqual(['first', 'next'])
    expect(rows.get('first')?.counts).toEqual({ requests: 0, input_tokens: 12 })
    expect(rows.get('next')?.counts).toEqual({ output_tokens: 8 })
    for (const field of ['task_id', 'context_id']) {
      const wrong = metadata()
      Object.assign(wrong.arbora_run, { [field]: 'other' })
      const result = turnUsageByMessage([first, message('wrong', wrong)], 'chat')
      expect(result.get('first')?.counts).toEqual({ requests: 0, input_tokens: 12 })
      expect(result.get('wrong')).toBeNull()
    }
  })

  it('marks unavailable canonical metadata separately from generic provider estimates', () => {
    expect(isArboraMetadata({ arbora: {} })).toBe(true)
    expect(isArboraMetadata({ arbora_run: null })).toBe(true)
    expect(isArboraMetadata({ usage: { total_tokens: 1 } })).toBe(false)
    expect(isArboraMetadata(null)).toBe(false)
  })
})
