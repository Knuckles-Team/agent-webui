import type { ReactNode } from 'react'
import type { z } from 'zod'
import type { FleetStatusSchema } from '@/lib/operate-workspace'

type FleetChildren = z.infer<typeof FleetStatusSchema>['value']['children']

/** Read-only connector inventory; process state never implies permission to call. */
export function OperateConnectorTiles({
  childrenByName,
  filter,
  selected,
  renderLink,
}: {
  childrenByName: FleetChildren
  filter: string
  selected: string | null
  renderLink: (server: string) => ReactNode
}) {
  const names = Object.keys(childrenByName)
  const visible = names.filter((name) => name.toLowerCase().includes(filter.toLowerCase()))
  if (!names.length) return <p>No connectors were reported by Arbora.</p>
  if (!visible.length) return <p>No matching fleet children.</p>
  return (
    <div aria-label="Connector tiles" className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Showing {visible.length} of {names.length} reported connectors. Process state does not confirm connectivity or
        permission to execute.
      </p>
      {visible.map((name) => {
        const child = childrenByName[name]
        return (
          <article
            key={name}
            aria-label={`Connector ${name}`}
            className="min-w-0 space-y-2 rounded border p-3 [overflow-wrap:anywhere]"
          >
            <h3 className="flex min-w-0 flex-col">{renderLink(name)}</h3>
            {selected === name && <p className="text-xs">Selected connector</p>}
            <p className="text-sm">Reported state: {child.state}</p>
            <dl className="grid grid-cols-2 gap-1 text-xs">
              {(
                [
                  ['Mounted tools', child.mounted_tools],
                  ['In flight', child.in_flight],
                  ['Queued', child.queued],
                  ['Restarts', child.restart_count],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value ?? 'Not available'}</dd>
                </div>
              ))}
            </dl>
          </article>
        )
      })}
    </div>
  )
}
