import { useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { roleAtLeast } from '@/lib/nav-registry'
import { conversationOwnerKey } from '@/lib/chat-store'
import { useWorkspaceCommands } from './WorkspaceCommands'
import { useWorkspaceAdmission } from './useWorkspaceAdmission'
import { loadedOperateCommands } from './loaded-workspace-commands'
import { OperateUsageLens } from './OperateUsageLens'
import { OperateReadinessPanel } from './OperateReadinessPanel'
import { OperateCatalogPanel } from './OperateCatalogPanel'
import { OperateConnectorTiles } from './OperateConnectorTiles'
import { useIdentity, type Identity } from '@/lib/auth'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import {
  navigateOperate,
  operateApi,
  operateHref,
  OperateFleetSelectionSchema,
  parseOperateState,
  type OperateState,
} from '@/lib/operate-workspace'
const EMPTY: OperateState = { server: null, item: null, q: '' }
const control = 'min-h-11 rounded border px-3 py-2 text-sm break-words'
function readState(location: string) {
  try {
    return { state: parseOperateState(location), invalid: false }
  } catch {
    return { state: EMPTY, invalid: true }
  }
}
export default function OperateWorkspace() {
  const { identity, loading } = useIdentity()
  const generation = useWorkspaceAdmission(identity)
  if (loading) return <p role="status">Checking Operate access…</p>
  if (identity.needsSignIn || !roleAtLeast(identity.role, 'reader'))
    return <p role="alert">Operate is not available for this identity.</p>
  return <AuthorizedOperate key={generation} identity={identity} generation={generation} />
}
function AuthorizedOperate({ identity, generation }: { identity: Identity; generation: string }) {
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const location = useWorkspaceLocation()
  const { state, invalid } = readState(location)
  const latestNavigation = useRef(state)
  latestNavigation.current = state
  const heading = useRef<HTMLHeadingElement>(null)
  const selectedTip = `${state.lens ?? ''}\u0000${state.server ?? ''}\u0000${state.item ?? ''}`
  const previous = useRef(selectedTip)
  const status = useQuery({
    queryKey: ['operate-status', generation],
    queryFn: ({ signal }) => operateApi.status(signal),
    enabled: !invalid,
  })
  const catalog = useInfiniteQuery({
    queryKey: ['operate-catalog', generation],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => operateApi.catalog(pageParam, signal),
    enabled: !invalid,
    getNextPageParam: (last, pages) =>
      pages.length < 10 && !pages.slice(0, -1).some((page) => page.value.next_cursor === last.value.next_cursor)
        ? last.value.next_cursor
        : undefined,
  })
  const children = status.isError ? undefined : status.data?.value.children
  const items = useMemo(
    () => [
      ...new Map(
        ((catalog.isError ? [] : catalog.data?.pages.flatMap((page) => page.value.items)) ?? []).map((item) => [
          item.id,
          item,
        ]),
      ).values(),
    ],
    [catalog.data, catalog.isError],
  )
  const commands = useMemo(
    () => (invalid ? [] : loadedOperateCommands(parseOperateState(location), Object.keys(children ?? {}), items)),
    [invalid, location, children, items],
  )
  useWorkspaceCommands(commands, conversationOwnerKey(identity))
  const latestDiscovery = useRef({ children, items })
  latestDiscovery.current = { children, items }
  const selectedServer =
    state.server && children && Object.hasOwn(children, state.server) ? children[state.server] : undefined
  const selectedItem = items.find((item) => item.id === state.item && item.server === state.server)
  const serverItems = items.filter((item) => item.server === state.server)
  useEffect(() => {
    if (previous.current !== selectedTip) {
      heading.current?.focus()
      previous.current = selectedTip
    }
  }, [selectedTip])
  const tools = useMemo(
    () => [
      makeTool({
        name: 'agent-webui.operate.select',
        title: 'Select Operate context',
        description:
          'Navigate discovered fleet children and capabilities. Does not invoke, load, start or modify anything.',
        inputSchema: OperateFleetSelectionSchema,
        outputSchema: z.object({ selected: z.literal(true) }).strict(),
        jsonSchema: z.toJSONSchema(OperateFleetSelectionSchema),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/OperateWorkspace.tsx',
        execute: (next) => {
          if (!active.current) throw new Error('Operate admission has changed')
          const latest = latestDiscovery.current
          if (next.server && (!latest.children || !Object.hasOwn(latest.children, next.server)))
            throw new Error('Server is outside loaded fleet')
          if (next.item && !latest.items.some((item) => item.id === next.item && item.server === next.server))
            throw new Error('Capability is outside loaded fleet')
          navigateOperate({ ...latestNavigation.current, ...next, lens: 'services' }, identity.role)
          return { selected: true as const }
        },
      }),
    ],
    [children, items, identity.role],
  )
  useWebMcpToolSet(invalid ? [] : tools)
  function link(next: OperateState, label: string, selected = false) {
    return (
      <a
        href={operateHref(next)}
        className={control}
        aria-current={selected ? 'location' : undefined}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          navigateOperate(next, identity.role)
        }}
      >
        {label}
      </a>
    )
  }
  return (
    <section aria-label="Operate workspace" className="workspace-surface flex min-w-0 flex-col gap-3">
      <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold">
        Operate
      </h1>
      <p className="text-sm text-muted-foreground">
        Inspect service health, caller-visible capabilities and usage evidence in context. Discovery is not permission
        to execute.
      </p>
      {invalid ? (
        <p role="alert">
          Invalid Operate destination. <a href="/workspace/operate">Return to Operate</a>
        </p>
      ) : (
        <>
          <nav aria-label="Operate lenses" className="flex flex-wrap gap-2">
            {link({ ...state, lens: 'health' }, 'Health', state.lens === 'health')}
            {link({ ...state, lens: 'services' }, 'Services', state.lens === 'services')}
            {roleAtLeast(identity.role, 'user') && link({ ...state, lens: 'usage' }, 'Usage', state.lens === 'usage')}
          </nav>
          {state.lens === 'usage' ? (
            <OperateUsageLens identity={identity} generation={generation} state={state} />
          ) : (
            <>
              {state.lens !== 'services' && <OperateReadinessPanel generation={generation} />}
              {state.lens !== 'health' && (
                <>
                  <OperateCatalogPanel
                    generation={generation}
                    runtime={children}
                    state={state}
                    role={identity.role}
                    owner={conversationOwnerKey(identity)}
                  />
                  <label className="flex flex-col gap-1">
                    Filter fleet children
                    <input
                      className={control}
                      value={state.q}
                      maxLength={128}
                      onChange={(event) => {
                        navigateOperate({ ...state, q: event.target.value }, identity.role)
                      }}
                    />
                  </label>
                  <div className="workspace-panels">
                    <details open aria-label="Fleet children" className="min-w-0 space-y-2 rounded border p-3">
                      <summary className="workspace-pane-toggle">
                        <h2 className="inline font-semibold">Fleet</h2>
                      </summary>
                      {status.isPending && <p role="status">Loading fleet…</p>}
                      {status.isError && (
                        <p role="alert">
                          Fleet status could not be confirmed. Access or the served operation may be unavailable.
                        </p>
                      )}
                      {!status.isError && children && (
                        <OperateConnectorTiles
                          childrenByName={children}
                          filter={state.q}
                          selected={state.server}
                          renderLink={(server) =>
                            link({ ...state, server, item: null }, server, state.server === server)
                          }
                        />
                      )}
                      <button
                        className={control}
                        onClick={() => {
                          void status.refetch()
                        }}
                        disabled={status.isFetching}
                      >
                        Refresh fleet
                      </button>
                    </details>
                    <section aria-label="Connector detail" className="min-w-0 space-y-3 rounded border p-3">
                      <h2 className="break-words font-medium">{state.server ?? 'Choose a fleet child'}</h2>
                      {state.server && !selectedServer && !status.isPending && (
                        <p role="alert">This child is not confirmed in the visible fleet.</p>
                      )}
                      {selectedServer && (
                        <>
                          <p>
                            Reported state: {selectedServer.state}. Process state does not guarantee tools are
                            callable.
                          </p>
                          {selectedServer.mounted_tools !== undefined && (
                            <p>Mounted tools: {selectedServer.mounted_tools}</p>
                          )}
                          {selectedServer.in_flight !== undefined && <p>In flight: {selectedServer.in_flight}</p>}
                          <h3 className="font-medium">Capabilities</h3>
                          {catalog.data && (
                            <p>
                              Loaded {items.length} capabilities across {catalog.data.pages.length} catalog pages.
                            </p>
                          )}
                          {catalog.isPending && <p role="status">Loading catalog…</p>}
                          {catalog.isError && (
                            <p role="alert">Capabilities could not be confirmed. No empty-catalog claim is made.</p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {serverItems.map((item) => (
                              <div key={item.id}>
                                {link({ ...state, item: item.id }, item.name, item.id === state.item)}
                              </div>
                            ))}
                          </div>
                          {catalog.data && !catalog.isError && !serverItems.length && (
                            <p>No capabilities for this child in the loaded catalog pages.</p>
                          )}
                          {state.item && !selectedItem && (
                            <p role="alert">
                              This capability is not in the loaded caller-visible catalog. Load more pages if
                              available.
                            </p>
                          )}
                          {selectedItem && (
                            <article
                              aria-label="Capability detail"
                              className="rounded border p-3 [overflow-wrap:anywhere]"
                            >
                              <h3 className="font-medium">{selectedItem.name}</h3>
                              <p>
                                {selectedItem.kind} · {selectedItem.id}
                              </p>
                              <p>{selectedItem.description ?? 'No description supplied.'}</p>
                              <p>Execution is not enabled in this workspace.</p>
                            </article>
                          )}
                          <button
                            className={control}
                            disabled={!catalog.hasNextPage || catalog.isFetching}
                            onClick={() => {
                              void catalog.fetchNextPage()
                            }}
                          >
                            Load more capabilities
                          </button>
                          {catalog.data &&
                            !catalog.hasNextPage &&
                            catalog.data.pages.at(-1)?.value.next_cursor &&
                            catalog.data.pages.length < 10 && (
                              <p role="status">
                                Catalog pagination repeated a cursor. This is a partial preview; refresh to retry.
                              </p>
                            )}
                          {catalog.data?.pages.length === 10 && (
                            <p>
                              The 10-page preview limit was reached. Full catalog search remains a migration
                              requirement.
                            </p>
                          )}
                          <button
                            className={control}
                            disabled={catalog.isFetching}
                            onClick={() => {
                              void catalog.refetch()
                            }}
                          >
                            Refresh capabilities
                          </button>
                        </>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Host launch, connector configuration, containment, approvals and tool execution remain separate
                        migration requirements; this view does not perform them.
                      </p>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
