import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { invoke } from '@/lib/graphos-api/invoke'
import { PLAN_REF } from '@/lib/graphos-api/identity'
import { matchRoute } from '@/lib/nav-registry'

/**
 * @file ConsoleConfirmView.tsx
 * @description The `console.confirm` deep link (requirement APIUI-02, part of
 * WEBUI-API-R001): attended confirmation of a server-held plan. A refused
 * effectful operation elsewhere in the app (e.g. `identity.ts::invokeIdentity`)
 * redirects here with a server-issued `plan_ref`; this page fetches that exact
 * plan and, on confirm, sends only the reference back — never the original
 * request arguments a browser tab could have tampered with. Built on the
 * shared `invoke` transport (`src/lib/graphos-api/invoke.ts`) already used by
 * identity, so no second HTTP/CSRF path is introduced.
 */

const planSchema = z.object({ plan_ref: z.string(), op: z.string(), preview: z.unknown() }).loose()
type Plan = z.infer<typeof planSchema>

/** The `:planRef` captured by the `console.confirm` route, or `null` when the
 * current location is not that route or the reference fails the shared
 * `PLAN_REF` format both this page and `identity.ts` validate against. */
function planRefFromLocation(): string | null {
  const match = matchRoute(window.location.pathname)
  if (match?.route.id !== 'console.confirm') return null
  const ref = match.params.planRef
  return ref && PLAN_REF.test(ref) ? ref : null
}

export default function ConsoleConfirmView() {
  const [planRef] = useState(planRefFromLocation)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!planRef) return
    const controller = new AbortController()
    invoke('plan.get', { plan_ref: planRef }, planSchema, { signal: controller.signal })
      .then(setPlan)
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
      await invoke('plan.confirm', { plan_ref: planRef }, z.unknown(), { planRef, idempotencyKey })
      setConfirmed(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Confirmation failed')
    } finally {
      setBusy(false)
    }
  }

  function handleConfirmClick() {
    confirm().catch(() => undefined)
  }

  if (!planRef) {
    return (
      <Card className="mx-auto max-w-2xl border-border/30 bg-muted/5">
        <CardContent className="py-12 text-center">
          <p role="alert">Invalid confirmation reference.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mx-auto max-w-2xl border-border/30 bg-card/60">
      <CardHeader>
        <CardTitle className="text-base font-bold">Confirm operation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert">{error}</p>}
        {!plan && !error && <p role="status">Loading confirmation plan…</p>}
        {plan && !confirmed && (
          <>
            <p className="text-sm text-muted-foreground">Operation: {plan.op}</p>
            <pre className="overflow-auto rounded-md border p-4 text-sm">{JSON.stringify(plan.preview, null, 2)}</pre>
            <Button type="button" disabled={busy} onClick={handleConfirmClick}>
              {busy ? 'Confirming…' : 'Confirm this operation'}
            </Button>
          </>
        )}
        {confirmed && <p role="status">Operation confirmed.</p>}
      </CardContent>
    </Card>
  )
}
