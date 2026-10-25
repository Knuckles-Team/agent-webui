import { workspaceButtonClass } from '@/components/ui/button'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { focusReadinessOnArrival } from '@/lib/operate-compatibility'
import { readinessFailureMessage, readOperateReadiness, type OperateReadiness } from '@/lib/operate-readiness'

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
    <section aria-label="Readiness diagnosis" className="operate-panel min-w-0 space-y-3 [overflow-wrap:anywhere]">
      <h2 ref={focusReadinessOnArrival} tabIndex={-1} className="font-medium">
        Readiness diagnosis
      </h2>
      <p>Inspect the checks reported by this deployment. Absent checks provide no evidence of readiness.</p>
      <button
        type="button"
        className={workspaceButtonClass}
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
      {query.isError && <p role="alert">{readinessFailureMessage(query.error)}</p>}
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
            className={workspaceButtonClass}
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
        <section aria-label={`Readiness check ${selected}`} className="operate-reading min-w-0 rounded border p-3">
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
