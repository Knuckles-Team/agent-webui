import { useState, useEffect } from 'react'
import type { ComponentType } from 'react'
import { Code2, Search, GitBranch, AlertTriangle, MapPin, RefreshCw, Network } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { GraphCanvas } from '../knowledge-graph/GraphCanvas'
import {
  codeMetricsToGraphNodes,
  communityColor,
  type GraphNode,
  type GraphRelationship,
} from '../knowledge-graph/GraphAdapter'
import { api, type CodeMetricsResult } from '@/lib/api'

/** One :Code symbol row as returned by the code_nav backend. */
interface CodeRow {
  id: string
  name?: string
  file_path?: string
  line?: number
  language?: string
  kind?: string
  instance?: string
  source_system?: string
}

type Action = 'find_definition' | 'find_references' | 'trace_call_graph' | 'impact_of_change'

const ACTIONS: { id: Action; label: string; icon: ComponentType<{ className?: string }>; hint: string }[] = [
  { id: 'find_definition', label: 'Definition', icon: MapPin, hint: 'Where the symbol is defined' },
  { id: 'find_references', label: 'References', icon: Search, hint: 'Callers of the symbol' },
  { id: 'trace_call_graph', label: 'Call graph', icon: GitBranch, hint: 'Transitive callees (downstream)' },
  { id: 'impact_of_change', label: 'Impact', icon: AlertTriangle, hint: 'Transitive callers (blast radius)' },
]

/**
 * Code Graph Navigator (CONCEPT:KG-2.9g) — Phase 5 lens over the RESOLVED code
 * graph (`:Code` symbols + `calls`/`depends_on`). Find a definition, its
 * references, trace the call graph, or compute the impact (blast radius) of
 * changing a symbol, scoped to an indexed source_system (a GitLab tenant).
 */
