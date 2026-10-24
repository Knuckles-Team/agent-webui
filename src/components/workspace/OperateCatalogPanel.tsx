import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { z } from 'zod'
import type { FleetStatusSchema } from '@/lib/operate-workspace'
import { OperateComponentInspector } from './OperateComponentInspector'
import { readOperateCatalog } from '@/lib/operate-catalog'

type Catalog = Awaited<ReturnType<typeof readOperateCatalog>>
type RuntimeChildren = z.infer<typeof FleetStatusSchema>['value']['children']
export function OperateCatalogPanel({ generation, runtime }: { generation: string; runtime?: RuntimeChildren }) {
  const [filter, setFilter] = useState('')
  const catalog = useQuery({
    queryKey: ['operate-registration-catalog', generation],
    queryFn: ({ signal }) => readOperateCatalog(signal),
    retry: false,
    gcTime: 0,
  })
  const data = catalog.isError ? undefined : catalog.data
  return (
    <section aria-label="Connector catalog" className="min-w-0 space-y-2 rounded border p-3">
      <h2 className="font-medium">Connector catalog</h2>
      <p className="text-sm text-muted-foreground">
        Arbora catalog registrations. Registration availability does not establish a provider connection or permission
        to execute.
      </p>
      <label className="flex flex-col gap-1">
        Filter catalog connectors
        <input
          value={filter}
          maxLength={128}
          onChange={(event) => {
            setFilter(event.target.value)
          }}
        />
      </label>
      {catalog.isPending && <p role="status">Loading connector catalog…</p>}
      {catalog.isError && (
        <p role="alert">Connector catalog is not available. Access or the served catalog may be unavailable.</p>
      )}
      {data && (
        <CatalogServers
          key={`${generation}:${catalog.dataUpdatedAt}`}
          catalog={data}
          filter={filter}
          runtime={runtime}
        />
      )}
      <button
        type="button"
        disabled={catalog.isFetching}
        onClick={() => {
          void catalog.refetch()
        }}
      >
        Refresh connector catalog
      </button>
    </section>
  )
}

function CatalogServers({
  catalog,
  filter,
  runtime,
}: {
  catalog: Catalog
  runtime?: RuntimeChildren
  filter: string
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const { servers, components } = catalog
  const visible = servers.filter((server) => server.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <>
      <p>
        Showing {visible.length} of {servers.length} catalog connectors.
      </p>
      {servers.length === 0 && <p>No connectors in the returned catalog.</p>}
      {servers.length > 0 && visible.length === 0 && <p>No matching catalog connectors.</p>}
      {visible.map((server) => (
        <CatalogConnector
          key={server.server_id}
          server={server}
          components={components}
          runtime={runtime}
          selected={selected}
          onSelect={setSelected}
        />
      ))}
    </>
  )
}

function CatalogConnector({
  server,
  components,
  runtime,
  selected,
  onSelect,
}: {
  server: Catalog['servers'][number]
  components: Catalog['components']
  runtime?: RuntimeChildren
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const expanded = selected === server.server_id
  return (
    <article
      aria-label={`Catalog connector ${server.name}`}
      className="min-w-0 rounded border p-3 [overflow-wrap:anywhere]"
    >
      <h3>{server.name}</h3>
      <p>Registration: {server.status}</p>
      <p>Catalog tools: {server.tool_count}</p>
      <p>Provider connection: not reported by this catalog.</p>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          onSelect(expanded ? null : server.server_id)
        }}
      >
        Inspect {server.name}
      </button>
      {expanded && (
        <OperateComponentInspector
          key={server.server_id}
          server={server.name}
          runtimeState={runtime?.[server.name]?.state}
          components={components.filter((entry) => entry.server_name === server.name && entry.kind !== 'workflow')}
        />
      )}
    </article>
  )
}
