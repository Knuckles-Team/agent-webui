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

type Durations = Partial<Record<SessionField, number>>

function allDurationsInRange(values: Durations): boolean {
  return Object.values(values).every((value) => Number.isInteger(value) && value >= 60000 && value <= 2592000000)
}

/** `a` must not exceed `b` when both are set; either being unset is not a violation. */
function doesNotExceed(a: number | undefined, b: number | undefined): boolean {
  return a === undefined || b === undefined || a <= b
}

function validDurations(values: Durations): boolean {
  return (
    allDurationsInRange(values) &&
    doesNotExceed(values.idle_ms, values.absolute_ms) &&
    doesNotExceed(values.privileged_idle_ms, values.idle_ms) &&
    doesNotExceed(values.privileged_absolute_ms, values.absolute_ms) &&
    doesNotExceed(values.privileged_idle_ms, values.privileged_absolute_ms)
  )
}

/** The duration fields a policy reply actually sets, keyed for `useState`. */
function readDurations(policy: IdentityPolicy): Durations {
  return Object.fromEntries(SESSION_FIELDS.flatMap(([key]) => (policy[key] === undefined ? [] : [[key, policy[key]]])))
}

/** Only the duration fields that differ from the last-known server state, so a
 *  save never resends an untouched field. */
function changedDurations(durations: Durations, previous: IdentityPolicy): Durations {
  return Object.fromEntries(
    SESSION_FIELDS.flatMap(([key]) => (durations[key] === previous[key] ? [] : [[key, durations[key]]])),
  )
}

function DurationField({
  field,
  label,
  valueMs,
  onChangeMs,
}: {
  field: SessionField
  label: string
  valueMs: number
  onChangeMs: (ms: number) => void
}) {
  return (
    <div>
      <label className="block text-sm" htmlFor={field}>
        {label} (minutes)
      </label>
      <Input
        id={field}
        type="number"
        min={1}
        max={43200}
        value={Math.round(valueMs / 60000)}
        onChange={(event) => {
          onChangeMs(Number(event.target.value) * 60000)
        }}
      />
    </div>
  )
}

function isPolicyInvalid(minimum: number, durations: Durations): boolean {
  if (!Number.isInteger(minimum) || minimum < 8 || minimum > 256) return true
  return !validDurations(durations)
}

function PolicyForm({
  registration,
  setRegistration,
  fallback,
  setFallback,
  minimum,
  setMinimum,
  durations,
  setDurations,
  onSave,
}: {
  registration: IdentityPolicy['registration_policy']
  setRegistration: (v: IdentityPolicy['registration_policy']) => void
  fallback: IdentityPolicy['local_fallback']
  setFallback: (v: IdentityPolicy['local_fallback']) => void
  minimum: number
  setMinimum: (v: number) => void
  durations: Durations
  setDurations: (update: (current: Durations) => Durations) => void
  onSave: () => void
}) {
  return (
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
      {SESSION_FIELDS.map(([key, label]) => {
        const valueMs = durations[key]
        if (valueMs === undefined) return null
        return (
          <DurationField
            key={key}
            field={key}
            label={label}
            valueMs={valueMs}
            onChangeMs={(ms) => {
              setDurations((current) => ({ ...current, [key]: ms }))
            }}
          />
        )
      })}
      <Button type="button" disabled={isPolicyInvalid(minimum, durations)} onClick={onSave}>
        Save identity policy
      </Button>
    </>
  )
}

export default function IdentityPolicyPanel() {
  const [state, setState] = useState<IdentityReply<IdentityPolicy> | null>(null)
  const [registration, setRegistration] = useState<IdentityPolicy['registration_policy']>('disabled')
  const [fallback, setFallback] = useState<IdentityPolicy['local_fallback']>('break_glass')
  const [minimum, setMinimum] = useState(12)
  const [durations, setDurations] = useState<Durations>({})
  const [outcome, setOutcome] = useState<IdentityReply<IdentityPolicy> | null>(null)

  const applyPolicyReply = (reply: IdentityReply<IdentityPolicy>) => {
    setState(reply)
    if (reply.kind !== 'ready') return
    setRegistration(reply.result.registration_policy)
    setFallback(reply.result.local_fallback)
    setMinimum(reply.result.password_min_chars)
    setDurations(readDurations(reply.result))
  }

  useEffect(() => {
    let active = true
    void invokeIdentity<IdentityPolicy>('identity.policy.get').then((reply) => {
      if (active) applyPolicyReply(reply)
    })
    return () => {
      active = false
    }
  }, [])

  const save = async () => {
    if (state?.kind !== 'ready') return
    const reply = await invokeIdentity<IdentityPolicy>('identity.policy.set', {
      expected_epoch: state.result.epoch,
      registration_policy: registration,
      local_fallback: fallback,
      password_min_chars: minimum,
      ...changedDurations(durations, state.result),
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
          <PolicyForm
            registration={registration}
            setRegistration={setRegistration}
            fallback={fallback}
            setFallback={setFallback}
            minimum={minimum}
            setMinimum={setMinimum}
            durations={durations}
            setDurations={setDurations}
            onSave={() => {
              void save()
            }}
          />
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
