import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useQueryValidationLens, type Mode, type QueryValidationController } from '../useQueryValidationLens'

function deferredFetch() {
  const finishes: ((response: Response) => void)[] = []
  const fetch = vi.fn(
    (_url: unknown, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        finishes.push(resolve)
      }),
  )
  vi.stubGlobal('fetch', fetch)
  return { fetch, finishes }
}
function response(mode: Mode, value: string, status = 200) {
  if (status !== 200) return new Response(JSON.stringify({ detail: value }), { status })
  const payload =
    mode === 'sparql'
      ? { status: 'success', head: { vars: ['s'] }, results: { bindings: [{ s: { value } }] } }
      : { status: 'success', result: { valid: true, errors: [], warnings: [], summary: { value } } }
  return new Response(JSON.stringify(payload), { status })
}
function action(controller: QueryValidationController, mode: Mode) {
  return mode === 'sparql' ? controller.runSparql : controller.runValidate
}
function setDraft(controller: QueryValidationController, mode: Mode, value: string) {
  if (mode === 'sparql') controller.setSparqlQuery(value)
  else {
    controller.setShaclSource(value)
    controller.setShaclSourceType('url')
  }
}
function running(controller: QueryValidationController, mode: Mode) {
  return mode === 'sparql' ? controller.sparqlRunning : controller.shaclRunning
}
afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(['sparql', 'shacl'] as const)('%s request ownership', (mode) => {
  // spec: WEBUI-APPS-R049
  it('excludes same-tick calls and retained idle callbacks across rerenders', async () => {
    const { fetch, finishes } = deferredFetch()
    const { result } = renderHook(() => useQueryValidationLens())
    act(() => {
      setDraft(result.current, mode, 'first')
    })
    const retained = action(result.current, mode)
    let pending!: Promise<void>
    act(() => {
      pending = retained()
      void retained()
    })
    act(() => {
      setDraft(result.current, mode, 'edited while pending')
    })
    await act(async () => {
      await retained()
      await action(result.current, mode)()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(running(result.current, mode)).toBe(true)
    await act(async () => {
      finishes[0](response(mode, 'first result'))
      await pending
    })
    expect(running(result.current, mode)).toBe(false)
  })

  // spec: WEBUI-APPS-R049
  it('reads committed inputs through an old callback and keeps the current request ownership', async () => {
    const { fetch, finishes } = deferredFetch()
    const { result } = renderHook(() => useQueryValidationLens())
    const retained = action(result.current, mode)
    act(() => {
      setDraft(result.current, mode, 'current committed input')
    })
    let pending!: Promise<void>
    act(() => {
      pending = retained()
    })
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string) as Record<string, unknown>
    expect(body[mode === 'sparql' ? 'query' : 'source']).toBe('current committed input')
    if (mode === 'shacl') expect(body.source_type).toBe('url')
    await act(async () => {
      finishes[0](response(mode, 'first'))
      await pending
    })
    act(() => {
      setDraft(result.current, mode, 'newer committed input')
    })
    act(() => {
      pending = action(result.current, mode)()
    })
    await act(async () => {
      await retained()
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(running(result.current, mode)).toBe(true)
    await act(async () => {
      finishes[1](response(mode, 'newer'))
      await pending
    })
    const value =
      mode === 'sparql' ? result.current.sparqlBindings[0].s?.value : result.current.shaclResult?.summary.value
    expect(value).toBe('newer')
  })

  // spec: WEBUI-APPS-R049
  it('releases only its own lock after failure and permits a later retry', async () => {
    const { fetch, finishes } = deferredFetch()
    const { result } = renderHook(() => useQueryValidationLens())
    act(() => {
      setDraft(result.current, mode, 'candidate')
    })
    let pending!: Promise<void>
    act(() => {
      pending = action(result.current, mode)()
    })
    await act(async () => {
      finishes[0](response(mode, 'unavailable', 503))
      await pending
    })
    expect(running(result.current, mode)).toBe(false)
    act(() => {
      pending = action(result.current, mode)()
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    await act(async () => {
      finishes[1](response(mode, 'recovered'))
      await pending
    })
    expect(mode === 'sparql' ? result.current.sparqlError : result.current.shaclError).toBeNull()
  })

  // spec: WEBUI-APPS-R049
  it('retires old callbacks and completions without touching a new owner request', async () => {
    const { fetch, finishes } = deferredFetch()
    const old = renderHook(() => useQueryValidationLens())
    act(() => {
      setDraft(old.result.current, mode, 'old identity input')
    })
    const retired = action(old.result.current, mode)
    let oldPending!: Promise<void>
    act(() => {
      oldPending = retired()
    })
    old.unmount()
    const fresh = renderHook(() => useQueryValidationLens())
    act(() => {
      setDraft(fresh.result.current, mode, 'new identity input')
    })
    let newPending!: Promise<void>
    act(() => {
      newPending = action(fresh.result.current, mode)()
    })
    await act(async () => {
      await retired()
      finishes[0](response(mode, 'old'))
      await oldPending
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(running(fresh.result.current, mode)).toBe(true)
    await act(async () => {
      finishes[1](response(mode, 'new'))
      await newPending
    })
    const value =
      mode === 'sparql'
        ? fresh.result.current.sparqlBindings[0].s?.value
        : fresh.result.current.shaclResult?.summary.value
    expect(value).toBe('new')
  })
})

// spec: WEBUI-APPS-R049
it('tracks query and validation ownership independently', async () => {
  const { fetch, finishes } = deferredFetch()
  const { result } = renderHook(() => useQueryValidationLens())
  act(() => {
    result.current.setShaclSource('candidate')
  })
  let query!: Promise<void>, validation!: Promise<void>
  act(() => {
    query = result.current.runSparql()
    validation = result.current.runValidate()
  })
  expect(fetch).toHaveBeenCalledTimes(2)
  await act(async () => {
    finishes[0](response('sparql', 'query'))
    await query
  })
  expect(result.current.sparqlRunning).toBe(false)
  expect(result.current.shaclRunning).toBe(true)
  await act(async () => {
    finishes[1](response('shacl', 'validation'))
    await validation
  })
  expect(result.current.shaclRunning).toBe(false)
})
