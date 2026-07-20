/**
 * @file CypherReplView.tsx
 * @description Minimal Cypher query REPL.
 *
 * Provides a Textarea-based editor for Cypher queries, an execution button
 * that POSTs to /api/enhanced/graph/query, a JSON results table with
 * expandable rows, and a history sidebar that keeps the last 10 runs in
 * memory (and mirrors them to localStorage so refreshes persist).
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, History, Loader2, Play, Terminal, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

const DEFAULT_QUERY = 'MATCH (n) RETURN n LIMIT 10'
const HISTORY_KEY = 'cypher-repl-history'
const HISTORY_LIMIT = 10
const DESTRUCTIVE_RE = /\b(DELETE|REMOVE|DROP|DETACH\s+DELETE|CREATE|MERGE|SET)\b/i

interface HistoryEntry {
  query: string
  timestamp: number
  durationMs: number
  rowCount: number
  error?: string
}

interface CypherResultRowProps {
  row: Record<string, unknown>
  index: number
}

function loadHistory(): HistoryEntry[] {
  try {
    const stored = window.localStorage.getItem(HISTORY_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as HistoryEntry[]
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
  } catch {
    // localStorage can fail (quota, private mode); history remains in-memory.
  }
}

function CypherResultRow({ row, index }: CypherResultRowProps) {
  const [expanded, setExpanded] = useState(false)
  const keys = Object.keys(row)
  const preview = keys
    .slice(0, 3)
    .map((k) => {
      const v = row[k]
      const formatted = typeof v === 'string' ? v : v === null ? 'null' : JSON.stringify(v)
      const truncated = formatted.length > 48 ? `${formatted.slice(0, 48)}…` : formatted
      return `${k}: ${truncated}`
    })
    .join(' · ')

  return (
    <div className="rounded border">
      <button
        type="button"
        onClick={() => {
          setExpanded(!expanded)
        }}
        className="w-full flex items-center justify-between p-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          <span className="font-mono text-xs text-muted-foreground shrink-0">#{index + 1}</span>
          <span className="truncate font-mono text-xs">{preview || '(empty row)'}</span>
        </span>
        <Badge variant="outline" className="shrink-0">
          {keys.length} cols
        </Badge>
      </button>
      {expanded && (
        <pre className={'border-t bg-muted/30 p-2 text-xs overflow-x-auto ' + 'whitespace-pre-wrap break-words'}>
          {JSON.stringify(row, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function CypherReplView() {
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [results, setResults] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  const runQuery = async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      toast.warning('Enter a Cypher query to run.')
      return
    }

    const started = Date.now()
    setLoading(true)
    setLastError(null)
    try {
      const res = await fetch('/api/enhanced/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => String(res.status))
        const message = `HTTP ${res.status}: ${text}`
        setLastError(message)
        setResults([])
        appendHistory({
          query: trimmed,
          timestamp: started,
          durationMs: Date.now() - started,
          rowCount: 0,
          error: message,
        })
        toast.error(`Cypher query failed: ${message}`)
        return
      }

      const data: unknown = await res.json()
      const rows: Record<string, unknown>[] = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : Array.isArray((data as { results?: unknown }).results)
          ? (data as { results: Record<string, unknown>[] }).results
          : []
      setResults(rows)
      appendHistory({
        query: trimmed,
        timestamp: started,
        durationMs: Date.now() - started,
        rowCount: rows.length,
      })
      if (rows.length === 0) {
        toast.info('Query returned no rows.')
      } else {
        toast.success(`Returned ${rows.length} row(s).`)
      }
    } catch (err) {
      const message = String(err)
      setLastError(message)
      setResults([])
      appendHistory({
        query: trimmed,
        timestamp: started,
        durationMs: Date.now() - started,
        rowCount: 0,
        error: message,
      })
      toast.error(`Cypher query failed: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  const appendHistory = (entry: HistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, HISTORY_LIMIT)
      saveHistory(next)
      return next
    })
  }

  const clearHistory = () => {
    setHistory([])
    saveHistory([])
    toast.success('History cleared.')
  }

  const loadHistoryEntry = (entry: HistoryEntry) => {
    setQuery(entry.query)
  }

  const isDestructive = DESTRUCTIVE_RE.test(query)

  return (
    <div className="space-y-6" data-testid="cypher-repl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Terminal className="size-6" />
            Cypher REPL
          </h1>
          <p className="text-muted-foreground text-sm">Execute ad-hoc Cypher queries against the knowledge graph.</p>
        </div>
      </div>

      <div
        className={
          'rounded-md border border-amber-500/50 bg-amber-50/50 ' +
          'dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm'
        }
      >
        <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-muted-foreground">
          Read-only queries recommended; destructive queries may alter the graph.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Query</CardTitle>
                <CardDescription>
                  Default: <span className="font-mono text-xs">{DEFAULT_QUERY}</span>
                </CardDescription>
              </div>
              <Button
                onClick={() => {
                  void runQuery()
                }}
                disabled={loading}
              >
                {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Play className="size-4 mr-2" />}
                Run
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                aria-label="Cypher query"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                }}
                rows={8}
                className="font-mono text-sm"
                spellCheck={false}
              />
              {isDestructive && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="size-4" />
                  <span>This query appears to be destructive. Double-check before running.</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Results</CardTitle>
              <CardDescription>
                {lastError
                  ? 'Last query returned an error.'
                  : results.length === 0
                    ? 'No rows returned yet.'
                    : `Returned ${results.length} row(s). Click a row to expand.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lastError ? (
                <pre
                  className={
                    'rounded border border-destructive/50 bg-destructive/5 p-3 ' +
                    'text-xs text-destructive whitespace-pre-wrap break-words'
                  }
                >
                  {lastError}
                </pre>
              ) : results.length === 0 ? (
                <p className="text-muted-foreground text-sm">No results.</p>
              ) : (
                <div className="space-y-2">
                  {results.map((row, idx) => (
                    <CypherResultRow key={`row-${idx}`} row={row} index={idx} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <History className="size-4" />
              <CardTitle className="text-base">History</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              disabled={history.length === 0}
              aria-label="Clear history"
            >
              <Trash2 className="size-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-muted-foreground text-sm">No queries yet. Run a query to populate history.</p>
            ) : (
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-2">
                  {history.map((entry, idx) => (
                    <button
                      type="button"
                      key={`${entry.timestamp}-${idx}`}
                      onClick={() => {
                        loadHistoryEntry(entry)
                      }}
                      className={'w-full text-left rounded border p-2 ' + 'hover:bg-muted/50 transition-colors'}
                    >
                      <div className={'flex items-center justify-between ' + 'text-xs text-muted-foreground mb-1'}>
                        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                        <span>
                          {entry.error ? (
                            <Badge variant="destructive">error</Badge>
                          ) : (
                            <Badge variant="outline">{entry.rowCount} rows</Badge>
                          )}
                        </span>
                      </div>
                      <p className="font-mono text-xs line-clamp-2 break-words">{entry.query}</p>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
