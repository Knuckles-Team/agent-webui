/**
 * @file DataAnalystView.tsx
 * @description Natural-language → query + data-analyst panel over the gateway.
 *
 * Ask a question in plain language and see:
 *   - the generated query (Cypher/SQL) the planner produced,
 *   - the result rows as a table,
 *   - (in Analyst mode) a synthesized natural-language answer + citations.
 *
 * Two modes map to two gateway routes:
 *   - "Query"   → POST `/graph/nl-query`  (NL→query translation only)
 *   - "Analyst" → POST `/graph/ask-data`  (full multi-step data-analyst loop)
 *
 * Degrades to a "capability not yet activated" notice when the route is absent.
 */

import { useState } from 'react'
import { AlertTriangle, Database, Loader2, Send, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { gatewayPost } from '@/lib/gateway'

type Mode = 'query' | 'analyst'

interface AnalystResponse {
  query: string | null
  answer: string | null
  rows: Record<string, unknown>[]
  citations: string[]
}

/** First non-nullish value among the candidates, or undefined. */
function firstDefined(...vals: unknown[]): unknown {
  for (const v of vals) {
    if (v !== null && v !== undefined) return v
  }
  return undefined
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asRows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : []
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((c) => String(c)) : []
}

/** Pull the query/answer/rows/citations out of the (loosely typed) response. */
function adaptResponse(raw: unknown): AnalystResponse {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    query: asString(firstDefined(obj.query, obj.cypher, obj.sql, obj.generated_query)),
    answer: asString(firstDefined(obj.answer, obj.text)),
    rows: asRows(firstDefined(obj.rows, obj.results, obj.data)),
    citations: asStringArray(firstDefined(obj.citations, obj.sources)),
  }
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No rows returned.</p>
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left p-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`row-${String(i)}`} className="border-t">
              {cols.map((c) => {
                const v = r[c]
                const text = typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v)
                return (
                  <td key={c} className="p-2 font-mono text-xs max-w-xs truncate" title={text}>
                    {text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function modeDescription(mode: Mode): string {
  return mode === 'query' ? 'NL → query translation (`/graph/nl-query`)' : 'Full analyst loop (`/graph/ask-data`)'
}

function canAsk(loading: boolean, question: string): boolean {
  return !loading && question.trim().length > 0
}

function AskIcon({ loading }: { loading: boolean }) {
  return loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />
}

function UnavailableNotice({ mode }: { mode: Mode }) {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm">
      <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-muted-foreground">
        The <span className="font-mono">{mode === 'query' ? '/graph/nl-query' : '/graph/ask-data'}</span> gateway route
        is not activated on this backend yet.
      </p>
    </div>
  )
}

function ErrorNotice({ error }: { error: string }) {
  return (
    <pre className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
      {error}
    </pre>
  )
}

function AnswerCard({ response }: { response: AnalystResponse }) {
  if (!response.answer) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="size-4" />
          Answer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm whitespace-pre-wrap">{response.answer}</p>
        {response.citations.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2">
            {response.citations.map((c, i) => (
              <Badge key={`${c}-${String(i)}`} variant="secondary" className="font-mono text-xs">
                {c}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function QueryCard({ query }: { query: string | null }) {
  if (!query) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Generated query</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="rounded bg-muted/40 p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words">
          {query}
        </pre>
      </CardContent>
    </Card>
  )
}

function ResultsCard({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Results</CardTitle>
        <CardDescription>{rows.length} row(s)</CardDescription>
      </CardHeader>
      <CardContent>
        <ResultTable rows={rows} />
      </CardContent>
    </Card>
  )
}

function ResponseSection({ response }: { response: AnalystResponse }) {
  return (
    <div className="space-y-4">
      <AnswerCard response={response} />
      <QueryCard query={response.query} />
      <ResultsCard rows={response.rows} />
    </div>
  )
}

export default function DataAnalystView() {
  const [mode, setMode] = useState<Mode>('analyst')
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<AnalystResponse | null>(null)

  const ask = async () => {
    const q = question.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    const path = mode === 'query' ? '/nl-query' : '/ask-data'
    const r = await gatewayPost<unknown>(path, { question: q, query: q })
    setUnavailable(r.unavailable)
    if (r.ok) setResponse(adaptResponse(r.data))
    else {
      setResponse(null)
      if (!r.unavailable) setError(r.error ?? 'Request failed')
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6" data-testid="data-analyst-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="size-6" />
          Data Analyst
        </h1>
        <p className="text-muted-foreground text-sm">
          Ask in natural language — the planner generates a query and (in Analyst mode) synthesizes an answer.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Ask a question</CardTitle>
            <CardDescription>{modeDescription(mode)}</CardDescription>
          </div>
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as Mode)
            }}
          >
            <TabsList>
              <TabsTrigger value="analyst" className="gap-1">
                <Sparkles className="size-3" />
                Analyst
              </TabsTrigger>
              <TabsTrigger value="query" className="gap-1">
                <Database className="size-3" />
                Query
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            aria-label="Question"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value)
            }}
            placeholder="e.g. Which agents produced the most facts last week?"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask()
            }}
          />
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void ask()
              }}
              disabled={!canAsk(loading, question)}
            >
              <AskIcon loading={loading} />
              Ask
            </Button>
          </div>
        </CardContent>
      </Card>

      {unavailable && <UnavailableNotice mode={mode} />}
      {error && <ErrorNotice error={error} />}
      {response && <ResponseSection response={response} />}
    </div>
  )
}
