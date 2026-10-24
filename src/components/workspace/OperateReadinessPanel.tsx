import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { readOperateReadiness, type OperateReadiness } from '@/lib/operate-readiness'

export function OperateReadinessPanel({ generation }: { generation: string }) {
  const [reprobing, setReprobing] = useState(false)
  const query = useQuery({
    queryKey: ['operate-readiness', generation],
    queryFn: ({ signal }) => readOperateReadiness(signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const busy = query.isFetching || reprobing
  const snapshot = query.isError || busy ? undefined : query.data
  return (
    <section
      aria-label="Readiness diagnosis"
      className="min-w-0 space-y-3 rounded border p-3 [overflow-wrap:anywhere]"
    >
      <h2 className="font-medium">Readiness diagnosis</h2>
      <p>Inspect the checks reported by this deployment. Absent checks provide no evidence of readiness.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setReprobing(true)
          void query.refetch().finally(() => {
            setReprobing(false)
          })
        }}
      >
        Reprobe readiness
      </button>
      {busy && <p role="status">Probing readiness; previous evidence is withdrawn…</p>}
      {query.isError && (
        <p role="alert">
          Readiness evidence could not be retrieved or validated. Access or the service may be unavailable.
        </p>
      )}
      {snapshot && <ReadinessDiagnosis key={`${generation}:${query.dataUpdatedAt}`} snapshot={snapshot} />}
    </section>
  )
}

function ReadinessDiagnosis({ snapshot }: { snapshot: OperateReadiness }) {
  const [selected, setSelected] = useState<string | null>(null)
  const checks = Object.entries(snapshot.checks)
  return (
    <div className="min-w-0 space-y-3">
      <p>Backend readiness: {snapshot.overall}</p>
      <dl>
        <dt>Snapshot</dt>
        <dd>{snapshot.snapshot_id}</dd>
        <dt>Observed at</dt>
        <dd>{snapshot.observed_at}</dd>
      </dl>
      <ReportedReasons label="Required failures" reasons={snapshot.required_failures} />
      <ReportedReasons label="Degraded reasons" reasons={snapshot.degraded_reasons} />
      {checks.length === 0 && <p>No checks were returned.</p>}
      <div className="flex flex-wrap gap-2" aria-label="Reported readiness checks">
        {checks.map(([name, check]) => (
          <button
            key={name}
            type="button"
            className="min-h-11 min-w-0 max-w-full rounded border px-3 py-2 break-words"
            aria-pressed={selected === name}
            onClick={() => {
              setSelected(name)
            }}
          >
            {name}: {check.state}
          </button>
        ))}
      </div>
      {selected && (
        <section aria-label={`Readiness check ${selected}`} className="min-w-0 rounded border p-3">
          <h3>{selected}</h3>
          <p>Evidence from snapshot {snapshot.snapshot_id}</p>
          <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {JSON.stringify(snapshot.checks[selected], null, 2)}
          </pre>
        </section>
      )}
    </div>
  )
}

function ReportedReasons({ label, reasons }: { label: string; reasons: string[] }) {
  return (
    <section aria-label={label}>
      <h3>{label}</h3>
      {reasons.length ? (
        <ul>
          {reasons.map((reason, index) => (
            <li key={`${index}:${reason}`}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p>None reported.</p>
      )}
    </section>
  )
}
