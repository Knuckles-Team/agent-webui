import { ArrowUpRight, ChevronRight, FileText, FolderSearch, Search, X } from 'lucide-react'
import './ExploreWorkspace.css'
import { conversationOwnerKey } from '@/lib/chat-store'
import {
  parseExploreLensState,
  exploreLensHref,
  navigateExploreLens,
  type ExploreLensState,
} from '@/lib/explore-lens-state'
import { useWorkspaceCommands } from './WorkspaceCommands'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api'
import { usePageContextPublisher } from '@/lib/page-context'
import { roleAtLeast } from '@/lib/nav-registry'
import { useIdentity } from '@/lib/auth'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import { EXPLORE_TOOLS, type ExploreState } from '@/lib/explore-workspace'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import type { ObjectSetResult } from '@/components/views/ObjectExplorerView'
import type { OntologyObject } from '@/components/views/ObjectView'

const button = 'explore-control'
const revealNavigationFocus = () => true

function useDestination(location: string) {
  return useMemo<{ state: ExploreLensState; error: string | null }>(() => {
    try {
      return { state: parseExploreLensState(location), error: null }
    } catch (error) {
      return { state: { entity: null, tool: 'overview', lens: 'evidence' }, error: String(error) }
    }
  }, [location])
}

/** A new collection/entity composition, not legacy pages mounted inside tabs. */
export default function ExploreWorkspace({
  active = true,
  showHeading = true,
  revealFocus = revealNavigationFocus,
}: {
  active?: boolean
  showHeading?: boolean
  revealFocus?: () => boolean
}) {
  const { identity, loading: identityLoading } = useIdentity()
  const canRead = active && !identityLoading && !identity.needsSignIn && roleAtLeast(identity.role, 'user')
  const location = useWorkspaceLocation()
  const { state, error: destinationError } = useDestination(location)
  const workspaceLens = state.lens
  const query = state.query ?? ''
  const started = state.query !== undefined
  const [draft, setDraft] = useState(query)
  useEffect(() => {
    setDraft(query)
  }, [query])
  const [navigationError, setNavigationError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const collection = useRef<HTMLDetailsElement>(null)
  const previous = useRef<string | null>(null)
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
  const collectionData = canRead && !results.isFetching && !results.isError ? results.data : undefined
  const selectedData =
    canRead && !object.isFetching && !object.isError && object.data?.id === state.entity ? object.data : undefined
  const displayedObject = useMemo(() => {
    if (!selectedData) return undefined
    const records = collectionData?.objects ?? []
    const titles = new Map(records.map((record) => [record.id, record.title]))
    return {
      ...selectedData,
      links: selectedData.links.map((link) => ({
        ...link,
        target_title: link.target_title ?? titles.get(link.target_id),
      })),
    }
  }, [selectedData, collectionData])
  const commands = useMemo(
    () =>
      canRead
        ? (collectionData?.objects ?? []).map((row) => ({
            id: row.id,
            label: row.title ?? row.id,
            href: exploreLensHref({ ...state, entity: row.id, tool: 'overview', lens: 'evidence' }),
          }))
        : [],
    [canRead, collectionData, state],
  )
  useWorkspaceCommands(commands, conversationOwnerKey(identity))
  const conversationContext = useMemo(
    () => ({
      selection:
        canRead && selectedData
          ? [
              {
                kind: 'ontology-object',
                id: selectedData.id,
                label: (selectedData.title ?? selectedData.id).slice(0, 256),
              },
            ]
          : [],
      filters: { collectionQuery: query.slice(0, 256), evidenceTool: state.tool, workspaceLens },
    }),
    [canRead, selectedData, query, state.tool, workspaceLens],
  )
  usePageContextPublisher(conversationContext)
  useEffect(() => {
    if (!canRead) {
      previous.current = null
      return
    }
    if (previous.current === location) return
    const target = state.entity ? heading.current : searchInput.current
    if (!target) return
    previous.current = location
    // Do not steal focus on fresh entry. Native navigation focus reveals the task.
    if (revealFocus()) target.focus()
  }, [canRead, location, state.entity, revealFocus])
  const transition = (next: ExploreState) => {
    try {
      navigateExploreLens({ ...state, ...next, query: next.query ?? state.query, lens: 'evidence' }, identity.role, [
        'evidence',
      ])
      setNavigationError('')
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : 'Navigation failed')
    }
  }
  const toolGeneration = useMemo(
    () => ({}),
    [
      canRead,
      identity.role,
      identity.userKey,
      identity.raw?.tenant,
      selectedData,
      collectionData,
      state.entity,
      state.query,
      state.tool,
      state.graphNode,
      state.graphType,
    ],
  )
  const liveToolGeneration = useRef(toolGeneration)
  liveToolGeneration.current = toolGeneration
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const tools = useMemo(() => {
    if (!canRead) return []
    const schema = z.object({ entity: z.string().min(1).max(256).nullable(), tool: z.enum(EXPLORE_TOOLS) }).strict()
    const allowed = new Set([
      state.entity,
      ...(collectionData?.objects.map((row) => row.id) ?? []),
      ...(selectedData?.links.map((link) => link.target_id) ?? []),
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
          if (!mounted.current || liveToolGeneration.current !== toolGeneration)
            throw new Error('Evidence navigation context is stale')
          if (next.entity !== null && !allowed.has(next.entity))
            throw new Error('Entity is outside the loaded evidence context')
          navigateExploreLens({ ...state, ...next, lens: 'evidence' }, identity.role, ['evidence'])
          return next
        },
      }),
    ]
  }, [
    toolGeneration,
    canRead,
    identity.role,
    identity.userKey,
    identity.raw?.tenant,
    selectedData,
    collectionData,
    state.entity,
    state,
  ])
  useWebMcpToolSet(tools)
  if (identityLoading) return <p role="status">Checking workspace access…</p>
  if (!canRead) return <p role="alert">Knowledge is not available for the current identity.</p>
  return (
    <section
      aria-label="Knowledge workspace"
      className="workspace-surface explore-workspace flex min-h-0 min-w-0 flex-col gap-3"
    >
      {showHeading && <h1 className="text-xl font-semibold">Knowledge</h1>}
      <nav aria-label="Evidence scope" className="flex flex-wrap items-center gap-2 text-sm">
        <button
          className={button}
          onClick={() => {
            if (collection.current) collection.current.open = true
            transition({ entity: null, tool: 'overview' })
            searchInput.current?.focus()
          }}
        >
          Evidence collection
        </button>
        {state.entity && (
          <>
            <span aria-hidden="true">/</span>
            <span className="break-all">{selectedData?.title ?? state.entity}</span>
            <span aria-hidden="true">/</span>
            <span>{state.tool}</span>
          </>
        )}
      </nav>
      {(destinationError ?? navigationError) && <p role="alert">{destinationError ?? navigationError}</p>}
      <div className="workspace-panels explore-panels" data-selected={Boolean(state.entity)}>
        <details ref={collection} open aria-label="Search knowledge" className="explore-collection">
          <summary className="workspace-pane-toggle">
            <FolderSearch size={18} aria-hidden="true" />
            <h2 className="inline font-semibold">Search knowledge</h2>
            {!results.isError && results.data && (
              <span className="explore-collection-count">{results.data.total} items</span>
            )}
          </summary>
          <p className="explore-collection-description">
            Find stored records and inspect their details, related records and change history.
          </p>
          <form
            className="explore-search"
            onSubmit={(event) => {
              event.preventDefault()
              if (started && draft === query) void results.refetch()
              transition({ entity: null, tool: 'overview', query: draft })
            }}
          >
            <label className="min-w-0 flex-1 text-sm">
              Search knowledge
              <span className="explore-search-field">
                <Search size={17} aria-hidden="true" />
                <input
                  ref={searchInput}
                  className="explore-search-input"
                  placeholder="Search stored records"
                  maxLength={4096}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                  }}
                />
              </span>
            </label>
            <button className={`${button} self-end`} type="submit">
              Search
            </button>
          </form>
          {!started && (
            <p className="py-4 text-sm text-muted-foreground">
              Search for information stored in Arbora. Results depend on the connected knowledge service and your
              access.
            </p>
          )}
          {started && results.isFetching && (
            <p role="status" className="py-3">
              Searching…
            </p>
          )}
          {results.isError && (
            <p role="alert" className="py-3">
              Knowledge search is unavailable. Your query is retained; try again when the service is available.
            </p>
          )}
          {collectionData && (
            <p className="py-2 text-xs text-muted-foreground">{collectionData.total} matching records</p>
          )}
          {collectionData?.objects.length === 0 && (
            <p className="py-3 text-sm">No matching records. Try a different query.</p>
          )}
          <ul className="explore-records" aria-label="Knowledge results">
            {collectionData?.objects.map((row) => (
              <li key={row.id}>
                <a
                  className="explore-record"
                  href={exploreLensHref({ ...state, entity: row.id, tool: 'overview', lens: 'evidence' })}
                  onClick={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
                      event.preventDefault()
                      transition({ entity: row.id, tool: 'overview' })
                    }
                  }}
                  aria-current={state.entity === row.id ? 'true' : undefined}
                >
                  <span className="explore-record-icon" aria-hidden="true">
                    <FileText size={18} />
                  </span>
                  <span className="explore-record-label">
                    <span className="block font-medium">{row.title ?? row.id}</span>
                    <span className="explore-record-type">{row.type}</span>
                    {typeof row.properties?.summary === 'string' && (
                      <span className="explore-record-summary">{row.properties.summary}</span>
                    )}
                    {typeof row.properties?.source === 'string' && (
                      <span className="explore-record-source">{row.properties.source}</span>
                    )}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" className="explore-record-arrow" />
                </a>
              </li>
            ))}
          </ul>
        </details>
        {state.entity && (
          <section aria-label="Record details" className="explore-inspector">
            <nav aria-label="Record location" className="explore-scope flex flex-wrap items-center gap-2 text-sm">
              <button
                className={button}
                onClick={() => {
                  if (collection.current) collection.current.open = true
                  transition({ entity: null, tool: 'overview' })
                  searchInput.current?.focus()
                }}
              >
                Search knowledge
              </button>
              {state.entity && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="break-all">{selectedData?.title ?? state.entity}</span>
                  <span aria-hidden="true">/</span>
                  <span>
                    {{ overview: 'Details', relationships: 'Related records', history: 'Change history' }[state.tool]}
                  </span>
                </>
              )}
            </nav>
            <div className="explore-inspector-heading">
              <div className="min-w-0">
                <span className="explore-eyebrow">{selectedData?.object_type ?? 'Record details'}</span>
                <h2 ref={heading} tabIndex={-1} className="break-words text-lg font-semibold">
                  {selectedData?.title ?? state.entity}
                </h2>
              </div>
              <button
                className="explore-control explore-close"
                aria-label="Close record details"
                onClick={() => {
                  if (collection.current) collection.current.open = true
                  transition({ entity: null, tool: 'overview' })
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {state.entity && (
              <>
                <div role="group" aria-label="Record views" className="my-3 flex flex-wrap gap-2">
                  {EXPLORE_TOOLS.map((tool) => (
                    <button
                      key={{ overview: 'Details', relationships: 'Related records', history: 'Change history' }[tool]}
                      className={button}
                      aria-pressed={state.tool === tool}
                      onClick={() => {
                        transition({ entity: state.entity, tool })
                      }}
                    >
                      {{ overview: 'Details', relationships: 'Related records', history: 'Change history' }[tool]}
                    </button>
                  ))}
                </div>
                {object.isFetching && <p role="status">Loading record…</p>}
                {(object.isError || (object.data && object.data.id !== state.entity)) && (
                  <p role="alert">This record could not be loaded. It may be unavailable or not permitted.</p>
                )}
                {selectedData && (
                  <div key={`${selectedData.id}:${state.tool}`} className="explore-detail-content">
                    <EvidenceDetails
                      object={displayedObject ?? selectedData}
                      tool={state.tool}
                      onSelect={(entity) => {
                        transition({ entity, tool: 'overview' })
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
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
      <ul className="explore-relations">
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
              <span>{link.target_title ?? link.target_id}</span>
              {link.target_title && <span className="text-xs text-muted-foreground">{link.target_id}</span>}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    )
  if (tool === 'history')
    return (
      <ol className="explore-history">
        {object.history.length === 0 && <li>No recorded edits.</li>}
        {object.history.map((edit) => (
          <li key={edit.edit_id} className="explore-history-record">
            <p className="break-words">
              {edit.kind} {edit.target}
            </p>
            <time>{edit.timestamp}</time>
            <p>{edit.actor ?? 'Actor not supplied'}</p>
          </li>
        ))}
      </ol>
    )
  return <EvidenceOverview object={object} onSelect={onSelect} />
}

function EvidenceOverview({ object, onSelect }: { object: OntologyObject; onSelect: (id: string) => void }) {
  return (
    <>
      <dl className="explore-properties">
        {object.properties.length === 0 && <div>No properties are available.</div>}
        {object.properties.map((property) => (
          <div key={property.name} className="explore-property" data-property={property.name}>
            <dt className="text-xs text-muted-foreground">{property.title ?? property.name}</dt>
            <dd className="break-all text-sm">
              {typeof property.value === 'string' ? property.value : JSON.stringify(property.value)}
            </dd>
          </div>
        ))}
      </dl>
      {(object.links.length > 0 || object.history.length > 0) && (
        <div className="explore-overview-context">
          {object.links.length > 0 && (
            <section aria-label="Related records">
              <h3>Related records · {object.links.length}</h3>
              <EvidenceDetails
                object={{ ...object, links: object.links.slice(0, 4) }}
                tool="relationships"
                onSelect={onSelect}
              />
            </section>
          )}
          {object.history.length > 0 && (
            <section aria-label="Recent history">
              <h3>Recent history</h3>
              <EvidenceDetails
                object={{ ...object, history: object.history.slice(0, 2) }}
                tool="history"
                onSelect={onSelect}
              />
            </section>
          )}
        </div>
      )}
    </>
  )
}
