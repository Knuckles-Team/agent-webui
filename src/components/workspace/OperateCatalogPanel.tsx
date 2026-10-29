import { workspaceButtonClass } from '@/components/ui/button'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { z } from 'zod'
import { operateHref, parseOperateState, type FleetStatusSchema, type OperateState } from '@/lib/operate-workspace'
import type { Role } from '@/lib/nav-registry'
import { useWorkspaceCommands } from './WorkspaceCommands'
import { loadedCatalogCommands } from './loaded-workspace-commands'
import { CatalogNavigationLink, OperateComponentInspector } from './OperateComponentInspector'
import { readOperateCatalog } from '@/lib/operate-catalog'

type Catalog = Awaited<ReturnType<typeof readOperateCatalog>>
type RuntimeChildren = z.infer<typeof FleetStatusSchema>['value']['children']
interface Navigation {
  state: OperateState
  role: Role
}
export function OperateCatalogPanel({
  generation,
  runtime,
  state,
  role,
  owner,
}: {
  generation: string
  runtime?: RuntimeChildren
  owner: string
} & Navigation) {
  const [filter, setFilter] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const focused = useRef('')
  const catalog = useQuery({
    queryKey: ['operate-registration-catalog', generation],
    queryFn: ({ signal }) => readOperateCatalog(signal),
    retry: false,
    gcTime: 0,
  })
  const data = catalog.isError || catalog.isFetching ? undefined : catalog.data
  const href = operateHref(state)
  const commands = useMemo(
    () => loadedCatalogCommands(parseOperateState(href), data?.servers ?? [], data?.components ?? []),
    [href, data],
  )
  useWorkspaceCommands(commands, owner)
  const arrival = JSON.stringify([state.connector, state.definition])
  useEffect(() => {
    if (focused.current === arrival) return
    if (!state.connector) {
      focused.current = arrival
      return
    }
    if (data && heading.current) {
      heading.current.focus({ preventScroll: true })
      focused.current = arrival
    }
  }, [arrival, data, state.connector])
  return (
    <section aria-label="Connector catalog" className="operate-panel min-w-0 space-y-2">
      <h2 className="font-medium">Connector catalog</h2>
      <p className="text-sm text-muted-foreground">
        Arbora catalog registrations. Registration availability does not establish a provider connection or permission
        to execute.
      </p>
      <label className="flex flex-col gap-1">
        Filter catalog connectors
        <input
          className="min-h-11 min-w-0 rounded border px-3"
          value={filter}
          maxLength={128}
          onChange={(event) => {
            setFilter(event.target.value)
          }}
        />
      </label>
      {catalog.isFetching && <p role="status">Loading connector catalog…</p>}
      {catalog.isError && (
        <p role="alert">Connector catalog is not available. Access or the served catalog may be unavailable.</p>
      )}
      {data && (
        <CatalogServers
          key={generation}
          catalog={data}
          filter={filter}
          runtime={runtime}
          state={state}
          role={role}
          heading={heading}
        />
      )}
      <button
        type="button"
        className={workspaceButtonClass}
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
  state,
  role,
  heading,
}: {
  heading: RefObject<HTMLHeadingElement | null>
  catalog: Catalog
  runtime?: RuntimeChildren
  filter: string
} & Navigation) {
  const { servers, components } = catalog
  const selected = servers.find((server) => server.server_id === state.connector)
  const visible = servers.filter((server) => server.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <>
      <p>
        Showing {visible.length} of {servers.length} catalog connectors.
      </p>
      {servers.length === 0 && <p>No connectors in the returned catalog.</p>}
      {servers.length > 0 && visible.length === 0 && <p>No matching catalog connectors.</p>}
      {state.connector && !selected && (
        <p role="alert">This connector is not in the current caller-visible catalog.</p>
      )}
      {selected && !visible.includes(selected) && <p role="status">The selected connector is outside this filter.</p>}
      {(selected && !visible.includes(selected) ? [selected, ...visible] : visible).map((server) => (
        <CatalogConnector
          key={server.server_id}
          server={server}
          components={components}
          runtime={runtime}
          state={state}
          role={role}
          heading={heading}
        />
      ))}
    </>
  )
}

function CatalogConnector({
  server,
  components,
  runtime,
  state,
  role,
  heading,
}: {
  heading: RefObject<HTMLHeadingElement | null>
  server: Catalog['servers'][number]
  components: Catalog['components']
  runtime?: RuntimeChildren
} & Navigation) {
  const expanded = state.connector === server.server_id
  const next = { ...state, connector: expanded ? undefined : server.server_id, definition: undefined }
  return (
    <article
      aria-label={`Catalog connector ${server.name}`}
      className="operate-reading min-w-0 rounded border p-3 [overflow-wrap:anywhere]"
    >
      <h3>{server.name}</h3>
      <p>Registration: {server.status}</p>
      <p>Catalog tools: {server.tool_count}</p>
      <p>Provider connection: not reported by this catalog.</p>
      <CatalogNavigationLink state={next} role={role} expanded={expanded}>
        Inspect {server.name}
      </CatalogNavigationLink>
      {expanded && (
        <OperateComponentInspector
          key={server.server_id}
          server={server.name}
          runtimeState={runtime?.[server.name]?.state}
          state={state}
          role={role}
          heading={heading}
          components={components.filter((entry) => entry.server_name === server.name && entry.kind !== 'workflow')}
        />
      )}
    </article>
  )
}
