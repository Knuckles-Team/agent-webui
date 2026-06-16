import { useState, useEffect } from 'react'
import type { ComponentType } from 'react'
import { Code2, Search, GitBranch, AlertTriangle, MapPin, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Symbol</CardTitle>
          <CardDescription>Function, class, or method name — optionally scoped to one source system.</CardDescription>
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
    </div>
  )
}
