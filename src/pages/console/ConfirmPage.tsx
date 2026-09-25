/** Attended GraphOS confirmation. The server owns plan validity and authority. */
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { invoke } from '@/lib/graphos-api/invoke'

const PLAN_REF = /^graphos_plan:[0-9a-f]{48}$/
const planSchema = z.object({ plan_ref: z.string(), op: z.string(), preview: z.unknown() }).loose()
type Plan = z.infer<typeof planSchema>

function refFromPath(): string | null {
  const raw = /^\/console\/confirm\/([^/]+)$/.exec(window.location.pathname)?.[1]
  if (!raw) return null
  try {
    const value = decodeURIComponent(raw)
    return PLAN_REF.test(value) ? value : null
  } catch {
    return null
  }
}

export default function ConfirmPage() {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const planRef = refFromPath()

  useEffect(() => {
    if (!planRef) return
    const controller = new AbortController()
    void invoke('plan.get', { plan_ref: planRef }, planSchema, { signal: controller.signal })
      .then((received) => {
        setPlan(received)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Plan unavailable')
      })
    return () => {
      controller.abort()
    }
  }, [planRef])

  async function confirm() {
    if (!planRef || !plan || busy) return
    setBusy(true)
    setError(null)
    try {
      const idempotencyKey = crypto.randomUUID()
      await invoke('plan.confirm', { plan_ref: planRef, idempotency_key: idempotencyKey }, z.unknown(), {
        idempotencyKey,
      })
      setConfirmed(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Confirmation failed')
    } finally {
      setBusy(false)
    }
  }

  function handleConfirmClick() {
    confirm().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Confirmation failed')
    })
  }

  if (!planRef) return <p role="alert">Invalid confirmation reference.</p>
  return (
    <article className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Confirm operation</h1>
      {error && <p role="alert">{error}</p>}
      {!plan && !error && <p role="status">Loading confirmation plan…</p>}
      {plan && !confirmed && (
        <>
          <p>Operation: {plan.op}</p>
          <pre className="overflow-auto rounded-md border p-4 text-sm">{JSON.stringify(plan.preview, null, 2)}</pre>
          <button type="button" disabled={busy} onClick={handleConfirmClick}>
            {busy ? 'Confirming…' : 'Confirm this operation'}
          </button>
        </>
      )}
      {confirmed && <p role="status">Operation confirmed.</p>}
    </article>
  )
}
