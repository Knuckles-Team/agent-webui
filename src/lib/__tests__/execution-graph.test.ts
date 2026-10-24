// spec: WEBUI-API-R011.4, WEBUI-APPS-R049.1.13
import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/execution-graph.json'
import unicodeFixture from './fixtures/execution-graph-unicode.json'
// Unicode fixtures were emitted by Arbora projection source 8bd34db0f181b2cc9a596f243546422ca4183dcf.
import maximumUnicodeFixture from './fixtures/execution-graph-max-unicode.json'
import { readExecutionGraph } from '@/lib/execution-graph'

function respond(value: unknown, status = 200) {
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          url === '/auth/session'
            ? { authenticated: true, csrf_token: 'test-token' }
            : {
                ok: true,
                result: { value },
                meta: { registry_digest: 'test-digest', api_version: 'v1' },
              },
        ),
        { status: url === '/auth/session' ? 200 : status, headers: { 'Content-Type': 'application/json' } },
      ),
  )
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function replaceNodeKey(value: typeof fixture, index: number, key: string) {
  const previous = value.snapshot.nodes[index].key
  value.snapshot.nodes[index].key = key
  value.snapshot.edges = value.snapshot.edges.map((edge) => ({
    ...edge,
    source: edge.source === previous ? key : edge.source,
    target: edge.target === previous ? key : edge.target,
  }))
}
afterEach(() => vi.unstubAllGlobals())
describe('explicit flat execution projection adapter', () => {
  it('decodes the producer fixture through the real canonical session and operation transport', async () => {
    const fetcher = respond(fixture)
    const signal = new AbortController().signal
    expect(await readExecutionGraph(fixture.run_id, fixture.task_id, signal)).toEqual(fixture)
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/ops/runs.execution_graph',
      expect.objectContaining({
        signal,
        credentials: 'same-origin',
        method: 'POST',
        body: JSON.stringify({
          schema_version: 'arbora-execution-graph-v1',
          run_id: fixture.run_id,
          task_id: fixture.task_id,
        }),
        headers: expect.objectContaining({ 'X-CSRF-Token': 'test-token' }),
      }),
    )
  })
  it.each([
    [
      'code-point ID limit',
      (value: typeof fixture) => {
        value.snapshot.nodes[0].task_id = '🌳'.repeat(513)
        replaceNodeKey(value, 0, JSON.stringify([value.run_id, 'plan_step', value.snapshot.nodes[0].task_id]))
      },
    ],
    [
      'event ID code-point limit',
      (value: typeof fixture) => {
        value.snapshot.nodes[0].evidence!.event_id = '🌱'.repeat(1025)
      },
    ],
    [
      'foreign-run node key',
      (value: typeof fixture) => {
        replaceNodeKey(value, 0, JSON.stringify(['foreign-run', 'plan_step', 'first']))
      },
    ],
    [
      'wrong-kind node key',
      (value: typeof fixture) => {
        replaceNodeKey(value, 0, JSON.stringify([value.run_id, 'spawned_child', 'first']))
      },
    ],
    [
      'wrong-step node key',
      (value: typeof fixture) => {
        replaceNodeKey(value, 0, JSON.stringify([value.run_id, 'plan_step', 'other-step']))
      },
    ],
    [
      'malformed node key',
      (value: typeof fixture) => {
        replaceNodeKey(value, 0, '{not-json')
      },
    ],
    [
      'extra node key member',
      (value: typeof fixture) => {
        replaceNodeKey(value, 0, JSON.stringify([value.run_id, 'plan_step', 'first', 'extra']))
      },
    ],
    [
      'whitespace ID',
      (value: typeof fixture) => {
        value.snapshot.nodes[0].task_id = '  '
        replaceNodeKey(value, 0, JSON.stringify([value.run_id, 'plan_step', '  ']))
      },
    ],
    [
      'duplicate evidence event',
      (value: typeof fixture) => {
        value.snapshot.nodes[1].status = 'running'
        value.snapshot.nodes[1].evidence = { event_id: 'event-2', sequence: 1 }
      },
    ],
    [
      'duplicate evidence sequence',
      (value: typeof fixture) => {
        value.snapshot.nodes[1].status = 'running'
        value.snapshot.nodes[1].evidence = { event_id: 'distinct-event', sequence: 2 }
      },
    ],
    [
      'run binding',
      (value: typeof fixture) => {
        value.run_id = 'wrong-run'
      },
    ],
    [
      'root task binding',
      (value: typeof fixture) => {
        value.task_id = 'wrong-root'
      },
    ],
    [
      'schema version',
      (value: typeof fixture) => {
        value.schema_version = 'future-version'
      },
    ],
    [
      'child capability',
      (value: typeof fixture) => {
        value.snapshot.can_message_active = true
      },
    ],
    [
      'duplicate nodes',
      (value: typeof fixture) => {
        value.snapshot.nodes.push(value.snapshot.nodes[0])
      },
    ],
    [
      'dangling dependency',
      (value: typeof fixture) => {
        value.snapshot.edges[0].target = 'absent'
      },
    ],
    [
      'duplicate dependency',
      (value: typeof fixture) => {
        value.snapshot.edges.push(value.snapshot.edges[0])
      },
    ],
    [
      'cycle',
      (value: typeof fixture) => {
        value.snapshot.edges.push({
          ...value.snapshot.edges[0],
          source: value.snapshot.nodes[3].key,
          target: value.snapshot.nodes[0].key,
        })
      },
    ],
    [
      'unbound evidence',
      (value: typeof fixture) => {
        value.snapshot.nodes[0].evidence = null
      },
    ],
    [
      'unobserved evidence',
      (value: typeof fixture) => {
        value.snapshot.nodes[1].evidence = { event_id: 'bad', sequence: 1 }
      },
    ],
    [
      'future evidence',
      (value: typeof fixture) => {
        value.snapshot.nodes[0].evidence!.sequence = 3
      },
    ],
    [
      'invalid cursor',
      (value: typeof fixture) => {
        value.snapshot.covered_after = 1001
      },
    ],
    [
      'too many nodes',
      (value: typeof fixture) => {
        value.snapshot.nodes = Array.from({ length: 65 }, () => value.snapshot.nodes[0])
      },
    ],
    [
      'unavailable snapshot',
      (value: typeof fixture) => {
        value.availability = 'unavailable'
      },
    ],
  ])('refuses %s without another endpoint', async (_label, mutate) => {
    const value = structuredClone(fixture)
    mutate(value)
    const fetcher = respond(value)
    await expect(readExecutionGraph(fixture.run_id, fixture.task_id, new AbortController().signal)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('accepts the actual maximum-Unicode producer projection and its 12307-character key', async () => {
    expect(maximumUnicodeFixture.snapshot.nodes[0].key).toHaveLength(12307)
    expect(Array.from(maximumUnicodeFixture.run_id)).toHaveLength(512)
    respond(maximumUnicodeFixture)
    expect(
      await readExecutionGraph(
        maximumUnicodeFixture.run_id,
        maximumUnicodeFixture.task_id,
        new AbortController().signal,
      ),
    ).toEqual(maximumUnicodeFixture)
  })
  it('decodes the actual producer Unicode fixture without changing escaped tuple keys', async () => {
    respond(unicodeFixture)
    expect(
      await readExecutionGraph(unicodeFixture.run_id, unicodeFixture.task_id, new AbortController().signal),
    ).toEqual(unicodeFixture)
  })
  it('accepts escaped Unicode tuple keys without reconstructing their byte encoding', async () => {
    const value = structuredClone(fixture)
    const oldKey = value.snapshot.nodes[1].key
    value.snapshot.nodes[1].task_id = '星 😀'
    const key = '["run-one","plan_step","\\u661f \\ud83d\\ude00"]'
    value.snapshot.nodes[1].key = key
    value.snapshot.edges = value.snapshot.edges.map((edge) => ({
      ...edge,
      source: edge.source === oldKey ? key : edge.source,
      target: edge.target === oldKey ? key : edge.target,
    }))
    respond(value)
    expect(await readExecutionGraph(fixture.run_id, fixture.task_id, new AbortController().signal)).toEqual(value)
  })
  it('accepts producer code-point ID bounds rather than UTF-16 code-unit bounds', async () => {
    const value = structuredClone(fixture)
    value.run_id = '🌳'.repeat(512)
    value.task_id = '🌲'.repeat(512)
    value.snapshot.plan_digest = '🍃'.repeat(512)
    value.snapshot.nodes[0].task_id = '🌿'.repeat(512)
    value.snapshot.nodes[0].evidence!.event_id = '🌱'.repeat(1024)
    value.snapshot.nodes.forEach((node, index) => {
      replaceNodeKey(value, index, JSON.stringify([value.run_id, 'plan_step', node.task_id]))
    })
    respond(value)
    expect(await readExecutionGraph(value.run_id, value.task_id, new AbortController().signal)).toEqual(value)
  })
  it('preserves explicit unavailable without manufacturing an empty graph', async () => {
    const value = { ...fixture, availability: 'unavailable', snapshot: null }
    respond(value)
    expect(await readExecutionGraph(fixture.run_id, fixture.task_id, new AbortController().signal)).toEqual(value)
  })
  it('keeps an absent operation unavailable without a legacy fallback', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      url === '/auth/session'
        ? new Response(JSON.stringify({ authenticated: true, csrf_token: 'test-token' }))
        : new Response('Not found', { status: 404 }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(
      readExecutionGraph(fixture.run_id, fixture.task_id, new AbortController().signal),
    ).rejects.toMatchObject({ status: 404 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
