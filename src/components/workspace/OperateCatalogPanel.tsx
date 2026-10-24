import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { readOperateCatalog } from '@/lib/operate-catalog'

export function OperateCatalogPanel({ generation }: { generation: string }) {
  const [filter, setFilter] = useState('')
  const catalog = useQuery({
    queryKey: ['operate-registration-catalog', generation],
    queryFn: ({ signal }) => readOperateCatalog(signal),
    retry: false,
    gcTime: 0,
  })
  const servers = catalog.isError ? undefined : catalog.data?.servers
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
      {servers && <CatalogServers servers={servers} filter={filter} />}
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
  servers,
  filter,
}: {
  servers: Awaited<ReturnType<typeof readOperateCatalog>>['servers']
  filter: string
}) {
  const visible = servers.filter((server) => server.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <>
      <p>
        Showing {visible.length} of {servers.length} catalog connectors.
      </p>
      {servers.length === 0 && <p>No connectors in the returned catalog.</p>}
      {servers.length > 0 && visible.length === 0 && <p>No matching catalog connectors.</p>}
      {visible.map((server) => (
        <article
          key={server.server_id}
          aria-label={`Catalog connector ${server.name}`}
          className="min-w-0 rounded border p-3 [overflow-wrap:anywhere]"
        >
          <h3>{server.name}</h3>
          <p>Registration: {server.status}</p>
          <p>Catalog tools: {server.tool_count}</p>
          <p>Provider connection: not reported by this catalog.</p>
        </article>
      ))}
    </>
  )
}
