import { useState } from 'react'
import type { OperateComponent } from '@/lib/operate-catalog'

export function OperateComponentInspector({
  server,
  runtimeState,
  components,
}: {
  server: string
  runtimeState?: string
  components: OperateComponent[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const component = components.find((entry) => entry.id === selected)
  return (
    <section aria-label={`Inspect connector ${server}`} className="min-w-0 space-y-2">
      <p>MCP runtime: {runtimeState ?? 'not reported'}</p>
      <p className="text-sm text-muted-foreground">
        Runtime state describes MCP transport, not upstream provider connectivity.
      </p>
      <h4>Catalog tools and skills</h4>
      {components.length === 0 && <p>No tool or skill definitions returned for this connector.</p>}
      {components.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-pressed={selected === entry.id}
          onClick={() => {
            setSelected(entry.id)
          }}
        >
          {entry.kind}: {entry.name}
        </button>
      ))}
      {component && (
        <section
          aria-label="Selected catalog definition"
          className="min-w-0 rounded border p-3 [overflow-wrap:anywhere]"
        >
          <h5>{component.name}</h5>
          <p>{component.description || 'No description supplied.'}</p>
          <dl>
            <dt>Identity</dt>
            <dd>{component.id}</dd>
            <dt>Kind</dt>
            <dd>{component.kind}</dd>
            <dt>Lifecycle</dt>
            <dd>{component.status}</dd>
            <dt>Authority</dt>
            <dd>{component.authority}</dd>
            <dt>Revision</dt>
            <dd>{component.revision ?? 'not reported'}</dd>
            <dt>Definition digest</dt>
            <dd>{component.definition_digest ?? 'not reported'}</dd>
            <dt>Content digest</dt>
            <dd>{component.content_digest ?? 'not reported'}</dd>
          </dl>
          <p>Definition inspection does not grant execution permission.</p>
        </section>
      )}
    </section>
  )
}
