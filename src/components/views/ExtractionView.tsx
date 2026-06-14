/**
 * ExtractionView — document → knowledge-graph fact extraction (CONCEPT:ECO-4.43).
 *
 * The interactive surface assimilated from knowledge-graph-extractor: paste text
 * or a URL, watch facts stream in live as (subject)-[predicate]->(object) edges on
 * a force-directed graph, hover an edge for its full fact card (confidence /
 * evidence / tags / source), highlight the longest reasoning chain, manage the
 * GPU-slot job queue, and export JSONL. Backed by the shared
 * /api/enhanced/extract/* gateway contract (KG-2.64 extractor + KG-2.65 scheduler).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Graph from 'graphology'
import Sigma from 'sigma'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { api, type ExtractionJob } from '@/lib/api'

export interface Fact {
  subject: string
  predicate: string
  object: string
  title?: string
  description?: string
  evidence_span?: string
  confidence?: number
  tags?: string[]
  is_duplicate?: boolean
  source_file?: string
}

/** The SSE event taxonomy emitted by /api/enhanced/extract/stream (KG-2.64). */
type ExtractionEvent =
  | { type: 'round_start'; round: number; seed?: number }
  | { type: 'fact'; round?: number; fact: Fact; is_duplicate?: boolean; max_similarity?: number }
  | { type: 'metrics'; round: number; tokens: number }
  | { type: 'round_end'; round: number }
  | { type: 'file_start' | 'file_end'; file: string; file_index?: number }
  | { type: 'done'; total_facts: number; unique_facts: number; duplicate_facts: number }
  | { type: 'job_done'; state: string }

/** Sigma/graphology node + edge attribute shapes — parameterizing the Graph
 *  keeps every attribute access type-safe (no `any` from the graph library). */
interface NodeAttrs {
  label: string
  size: number
  x: number
  y: number
  color: string
}
interface EdgeAttrs {
  label: string
  factIndex: number
  type: string
  size: number
  color: string
}
type FactGraph = Graph<NodeAttrs, EdgeAttrs>

/** Canonical node key — mirrors ExtractedFact.normalize_key on the backend so
 *  surface-form variants merge into one node here too. */
function normKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, ' ')
    .replace(/^[\s"'`([{]+|[\s"'`)\]}.,;:!?]+$/g, '')
    .trim()
}

/** Normalized key with an explicit placeholder for an empty result. */
function nodeKey(s: string): string {
  const k = normKey(s)
  return k.length > 0 ? k : '?'
}

/** Longest directed chain over the fact edges (bounded DFS from high-degree
 *  starts), returned as the set of edge keys on the path. */
function longestPathEdges(facts: Fact[]): Set<number> {
  const adj = new Map<string, { to: string; idx: number }[]>()
  facts.forEach((f, idx) => {
    if (f.is_duplicate) return
    const s = nodeKey(f.subject)
    const t = nodeKey(f.object)
    if (s === t) return
    if (!adj.has(s)) adj.set(s, [])
    if (!adj.has(t)) adj.set(t, [])
    adj.get(s)?.push({ to: t, idx })
  })
  let best: number[] = []
  let steps = 0
  const cap = 2000 * (adj.size || 1)
  const dfs = (cur: string, seen: Set<string>, path: number[]) => {
    if (steps++ > cap) return
    if (path.length > best.length) best = [...path]
    for (const { to, idx } of adj.get(cur) ?? []) {
      if (seen.has(to)) continue
      seen.add(to)
      path.push(idx)
      dfs(to, seen, path)
      path.pop()
      seen.delete(to)
    }
  }
  const starts = [...adj.keys()].sort((a, b) => (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0)).slice(0, 40)
  for (const s of starts) dfs(s, new Set([s]), [])
  return new Set(best)
}

export default function ExtractionView() {
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [rounds, setRounds] = useState(1)
  const [dedup, setDedup] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [facts, setFacts] = useState<Fact[]>([])
  const [status, setStatus] = useState('idle')
  const [jobs, setJobs] = useState<ExtractionJob[]>([])
  const [hover, setHover] = useState<{ fact: Fact; x: number; y: number } | null>(null)
  const [showPath, setShowPath] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null)
  const graphRef = useRef<FactGraph | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const pathEdges = useMemo(() => (showPath ? longestPathEdges(facts) : new Set<number>()), [facts, showPath])

  // ---- live job queue polling --------------------------------------------
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await api.listExtractionJobs()
        if (alive) setJobs(res.jobs)
      } catch {
        /* gateway cold — leave the panel empty */
      }
    }
    void tick()
    const h = setInterval(() => {
      void tick()
    }, 2500)
    return () => {
      alive = false
      clearInterval(h)
    }
  }, [])

  // ---- (re)build the Sigma graph whenever facts change --------------------
  useEffect(() => {
    if (!containerRef.current) return
    graphRef.current ??= new Graph<NodeAttrs, EdgeAttrs>({ multi: true, type: 'directed' })
    const g = graphRef.current

    facts.forEach((f, idx) => {
      const sKey = nodeKey(f.subject)
      const oKey = nodeKey(f.object)
      for (const [k, label] of [
        [sKey, f.subject],
        [oKey, f.object],
      ] as const) {
        if (!g.hasNode(k)) {
          g.addNode(k, {
            label,
            size: 4,
            x: Math.cos(idx + k.length),
            y: Math.sin(idx + k.length),
            color: '#1a1a1a',
          })
        } else {
          g.setNodeAttribute(k, 'size', Math.min(14, g.getNodeAttribute(k, 'size') + 0.6))
        }
      }
      const ekey = `e${idx}`
      if (!g.hasEdge(ekey)) {
        g.addEdgeWithKey(ekey, sKey, oKey, {
          label: f.predicate,
          factIndex: idx,
          type: 'arrow',
          size: f.is_duplicate ? 0.6 : 1.4,
          color: f.is_duplicate ? 'rgba(180,60,60,0.35)' : 'rgba(26,26,26,0.45)',
        })
      }
    })

    // recolor for longest-path highlight
    g.forEachEdge((ek, attrs) => {
      const onPath = pathEdges.has(attrs.factIndex)
      const isDup = facts[attrs.factIndex]?.is_duplicate ?? false
      g.setEdgeAttribute(ek, 'color', onPath ? '#1a1a1a' : isDup ? 'rgba(180,60,60,0.35)' : 'rgba(26,26,26,0.35)')
      g.setEdgeAttribute(ek, 'size', onPath ? 2.8 : isDup ? 0.6 : 1.2)
    })

    if (g.order > 1) {
      forceAtlas2.assign(g, { iterations: 60, settings: { gravity: 1, scalingRatio: 8 } })
    }

    if (!sigmaRef.current) {
      const renderer = new Sigma<NodeAttrs, EdgeAttrs>(g, containerRef.current, {
        renderEdgeLabels: true,
        defaultEdgeType: 'arrow',
      })
      sigmaRef.current = renderer
      renderer.on('enterEdge', ({ edge, event }) => {
        const idx = g.getEdgeAttribute(edge, 'factIndex')
        const f = facts.at(idx)
        if (f) setHover({ fact: f, x: event.x, y: event.y })
      })
      renderer.on('leaveEdge', () => {
        setHover(null)
      })
    } else {
      sigmaRef.current.refresh()
    }
  }, [facts, pathEdges])

  // tear down sigma on unmount
  useEffect(() => {
    return () => {
      sigmaRef.current?.kill()
      sigmaRef.current = null
      esRef.current?.close()
    }
  }, [])

  const resetGraph = useCallback(() => {
    sigmaRef.current?.kill()
    sigmaRef.current = null
    graphRef.current = null
    setFacts([])
    setHover(null)
  }, [])

  const startStream = useCallback((id: string) => {
    esRef.current?.close()
    const es = new EventSource(api.extractionStreamUrl(id))
    esRef.current = es
    es.onmessage = (e: MessageEvent<string>) => {
      let ev: ExtractionEvent
      try {
        ev = JSON.parse(e.data) as ExtractionEvent
      } catch {
        return
      }
      if (ev.type === 'fact') {
        const fact = ev.fact
        setFacts((prev) => [...prev, fact])
      } else if (ev.type === 'round_start') {
        setStatus(`round ${ev.round}…`)
      } else if (ev.type === 'job_done') {
        setStatus(ev.state === 'failed' ? 'failed' : 'done')
        es.close()
      }
    }
    es.onerror = () => {
      es.close()
    }
  }, [])

  const onSubmit = useCallback(async () => {
    if (!text.trim() && !url.trim()) {
      toast.error('Paste text or enter a URL first')
      return
    }
    resetGraph()
    setStatus('submitting…')
    try {
      const res = await api.submitExtraction({ text, url, rounds, dedup })
      if (res.status !== 'submitted' || !res.job_id) {
        toast.error(res.message ?? 'Extraction unavailable (engine cold?)')
        setStatus('idle')
        return
      }
      setJobId(res.job_id)
      setStatus('streaming…')
      startStream(res.job_id)
    } catch (err: unknown) {
      toast.error(`Submit failed: ${err instanceof Error ? err.message : String(err)}`)
      setStatus('idle')
    }
  }, [text, url, rounds, dedup, resetGraph, startStream])

  const uniqueCount = facts.filter((f) => !f.is_duplicate).length
  const dupCount = facts.length - uniqueCount

  return (
    <div className="flex h-full gap-4 p-4">
      {/* left: ingestion + jobs */}
      <div className="flex w-80 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Extract Knowledge Graph</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Paste document text…"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
              }}
              rows={6}
            />
            <Input
              placeholder="…or a URL (readability)"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
              }}
            />
            <div className="flex items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                rounds
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={rounds}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setRounds(Number.isFinite(n) && n >= 1 ? n : 1)
                  }}
                  className="w-16"
                />
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={dedup}
                  onChange={(e) => {
                    setDedup(e.target.checked)
                  }}
                />
                dedup
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  void onSubmit()
                }}
                className="flex-1"
              >
                Extract
              </Button>
              <Button
                variant="outline"
                disabled={!jobId}
                onClick={() => {
                  if (jobId) window.open(api.extractionJsonlUrl(jobId), '_blank')
                }}
              >
                JSONL
              </Button>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{status}</span>
              <span>
                {uniqueCount} facts{dupCount > 0 ? ` (+${dupCount} dup)` : ''}
              </span>
            </div>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={showPath}
                onChange={(e) => {
                  setShowPath(e.target.checked)
                }}
              />
              highlight longest chain
            </label>
          </CardContent>
        </Card>

        <Card className="flex-1 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm">GPU-slot job queue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-64">
              <div className="space-y-1 p-2">
                {jobs.length === 0 && <div className="p-2 text-xs text-muted-foreground">no jobs</div>}
                {jobs.map((j) => (
                  <div key={j.job_id} className="flex items-center justify-between rounded border p-2 text-xs">
                    <div className="truncate">
                      <Badge variant={j.state === 'running' ? 'default' : 'outline'}>{j.state}</Badge>{' '}
                      <span className="font-mono">{j.job_id}</span>
                      <div className="text-muted-foreground">{j.total_facts ?? 0} facts</div>
                    </div>
                    {j.state === 'held' || j.state === 'paused' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void api.resumeExtraction(j.job_id)
                        }}
                      >
                        ▶
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void api.pauseExtraction(j.job_id)
                        }}
                      >
                        ⏸
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* right: live force graph + edge-fact card */}
      <div className="relative flex-1 rounded border bg-white">
        <div ref={containerRef} className="h-full w-full" />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-sm rounded border bg-white p-2 text-xs shadow-lg"
            style={{ left: Math.min(hover.x + 12, 600), top: hover.y + 12 }}
          >
            <div className="font-semibold">
              {hover.fact.title ?? `${hover.fact.subject} ${hover.fact.predicate} ${hover.fact.object}`}
            </div>
            <div className="my-1 font-mono text-[11px]">
              <span className="text-blue-700">{hover.fact.subject}</span> →{' '}
              <span className="text-purple-700">{hover.fact.predicate}</span> →{' '}
              <span className="text-green-700">{hover.fact.object}</span>
            </div>
            {hover.fact.description && <div className="text-muted-foreground">{hover.fact.description}</div>}
            <div className="mt-1 flex items-center gap-2">
              <span>conf {hover.fact.confidence ?? '–'}%</span>
              {hover.fact.is_duplicate && <Badge variant="destructive">duplicate</Badge>}
            </div>
            {hover.fact.tags && hover.fact.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {hover.fact.tags.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
            {hover.fact.evidence_span && (
              <div className="mt-1 border-l-2 pl-2 italic text-muted-foreground">“{hover.fact.evidence_span}”</div>
            )}
            {hover.fact.source_file && <div className="mt-1 text-muted-foreground">📄 {hover.fact.source_file}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
