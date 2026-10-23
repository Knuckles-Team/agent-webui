import { conversationOwnerKey } from '@/lib/chat-store'
import { useWorkspaceCommands } from './WorkspaceCommands'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api'
import { usePageContextPublisher } from '@/lib/page-context'
import { roleAtLeast } from '@/lib/nav-registry'
import { useIdentity } from '@/lib/auth'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import {
  EXPLORE_TOOLS,
  exploreHref,
  navigateExplore,
  parseExploreState,
  type ExploreState,
} from '@/lib/explore-workspace'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import type { ObjectSetResult } from '@/components/views/ObjectExplorerView'
import type { OntologyObject } from '@/components/views/ObjectView'

const button =
  'min-h-11 rounded-md border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary'

function useDestination(location: string) {
  try {
    return { state: parseExploreState(location), error: null }
  } catch (error) {
    return { state: { entity: null, tool: 'overview' } as ExploreState, error: String(error) }
  }
}

/** A new collection/entity composition, not legacy pages mounted inside tabs. */
export default function ExploreWorkspace() {
  const { identity, loading: identityLoading } = useIdentity()
  const canRead = !identityLoading && !identity.needsSignIn && roleAtLeast(identity.role, 'user')
  const location = useWorkspaceLocation()
  const { state, error: destinationError } = useDestination(location)
  const query = state.query ?? ''
  const started = state.query !== undefined
  const [draft, setDraft] = useState(query)
  useEffect(() => {
    setDraft(query)
  }, [query])
  const [navigationError, setNavigationError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const previous = useRef(location)
  const results = useQuery<ObjectSetResult>({
    queryKey: ['explore-workspace-search', identity.userKey, identity.raw?.tenant, query],
    queryFn: () => api.ontologySearch({ query, filters: [] }),
    enabled: started && canRead,
  })
  const object = useQuery<OntologyObject>({
    queryKey: ['explore-workspace-object', identity.userKey, identity.raw?.tenant, state.entity],
    queryFn: () => api.getOntologyObject(state.entity!, 'standard'),
    enabled: canRead && Boolean(state.entity) && !destinationError,
  })
  const commands = useMemo(
    () =>
      canRead
        ? (results.data?.objects ?? []).map((row) => ({
            id: row.id,
            label: row.title ?? row.id,
            href: exploreHref({ entity: row.id, tool: 'overview', query: state.query }),
          }))
        : [],
    [canRead, results.data, state.query],
  )
  useWorkspaceCommands(commands, conversationOwnerKey(identity))
  const conversationContext = useMemo(
    () => ({
      selection:
        canRead && object.data
          ? [
              {
                kind: 'ontology-object',
                id: object.data.id,
                label: (object.data.title ?? object.data.id).slice(0, 256),
              },
            ]
          : [],
      filters: { collectionQuery: query.slice(0, 256), evidenceTool: state.tool },
    }),
    [canRead, object.data, query, state.tool],
  )
  usePageContextPublisher(conversationContext)
  useEffect(() => {
    if (previous.current !== location && heading.current) {
      if (state.entity) heading.current.focus({ preventScroll: true })
      else searchInput.current?.focus({ preventScroll: true })
      previous.current = location
    }
  }, [location, state.entity])
  const transition = (next: ExploreState) => {
    try {
      navigateExplore({ ...next, query: next.query ?? state.query }, identity.role)
      setNavigationError('')
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : 'Navigation failed')
    }
  }
  const tools = useMemo(() => {
    if (!canRead) return []
    const schema = z.object({ entity: z.string().min(1).max(256).nullable(), tool: z.enum(EXPLORE_TOOLS) }).strict()
    const allowed = new Set([
      state.entity,
      ...(results.data?.objects.map((row) => row.id) ?? []),
      ...(object.data?.links.map((link) => link.target_id) ?? []),
    ])
    return [
      makeTool({
        name: 'agent-webui.explore.select',
        title: 'Select evidence in Explore',
        description:
          'Select a loaded result or related entity and its overview, relationships or history. Changes the visible workspace only.',
        inputSchema: schema,
        outputSchema: schema,
        jsonSchema: z.toJSONSchema(schema),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/ExploreWorkspace.tsx',
        execute: (next) => {
          if (next.entity !== null && !allowed.has(next.entity))
            throw new Error('Entity is outside the loaded evidence context')
          navigateExplore({ ...next, query: state.query }, identity.role)
          return next
        },
      }),
    ]
  }, [
    canRead,
    identity.role,
    identity.userKey,
    identity.raw?.tenant,
    object.data,
    results.data,
    state.entity,
    state.query,
  ])
  useWebMcpToolSet(tools)
  if (identityLoading) return <p role="status">Checking workspace access…</p>
  if (!canRead) return <p role="alert">Explore is not available for the current identity.</p>
  return (
    <section aria-label="Explore workspace" className="flex min-h-0 min-w-0 flex-col gap-3">
      <h1 className="text-xl font-semibold">Explore</h1>
      <nav aria-label="Evidence scope" className="flex flex-wrap items-center gap-2 text-sm">
        <button
          className={button}
          onClick={() => {
            transition({ entity: null, tool: 'overview' })
          }}
        >
          Evidence collection
        </button>
        {state.entity && (
          <>
            <span aria-hidden="true">/</span>
            <span className="break-all">{object.data?.title ?? state.entity}</span>
            <span aria-hidden="true">/</span>
            <span>{state.tool}</span>
          </>
        )}
      </nav>
      {(destinationError ?? navigationError) && <p role="alert">{destinationError ?? navigationError}</p>}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,2fr)]">
        <aside
          aria-label="Evidence collection"
          className={`${state.entity ? 'hidden lg:block' : ''} min-w-0 rounded-lg border p-3`}
        >
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (started && draft === query) void results.refetch()
              transition({ entity: null, tool: 'overview', query: draft })
            }}
          >
            <label className="min-w-0 flex-1 text-sm">
              Find evidence
              <input
                ref={searchInput}
                className="mt-1 min-h-11 w-full rounded border bg-background px-3"
                maxLength={4096}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                }}
              />
            </label>
            <button className={`${button} self-end`} type="submit">
              Search
            </button>
          </form>
          {!started && (
            <p className="py-4 text-sm text-muted-foreground">
              Search a collection, then inspect its evidence without leaving your task.
            </p>
          )}
          {started && results.isFetching && (
            <p role="status" className="py-3">
              Searching…
            </p>
          )}
          {results.isError && (
            <p role="alert" className="py-3">
              Evidence search is unavailable. Your query is retained; try again when the service is available.
            </p>
          )}
          {results.data && <p className="py-2 text-xs text-muted-foreground">{results.data.total} matching objects</p>}
          {results.data?.objects.length === 0 && (
            <p className="py-3 text-sm">No matching evidence. Try a different query.</p>
          )}
          <ul className="max-h-[55dvh] space-y-1 overflow-auto">
            {results.data?.objects.map((row) => (
              <li key={row.id}>
                <a
                  className={`${button} block break-words ${state.entity === row.id ? 'bg-accent' : ''}`}
                  href={exploreHref({ entity: row.id, tool: 'overview', query: state.query })}
                  onClick={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
                      event.preventDefault()
                      transition({ entity: row.id, tool: 'overview' })
                    }
                  }}
                  aria-current={state.entity === row.id ? 'true' : undefined}
                >
                  <span className="block font-medium">{row.title ?? row.id}</span>
                  <span className="text-xs text-muted-foreground">{row.type}</span>
                </a>
              </li>
            ))}
          </ul>
        </aside>
        <section
          aria-label="Selected evidence"
          className={`${!state.entity ? 'hidden lg:block' : ''} min-w-0 rounded-lg border p-3`}
        >
          <h2 ref={heading} tabIndex={-1} className="break-words text-lg font-semibold">
            {state.entity ? (object.data?.title ?? state.entity) : 'Your evidence stays in context'}
          </h2>
          {!state.entity && (
            <p className="mt-3 text-sm text-muted-foreground">
              Choose a result to inspect its properties, relationships and history here. Conversation and run state
              remain in the same workspace.
            </p>
          )}
          {state.entity && (
            <>
              <div role="group" aria-label="Evidence tools" className="my-3 flex flex-wrap gap-2">
                {EXPLORE_TOOLS.map((tool) => (
                  <button
                    key={tool}
                    className={button}
                    aria-pressed={state.tool === tool}
                    onClick={() => {
                      transition({ entity: state.entity, tool })
                    }}
                  >
                    {tool}
                  </button>
                ))}
              </div>
              {object.isFetching && <p role="status">Loading evidence…</p>}
              {object.isError && (
                <p role="alert">This evidence could not be loaded. It may be unavailable or not permitted.</p>
              )}
              {object.data && (
                <EvidenceDetails
                  object={object.data}
                  tool={state.tool}
                  onSelect={(entity) => {
                    transition({ entity, tool: 'overview' })
                  }}
                />
              )}
            </>
          )}
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        First redesigned read-only journey. Editing, advanced queries and the other contexts remain migration work; no
        provider or execution capability is implied.
      </p>
    </section>
  )
}

