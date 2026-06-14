/**
 * @file MagmaView.tsx
 * @description MAGMA orthogonal-views explorer.
 *
 * Lets the user compose a query, pick one or more orthogonal MAGMA views
 * (semantic, temporal, causal, entity, place, epistemic), and render the
 * per-view results returned by POST /api/enhanced/graph/magma.
 */

import { useState } from 'react'
import { Compass, Loader2, Play } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

type MagmaView = 'semantic' | 'temporal' | 'causal' | 'entity' | 'place' | 'epistemic'

const MAGMA_VIEWS: { value: MagmaView; label: string; description: string }[] = [
  { value: 'semantic', label: 'Semantic', description: 'Vector similarity search.' },
  { value: 'temporal', label: 'Temporal', description: 'Episodic memory over time.' },
  { value: 'causal', label: 'Causal', description: 'Reasoning traces and "why" links.' },
  { value: 'entity', label: 'Entity', description: 'People, orgs, and code symbols.' },
  { value: 'place', label: 'Place', description: 'Spatial / locational context.' },
  {
    value: 'epistemic',
    label: 'Epistemic',
    description: 'Uncertainty and confidence grounding.',
  },
]

interface MagmaResult {
  id?: string
  content?: string
  view?: string
  score?: number
  [k: string]: unknown
}

interface MagmaGrouped {
  view: string
  items: MagmaResult[]
}

function groupByView(results: MagmaResult[], fallbackView: string): MagmaGrouped[] {
  const buckets = new Map<string, MagmaResult[]>()
  for (const item of results) {
    const view = String(item.view ?? fallbackView)
    const existing = buckets.get(view) ?? []
    existing.push(item)
    buckets.set(view, existing)
  }
  return Array.from(buckets.entries()).map(([view, items]) => ({ view, items }))
}

export default function MagmaView() {
  const [query, setQuery] = useState('')
  const [viewType, setViewType] = useState<MagmaView>('semantic')
  const [limit, setLimit] = useState(10)
  const [loading, setLoading] = useState(false)
  const [grouped, setGrouped] = useState<MagmaGrouped[]>([])
  const [lastQuery, setLastQuery] = useState<string>('')

  const runQuery = async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      toast.warning('Enter a query to run perspective retrieval.')
      return
    }
    if (limit <= 0 || !Number.isFinite(limit)) {
      toast.warning('Limit must be a positive number.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/enhanced/graph/magma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: trimmed,
          views: [viewType],
          limit,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => String(res.status))
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const data = (await res.json()) as MagmaResult[] | { results?: MagmaResult[] }
      const flat: MagmaResult[] = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : []
      setGrouped(groupByView(flat, viewType))
      setLastQuery(trimmed)
      if (flat.length === 0) {
        toast.info('No perspective results for that query.')
      }
    } catch (err) {
      toast.error(`Perspective retrieval failed: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="magma-view">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Compass className="size-6" />
            Perspective Views
          </h1>
          <p className="text-muted-foreground text-sm">
            Orthogonal retrieval across semantic, temporal, causal, entity, place, and epistemic views.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Query</CardTitle>
          <CardDescription>Compose a query and pick the perspective view to retrieve against.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="magma-query">
              Query
            </label>
            <Textarea
              id="magma-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Find all reasoning traces about authentication failures"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium" htmlFor="magma-view-type">
                View Type
              </label>
              <Select value={viewType} onValueChange={(v) => setViewType(v as MagmaView)}>
                <SelectTrigger id="magma-view-type" aria-label="Perspective view type">
                  <SelectValue placeholder="Select a view" />
                </SelectTrigger>
                <SelectContent>
                  {MAGMA_VIEWS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {MAGMA_VIEWS.find((v) => v.value === viewType)?.description}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="magma-limit">
                Limit
              </label>
              <Input
                id="magma-limit"
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void runQuery()} disabled={loading}>
              {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Play className="size-4 mr-2" />}
              Run Query
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {lastQuery && (
          <p className="text-xs text-muted-foreground">
            Results for: <span className="font-mono">{lastQuery}</span>
          </p>
        )}

        {grouped.length === 0 && !loading ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Run a query to see perspective results.
            </CardContent>
          </Card>
        ) : (
          grouped.map(({ view, items }) => (
            <Card key={view}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base capitalize">{view} view</CardTitle>
                  <CardDescription>{items.length} result(s)</CardDescription>
                </div>
                <Badge variant="secondary">{view}</Badge>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[50vh]">
                  <div className="space-y-2">
                    {items.map((item, idx) => {
                      const content = typeof item.content === 'string' ? item.content : JSON.stringify(item, null, 2)
                      const itemId = item.id ?? `${view}-${idx}`
                      return (
                        <div key={itemId} className="rounded border p-3 text-sm space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs text-muted-foreground">{String(item.id ?? '-')}</span>
                            {typeof item.score === 'number' && (
                              <Badge variant="outline">{item.score.toFixed(3)}</Badge>
                            )}
                          </div>
                          <pre className="whitespace-pre-wrap break-words font-sans">{content}</pre>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
