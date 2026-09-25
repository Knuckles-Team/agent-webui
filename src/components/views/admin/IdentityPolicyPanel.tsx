import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { invokeIdentity, type IdentityReply } from '@/lib/graphos-api/identity'

interface IdentityPolicy {
  epoch: number
  registration_policy: 'open' | 'invite' | 'admin_only' | 'disabled'
  local_fallback: 'off' | 'break_glass' | 'full'
  password_min_chars: number
  idle_ms?: number
  absolute_ms?: number
  privileged_idle_ms?: number
  privileged_absolute_ms?: number
}

const SESSION_FIELDS = [
  ['idle_ms', 'Idle timeout'],
  ['absolute_ms', 'Absolute lifetime'],
  ['privileged_idle_ms', 'Privileged idle timeout'],
  ['privileged_absolute_ms', 'Privileged absolute lifetime'],
] as const
type SessionField = (typeof SESSION_FIELDS)[number][0]

function validDurations(values: Partial<Record<SessionField, number>>): boolean {
  if (Object.values(values).some((value) => !Number.isInteger(value) || value < 60000 || value > 2592000000))
    return false
  if (values.idle_ms !== undefined && values.absolute_ms !== undefined && values.idle_ms > values.absolute_ms)
    return false
  if (
    values.privileged_idle_ms !== undefined &&
    values.idle_ms !== undefined &&
    values.privileged_idle_ms > values.idle_ms
  )
    return false
  if (
    values.privileged_absolute_ms !== undefined &&
    values.absolute_ms !== undefined &&
    values.privileged_absolute_ms > values.absolute_ms
  )
    return false
  return (
    values.privileged_idle_ms === undefined ||
    values.privileged_absolute_ms === undefined ||
    values.privileged_idle_ms <= values.privileged_absolute_ms
  )
}

export default function IdentityPolicyPanel() {
  const [state, setState] = useState<IdentityReply<IdentityPolicy> | null>(null)
  const [registration, setRegistration] = useState<IdentityPolicy['registration_policy']>('disabled')
  const [fallback, setFallback] = useState<IdentityPolicy['local_fallback']>('break_glass')
  const [minimum, setMinimum] = useState(12)
  const [durations, setDurations] = useState<Partial<Record<SessionField, number>>>({})
  const [outcome, setOutcome] = useState<IdentityReply<IdentityPolicy> | null>(null)
  useEffect(() => {
    let active = true
    void invokeIdentity<IdentityPolicy>('identity.policy.get').then((reply) => {
      if (!active) return
      setState(reply)
      if (reply.kind === 'ready') {
        setRegistration(reply.result.registration_policy)
        setFallback(reply.result.local_fallback)
        setMinimum(reply.result.password_min_chars)
        setDurations(
          Object.fromEntries(
            SESSION_FIELDS.flatMap(([key]) => (reply.result[key] === undefined ? [] : [[key, reply.result[key]]])),
          ),
        )
      }
    })
    return () => {
      active = false
    }
  }, [])
  const save = async () => {
    if (state?.kind !== 'ready') return
    const changedDurations = Object.fromEntries(
      SESSION_FIELDS.flatMap(([key]) => (durations[key] === state.result[key] ? [] : [[key, durations[key]]])),
    )
    const reply = await invokeIdentity<IdentityPolicy>('identity.policy.set', {
      expected_epoch: state.result.epoch,
      registration_policy: registration,
      local_fallback: fallback,
      password_min_chars: minimum,
      ...changedDurations,
    })
    setOutcome(reply)
    if (reply.kind === 'ready') setState(reply)
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity policy</CardTitle>
        <CardDescription>Policy changes use the current configuration epoch and require fresh MFA.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === null && <p role="status">Loading identity policy…</p>}
        {state !== null && state.kind !== 'ready' && <p role="status">{state.message}</p>}
        {state?.kind === 'ready' && (
          <>
            <label className="block text-sm" htmlFor="registration-policy">
              Registration
            </label>
            <select
              id="registration-policy"
              className="rounded border bg-background p-2"
              value={registration}
              onChange={(event) => {
                setRegistration(event.target.value as IdentityPolicy['registration_policy'])
              }}
            >
              <option value="disabled">Disabled</option>
              <option value="admin_only">Administrator only</option>
              <option value="invite">Invitation</option>
              <option value="open">Open</option>
            </select>
            <label className="block text-sm" htmlFor="policy-fallback">
              Local fallback
            </label>
            <select
              id="policy-fallback"
              className="rounded border bg-background p-2"
              value={fallback}
              onChange={(event) => {
                setFallback(event.target.value as IdentityPolicy['local_fallback'])
              }}
            >
              <option value="off">Off</option>
              <option value="break_glass">Break glass only</option>
              <option value="full">Full</option>
            </select>
            <label className="block text-sm" htmlFor="password-minimum">
              Minimum password length
            </label>
            <Input
              id="password-minimum"
              type="number"
              min={8}
              max={256}
              value={minimum}
              onChange={(event) => {
                setMinimum(Number(event.target.value))
              }}
            />
            {SESSION_FIELDS.map(([key, label]) =>
              durations[key] === undefined ? null : (
                <div key={key}>
                  <label className="block text-sm" htmlFor={key}>
                    {label} (minutes)
                  </label>
                  <Input
                    id={key}
                    type="number"
                    min={1}
                    max={43200}
                    value={Math.round(durations[key] / 60000)}
                    onChange={(event) => {
                      setDurations((current) => ({ ...current, [key]: Number(event.target.value) * 60000 }))
                    }}
                  />
                </div>
              ),
            )}
            <Button
              type="button"
              disabled={!Number.isInteger(minimum) || minimum < 8 || minimum > 256 || !validDurations(durations)}
              onClick={() => {
                void save()
              }}
            >
              Save identity policy
            </Button>
          </>
        )}
        {Object.keys(durations).length > 0 && (
          <p className="text-sm text-muted-foreground">
            Changing a session duration revokes existing sessions immediately.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          MFA policy editing is unavailable until the engine exposes those fields.
        </p>
        {outcome && <p role="status">{outcome.kind === 'ready' ? 'Identity policy saved.' : outcome.message}</p>}
      </CardContent>
    </Card>
  )
}