function EvidenceDetails({
  object,
  tool,
  onSelect,
}: {
  object: OntologyObject
  tool: ExploreState['tool']
  onSelect: (id: string) => void
}) {
  if (tool === 'relationships')
    return (
      <ul className="space-y-2">
        {object.links.length === 0 && <li>No relationships are available.</li>}
        {object.links.map((link, index) => (
          <li key={`${link.link_type}-${link.target_id}-${index}`}>
            <button
              className={`${button} w-full break-words text-left`}
              onClick={() => {
                onSelect(link.target_id)
              }}
            >
              <span className="text-xs text-muted-foreground">
                {link.link_type} {link.direction === 'in' ? '←' : '→'}{' '}
              </span>
              {link.target_title ?? link.target_id}
            </button>
          </li>
        ))}
      </ul>
    )
  if (tool === 'history')
    return (
      <ol className="space-y-2">
        {object.history.length === 0 && <li>No recorded edits.</li>}
        {object.history.map((edit) => (
          <li key={edit.edit_id} className="rounded border p-3 text-sm">
            <p className="break-words">
              {edit.kind} {edit.target}
            </p>
            <time>{edit.timestamp}</time>
            <p>{edit.actor ?? 'Actor not supplied'}</p>
          </li>
        ))}
      </ol>
    )
  return (
    <dl className="space-y-2">
      {object.properties.length === 0 && <div>No properties are available.</div>}
      {object.properties.map((property) => (
        <div key={property.name} className="rounded border p-3">
          <dt className="text-xs text-muted-foreground">{property.title ?? property.name}</dt>
          <dd className="break-all text-sm">
            {typeof property.value === 'string' ? property.value : JSON.stringify(property.value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