export default function CodeGraphView() {
  const [symbol, setSymbol] = useState('')
  const [sourceSystem, setSourceSystem] = useState('')
  const [depth, setDepth] = useState(3)
  const [rows, setRows] = useState<CodeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [activeAction, setActiveAction] = useState<Action>('find_definition')
  const [systems, setSystems] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/enhanced/code/instances')
      .then((r) => (r.ok ? (r.json() as Promise<{ source_systems?: string[] }>) : { source_systems: [] }))
      .then((d) => {
        setSystems(d.source_systems ?? [])
      })
      .catch(() => {
        setSystems([])
      })
  }, [])

  const run = async (action: Action) => {
    if (!symbol.trim()) {
      toast.error('Enter a symbol name')
      return
    }
    setActiveAction(action)
    setLoading(true)
    try {
      const res = await fetch('/api/enhanced/code/nav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, symbol, source_system: sourceSystem, depth }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { results?: CodeRow[]; count?: number }
      const results = data.results ?? []
      setRows(results)
      toast.success(`${data.count ?? results.length} result(s)`)
    } catch (err) {
      toast.error('Code navigation failed')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Code2 className="size-6" /> Code Graph Navigator
        </h2>
        <p className="text-sm text-muted-foreground">
          Navigate the resolved code symbol graph across your indexed GitLab instances.
        </p>
      </div>

      <Tabs defaultValue="navigator">
        <TabsList>
          <TabsTrigger value="navigator">
            <Search className="size-4 mr-1.5" /> Navigator
          </TabsTrigger>
          <TabsTrigger value="canvas">
            <Network className="size-4 mr-1.5" /> Call Graph
          </TabsTrigger>
        </TabsList>

        <TabsContent value="navigator" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Symbol</CardTitle>
              <CardDescription>
                Function, class, or method name — optionally scoped to one source system.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  placeholder="Symbol name (e.g. NewAnalyzer)"
                  value={symbol}
                  onChange={(e) => {
                    setSymbol(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void run(activeAction)
                  }}
                  className="flex-1"
                />
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={sourceSystem}
                  onChange={(e) => {
                    setSourceSystem(e.target.value)
                  }}
                  aria-label="Source system"
                >
                  <option value="">All instances</option>
                  {systems.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={depth}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setDepth(Number.isFinite(n) && n > 0 ? n : 3)
                  }}
                  className="w-24"
                  aria-label="Traversal depth"
                  title="Depth for call graph / impact"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {ACTIONS.map((a) => (
                  <Button
                    key={a.id}
                    variant={activeAction === a.id ? 'default' : 'outline'}
                    size="sm"
                    disabled={loading}
                    onClick={() => {
                      void run(a.id)
                    }}
                    title={a.hint}
                  >
                    <a.icon className="size-4 mr-1.5" />
                    {a.label}
                  </Button>
                ))}
                {loading && <RefreshCw className="size-4 animate-spin self-center" />}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                Results <Badge variant="secondary">{rows.length}</Badge>
                <span className="text-xs font-normal text-muted-foreground">{activeAction.replace(/_/g, ' ')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[480px]">
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No results yet — enter a symbol and pick an action.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3">Name</th>
                        <th className="py-1 pr-3">File</th>
                        <th className="py-1 pr-3">Line</th>
                        <th className="py-1 pr-3">Lang</th>
                        <th className="py-1 pr-3">Instance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="py-1 pr-3 font-mono">{r.name ?? '—'}</td>
                          <td className="py-1 pr-3 font-mono text-xs">{r.file_path ?? '—'}</td>
                          <td className="py-1 pr-3">{r.line ?? '—'}</td>
                          <td className="py-1 pr-3">{r.language ?? r.kind ?? '—'}</td>
                          <td className="py-1 pr-3 text-xs">{r.instance ?? r.source_system ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="canvas" className="mt-4">
          <CallGraphCanvas />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * Code-graph analytics canvas (CONCEPT:KG-2.214) — the Graphify "god nodes /
 * communities / architecture" view, rendered over the durable resolved code graph.
 * One call to code_metrics yields both the analytics (god nodes, community count,
 * relation mix) and a bounded render payload; the force-directed Sigma canvas sizes
 * each node by centrality and colors it by community.
 */
const noop = () => undefined

function CallGraphCanvas() {
  const [scope, setScope] = useState('')
  const [topK, setTopK] = useState(12)
  const [loading, setLoading] = useState(false)
  const [metrics, setMetrics] = useState<CodeMetricsResult | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [rels, setRels] = useState<GraphRelationship[]>([])

  const render = async () => {
    setLoading(true)
    try {
      const result = await api.getCodeMetrics(scope.trim(), topK)
      setMetrics(result)
      if (result.status !== 'ok') {
        setNodes([])
        setRels([])
        toast.message(result.message ?? 'No code graph found — ingest a repo or widen scope.')
        return
      }
      const mapped = codeMetricsToGraphNodes(result.graph)
      setNodes(mapped.nodes)
      setRels(mapped.relationships)
      toast.success(`${result.nodes} symbols · ${result.community_count} communities`)
    } catch (err) {
      toast.error('Failed to load code metrics')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Code architecture canvas</CardTitle>
          <CardDescription>
            God nodes (size = centrality), communities (color), and cross-community bridges over the resolved code
            graph. Scope to a repo/path substring to focus.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              placeholder="Scope substring (file path or source system) — blank = whole graph"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void render()
              }}
              className="flex-1"
            />
            <Input
              type="number"
              min={1}
              max={50}
              value={topK}
              onChange={(e) => {
                const n = Number(e.target.value)
                setTopK(Number.isFinite(n) && n > 0 ? n : 12)
              }}
              className="w-24"
              aria-label="Top god nodes / communities"
              title="How many god nodes / communities / bridges to surface"
            />
            <Button
              size="sm"
              disabled={loading}
              onClick={() => {
                void render()
              }}
            >
              {loading ? <RefreshCw className="size-4 mr-1.5 animate-spin" /> : <Network className="size-4 mr-1.5" />}
              Render
            </Button>
          </div>

          {metrics?.status === 'ok' && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{metrics.nodes} symbols</Badge>
              <Badge variant="secondary">{metrics.edges} edges</Badge>
              <Badge variant="secondary">{metrics.community_count} communities</Badge>
              {metrics.graph.truncated && <Badge variant="outline">render truncated</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <Card className="min-h-[520px]">
          <CardContent className="p-0 h-[520px]">
            {nodes.length > 0 ? (
              <GraphCanvas
                nodes={nodes}
                relationships={rels}
                onUpdateNode={noop}
                onDeleteNode={noop}
                onAddNode={noop}
                onSelectNode={noop}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Render the code graph to see god nodes and communities.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">God nodes</CardTitle>
            <CardDescription>Highest-degree hubs</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[440px]">
              {metrics?.god_nodes.length ? (
                <ul className="space-y-1.5 text-sm">
                  {metrics.god_nodes.map((g) => (
                    <li key={g.id} className="flex items-center gap-2">
                      <span
                        className="inline-block size-3 rounded-full shrink-0"
                        style={{ backgroundColor: communityColor(g.community) }}
                        title={`community ${g.community ?? '—'}`}
                      />
                      <span className="font-mono truncate" title={g.file_path ?? undefined}>
                        {g.label ?? g.id}
                      </span>
                      <Badge variant="outline" className="ml-auto shrink-0">
                        {g.degree}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
