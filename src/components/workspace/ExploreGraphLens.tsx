import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { GraphCanvas } from '@/components/knowledge-graph/GraphCanvas'
import { NodeTypeBreakdown } from '@/components/knowledge-graph/NodeTypeBreakdown'
import { useExploreGraph } from '@/components/knowledge-graph/useExploreGraph'
import type { GraphNode } from '@/components/knowledge-graph/GraphAdapter'
import {
  canUseExploreLens,
  exploreLensHref,
  navigateExploreLens,
  type ExploreLensState,
} from '@/lib/explore-lens-state'
import { validEntityId } from '@/lib/explore-workspace'
import type { Role } from '@/lib/nav-registry'
import { usePageContextPublisher, type PageContextContribution } from '@/lib/page-context'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import './ExploreGraphLens.css'

const nodeLabel = (node: GraphNode) => (typeof node.properties.name === 'string' ? node.properties.name : node.id)

export function ExploreGraphLens({ state, role, active }: { state: ExploreLensState; role: Role; active: boolean }) {
  const canRead = active && canUseExploreLens(role, 'graph')
  const graph = useExploreGraph(canRead, state.graphType ?? null)
  const [labelFilter, setLabelFilter] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const inspectorHeading = useRef<HTMLHeadingElement>(null)
  const live = useRef({ state, active: canRead, graph })
  live.current = { state, active: canRead, graph }
  useLayoutEffect(() => {
    live.current.active = canRead
    return () => {
      live.current.active = false
    }
  }, [canRead])
  useLayoutEffect(() => {
    if (active) (state.graphNode ? inspectorHeading : heading).current?.focus({ preventScroll: true })
  }, [active, state.graphNode])
  const usable = canRead && !graph.denied
  const nodes = useMemo(
    () => (usable ? graph.nodes.filter((node) => validEntityId(node.id)) : []),
    [usable, graph.nodes],
  )
  const selected = nodes.find((node) => node.id === state.graphNode)
  const filtered = nodes.filter((node) =>
    nodeLabel(node).toLocaleLowerCase().includes(labelFilter.toLocaleLowerCase()),
  )
  const adjacency =
    usable && selected
      ? graph.relationships.filter((edge) => edge.source === selected.id || edge.target === selected.id)
      : []
  const select = (node: string | null) => {
    if (!live.current.active || live.current.state !== state) throw new Error('Graph context is stale')
    navigateExploreLens({ ...state, graphNode: node ?? undefined, lens: 'graph' }, role, ['graph'])
  }
  const selectType = (type: string | null) => {
    if (!live.current.active || live.current.state !== state) throw new Error('Graph context is stale')
    navigateExploreLens({ ...state, graphType: type ?? undefined, lens: 'graph' }, role, ['graph'])
  }
  // Sigma registers its click listener once. Keep the callback stable and read
  // the current bound sample, never a selection captured at canvas creation.
  const selectFromCanvas = useCallback(
    (node: GraphNode | null) => {
      const current = live.current
      if (!current.active || !current.graph.isCurrent()) return
      if (node && !current.graph.nodes.some((entry) => entry.id === node.id)) return
      navigateExploreLens({ ...current.state, graphNode: node?.id, lens: 'graph' }, role, ['graph'])
    },
    [role],
  )
  const pageContext = useMemo<PageContextContribution>(
    () => ({
      selection:
        active && selected ? [{ kind: 'graph-node', id: selected.id, label: nodeLabel(selected).slice(0, 256) }] : [],
      filters: active ? { workspaceLens: 'graph', graphType: state.graphType ?? '', sampled: true } : undefined,
    }),
    [active, selected, state.graphType],
  )
  usePageContextPublisher(pageContext)
  const tools = useMemo(() => {
    if (!canRead) return []
    const verify = () => {
      if (!live.current.active || live.current.state !== state || live.current.graph !== graph || !graph.isCurrent())
        throw new Error('Graph context is stale')
    }
    const schema = z.object({ node: z.string().min(1).max(256).nullable() }).strict()
    const refreshSchema = z.object({}).strict()
    return [
      makeTool({
        name: 'overstory.explore.graph.select',
        title: 'Inspect a sampled graph node',
        description: 'Select a loaded graph node without changing evidence, querying or editing the graph.',
        inputSchema: schema,
        outputSchema: schema,
        jsonSchema: z.toJSONSchema(schema),
        readOnly: false,
        source: 'overstory:src/components/workspace/ExploreGraphLens.tsx',
        execute: ({ node }) => {
          verify()
          if (node !== null && !nodes.some((item) => item.id === node))
            throw new Error('Node is outside the loaded graph sample')
          navigateExploreLens({ ...state, graphNode: node ?? undefined, lens: 'graph' }, role, ['graph'])
          return { node }
        },
      }),
      makeTool({
        name: 'overstory.explore.graph.refresh',
        title: 'Refresh the graph sample',
        description: 'Read the existing graph sample and aggregate facades. Does not edit or execute a query.',
        inputSchema: refreshSchema,
        outputSchema: refreshSchema,
        jsonSchema: z.toJSONSchema(refreshSchema),
        readOnly: true,
        source: 'overstory:src/components/workspace/ExploreGraphLens.tsx',
        execute: () => {
          verify()
          graph.refresh()
          return {}
        },
      }),
    ]
  }, [canRead, state, graph, nodes, role])
  useWebMcpToolSet(tools)
  if (!active) return null
  if (!canRead) return <p role="alert">Graph is not available for this workspace identity.</p>
  const nodePending = graph.pending.includes('nodes')
  return (
    <section aria-label="Graph lens" className="explore-graph-lens">
      <div className="explore-graph-toolbar">
        <div>
          <h2 ref={heading} tabIndex={-1} className="font-semibold">
            Graph sample
          </h2>
          <p className="text-xs text-muted-foreground">Read-only. Graph IDs and evidence IDs are independent.</p>
        </div>
        <button className="explore-control" onClick={graph.refresh} disabled={graph.pending.length > 0}>
          Refresh graph
        </button>
      </div>
      <p role="status" className="text-sm">
        {nodePending ? 'Loading graph sample…' : `Sample: ${String(nodes.length)} nodes`}
        {' · '}Total nodes:{' '}
        {usable && graph.stats && graph.stats.available !== false
          ? graph.stats.total_nodes.toLocaleString()
          : 'unknown'}
        {' · '}Total edges:{' '}
        {usable && graph.stats && graph.stats.available !== false
          ? graph.stats.total_relationships.toLocaleString()
          : 'unknown'}
        {' · '}A bounded sample, not the complete graph or neighborhood.
      </p>
      {graph.denied && <p role="alert">Permission denied. Previously loaded graph data has been cleared.</p>}
      {graph.stats?.available === false && (
        <p role="alert">Graph totals are unavailable. This does not mean the sampled graph is empty.</p>
      )}
      {graph.failed.length > 0 && (
        <p role="alert">Partial or unavailable graph data: {graph.failed.join(', ')} failed to load.</p>
      )}
      {graph.stats?.partial && (
        <p role="alert">
          Partial totals exclude:{' '}
          {graph.stats.degraded_graphs?.length ? graph.stats.degraded_graphs.join(', ') : 'unavailable graphs'}.
        </p>
      )}
      <div className="explore-graph-grid">
        <details open className="explore-graph-types">
          <summary className="workspace-pane-toggle">Graph types</summary>
          <NodeTypeBreakdown
            data={usable ? graph.breakdown : null}
            loading={graph.pending.includes('breakdown')}
            error={graph.failed.includes('breakdown') ? 'The provider did not return a type distribution.' : null}
            selectedType={state.graphType ?? null}
            onSelectType={selectType}
          />
        </details>
        <div className="explore-graph-main">
          {usable && nodes.length > 0 && (
            <div className="explore-graph-canvas" aria-label="Graph canvas">
              <GraphCanvas
                readOnly
                nodes={nodes}
                relationships={graph.relationships}
                selectedNodeExternally={selected ?? null}
                onSelectNode={selectFromCanvas}
              />
            </div>
          )}
          {!nodePending && !graph.denied && !graph.failed.includes('nodes') && usable && nodes.length === 0 && (
            <p className="py-3">No nodes were returned in this sample.</p>
          )}
          <label className="block text-sm">
            Filter sampled node labels
            <input
              className="explore-search-input"
              value={labelFilter}
              maxLength={256}
              onChange={(event) => {
                setLabelFilter(event.target.value)
              }}
            />
          </label>
          <ul className="explore-graph-nodes" aria-label="Sampled graph nodes">
            {filtered.map((node) => (
              <li key={node.id}>
                <a
                  className="explore-record"
                  href={exploreLensHref({ ...state, graphNode: node.id, lens: 'graph' })}
                  aria-current={state.graphNode === node.id ? 'true' : undefined}
                  onClick={(event) => {
                    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                    event.preventDefault()
                    select(node.id)
                  }}
                >
                  <span className="break-all">{nodeLabel(node)}</span>
                  <span className="text-xs text-muted-foreground">{node.labels.join(', ')}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <section aria-label="Graph inspector" className="explore-graph-inspector">
          <h3 ref={inspectorHeading} tabIndex={-1} className="font-semibold">
            Selected node{selected ? `: ${nodeLabel(selected)}` : ''}
          </h3>
          {selected ? (
            <>
              <p className="break-all">{nodeLabel(selected)}</p>
              <p className="break-all text-xs text-muted-foreground">{selected.id}</p>
              <button
                className="explore-control"
                onClick={() => {
                  select(null)
                }}
              >
                Clear graph selection
              </button>
              <details open>
                <summary>Properties</summary>
                <pre className="explore-graph-properties">{JSON.stringify(selected.properties, null, 2)}</pre>
              </details>
              <h4 className="font-semibold">Sampled adjacency</h4>
              <ul className="explore-graph-nodes" aria-label="Sampled adjacency">
                {adjacency.map((edge, index) => {
                  const id = edge.source === selected.id ? edge.target : edge.source
                  const neighbor = nodes.find((node) => node.id === id)
                  return (
                    <li key={`${edge.source}:${edge.target}:${String(index)}`}>
                      <span className="text-xs">
                        {edge.source === selected.id ? 'Outgoing' : 'Incoming'} {edge.type}:{' '}
                      </span>
                      {neighbor ? (
                        <a
                          className="explore-control"
                          href={exploreLensHref({ ...state, graphNode: id, lens: 'graph' })}
                          onClick={(event) => {
                            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
                              return
                            event.preventDefault()
                            select(id)
                          }}
                        >
                          {nodeLabel(neighbor)}
                        </a>
                      ) : (
                        <span className="break-all">{id} (outside loaded node sample)</span>
                      )}
                    </li>
                  )
                })}
              </ul>
              {adjacency.length === 0 && <p>No relationships for this node are present in the loaded edge sample.</p>}
            </>
          ) : (
            <p>
              {state.graphNode
                ? 'The selected node is not in the current sample. Its ID is retained, not resolved as evidence.'
                : 'Select a sampled node to inspect its properties and neighbors.'}
            </p>
          )}
        </section>
      </div>
    </section>
  )
}
