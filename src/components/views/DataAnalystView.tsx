/**
 * @file DataAnalystView.tsx
 * @description Natural-language → query + data-analyst panel over the gateway.
 *
 * Ask a question in plain language and see the governed response.  Query mode
 * renders the canonical EvidenceBundle (answer candidate, claims, generated
 * query, plan, attempts, and provenance); Analyst mode remains a compatibility
 * view for the older `/graph/ask-data` response.
 *
 * Two modes map to two gateway routes:
 *   - "Query"   → POST `/graph/nl-query`  (EvidenceBundle compile preview)
 *   - "Analyst" → POST `/graph/ask-data`  (legacy full multi-step data-analyst loop)
 *
 * Degrades to a "capability not yet activated" notice when the route is absent.
 */

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Database, Loader2, Send, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { atlasPost } from '@/lib/atlas/transport'
import {
  attemptsForDisplay,
  bundleErrorMessage,
  compileNaturalLanguageQuery,
  generatedQueryForDisplay,
  plansForDisplay,
  redactNaturalLanguageText,
  redactNaturalLanguageValue,
  sourceAuthorityForDisplay,
  type NaturalLanguageQueryBundle,
  type NaturalLanguageQueryProvenance,
  type NaturalLanguageQueryResult,
} from '@/lib/atlas/natural-language'

type Mode = 'query' | 'analyst'

interface LegacyAnalystResponse {
  query: string | null
  answer: string | null
  rows: Record<string, unknown>[]
  citations: string[]
}

interface NaturalLanguageResponse {
  bundle: NaturalLanguageQueryBundle
  provenance: NaturalLanguageQueryProvenance
}

interface AskCallbacks {
  isCurrent: () => boolean
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setUnavailable: (unavailable: boolean) => void
  setLegacyResponse: (response: LegacyAnalystResponse | null) => void
  setNaturalLanguageResponse: (response: NaturalLanguageResponse | null) => void
}

interface AskRouteOptions {
  question: string
  signal: AbortSignal
  callbacks: AskCallbacks
}

interface AskDataAnalystOptions {
  mode: Mode
  question: string
  signal: AbortSignal
  callbacks: AskCallbacks
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

/**
 * Pull the legacy `/graph/ask-data` fields out of its response.
 *
 * The NL-query route does not use this adapter: its EvidenceBundle is decoded
 * by `atlas/natural-language` and reads generated query/evidence from the
 * reasoning trace and claims.  Keep this compatibility seam local to the
 * older analyst route until that backend adopts the same bundle response.
 */
function adaptLegacyAnalystResponse(raw: unknown): LegacyAnalystResponse {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    query: asString(firstDefined(obj.query, obj.cypher, obj.sql, obj.generated_query)),
    answer: asString(firstDefined(obj.answer, obj.text)),
    rows: asRows(firstDefined(obj.rows, obj.results, obj.data)),
    citations: asStringArray(firstDefined(obj.citations, obj.sources)),
  }
}

function updateIfCurrent<T>(callbacks: AskCallbacks, setter: (value: T) => void, value: T): void {
  if (callbacks.isCurrent()) setter(value)
}

function invalidateActiveRequest(
  activeController: { current: AbortController | null },
  requestGeneration: { current: number },
): void {
  activeController.current?.abort()
  activeController.current = null
  requestGeneration.current += 1
}

function partialNaturalLanguageResponse(response: NaturalLanguageQueryResult): NaturalLanguageResponse | null {
  if (!response.partial || !response.data) return null
  return { bundle: response.data, provenance: response.provenance }
}

async function askNaturalLanguage({ question, signal, callbacks }: AskRouteOptions): Promise<void> {
  const response = await compileNaturalLanguageQuery(question, signal)
  updateIfCurrent(callbacks, callbacks.setUnavailable, response.unavailable)
  updateIfCurrent(callbacks, callbacks.setLegacyResponse, null)
  if (response.ok && response.data) {
    updateIfCurrent(callbacks, callbacks.setNaturalLanguageResponse, {
      bundle: response.data,
      provenance: response.provenance,
    })
    return
  }
  updateIfCurrent(callbacks, callbacks.setNaturalLanguageResponse, partialNaturalLanguageResponse(response))
  if (!response.unavailable) {
    updateIfCurrent(callbacks, callbacks.setError, response.error ?? 'NL query request failed')
  }
}

async function askLegacyAnalyst({ question, signal, callbacks }: AskRouteOptions): Promise<void> {
  updateIfCurrent(callbacks, callbacks.setNaturalLanguageResponse, null)
  const response = await atlasPost<unknown>('/api/graph/ask-data', { question }, signal)
  updateIfCurrent(callbacks, callbacks.setUnavailable, response.unavailable)
  if (response.ok) {
    updateIfCurrent(callbacks, callbacks.setLegacyResponse, adaptLegacyAnalystResponse(response.data))
    return
  }
  updateIfCurrent(callbacks, callbacks.setLegacyResponse, null)
  if (!response.unavailable) updateIfCurrent(callbacks, callbacks.setError, response.error ?? 'Request failed')
}

/** Explicit mode routing keeps the legacy analyst lane out of query fallback. */
const askHandlers: Record<Mode, (options: AskRouteOptions) => Promise<void>> = {
  query: askNaturalLanguage,
  analyst: askLegacyAnalyst,
}

async function askDataAnalyst({ mode, question, signal, callbacks }: AskDataAnalystOptions): Promise<void> {
  const trimmedQuestion = question.trim()
  if (!trimmedQuestion || !callbacks.isCurrent()) return
  updateIfCurrent(callbacks, callbacks.setLoading, true)
  updateIfCurrent(callbacks, callbacks.setError, null)
  updateIfCurrent(callbacks, callbacks.setUnavailable, false)
  try {
    await askHandlers[mode]({ question: trimmedQuestion, signal, callbacks })
  } catch (err) {
    updateIfCurrent(callbacks, callbacks.setError, err instanceof Error ? err.message : String(err))
  } finally {
    updateIfCurrent(callbacks, callbacks.setLoading, false)
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
  return mode === 'query'
    ? 'Governed NL compile preview (execute=false) with EvidenceBundle trace (`/graph/nl-query`)'
    : 'Full analyst loop (`/graph/ask-data`)'
}

function canAsk(question: string): boolean {
  return question.trim().length > 0
}

function AskIcon({ loading }: { loading: boolean }) {
  return loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />
}

function UnavailableNotice({ mode }: { mode: Mode }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="rounded-md border border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm"
    >
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
    <pre
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap break-words"
    >
      {redactNaturalLanguageText(error)}
    </pre>
  )
}

function AnswerCard({ response }: { response: LegacyAnalystResponse }) {
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

function ResponseSection({ response }: { response: LegacyAnalystResponse }) {
  return (
    <div className="space-y-4">
      <AnswerCard response={response} />
      <QueryCard query={response.query} />
      <ResultsCard rows={response.rows} />
    </div>
  )
}

function jsonText(value: unknown): string {
  if (typeof value === 'string') return redactNaturalLanguageText(value)
  try {
    const encoded = JSON.stringify(redactNaturalLanguageValue(value), null, 2)
    return typeof encoded === 'string' ? encoded : ''
  } catch {
    return '[unserializable JSON value]'
  }
}

function NaturalLanguageAnswerCard({ bundle }: { bundle: NaturalLanguageQueryBundle }) {
  return (
    <Card data-testid="natural-language-answer">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="size-4" />
          Answer candidate
        </CardTitle>
      </CardHeader>
      <CardContent>
        {bundle.answer_candidate ? (
          <p className="text-sm whitespace-pre-wrap">{redactNaturalLanguageText(bundle.answer_candidate)}</p>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="answer-unavailable">
            No answer candidate was returned by the gateway.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function EvidenceCard({ bundle }: { bundle: NaturalLanguageQueryBundle }) {
  const spans = bundle.evidence_spans ?? []
  const hasEvidence = bundle.claims.length > 0 || spans.length > 0
  return (
    <Card data-testid="natural-language-evidence">
      <CardHeader>
        <CardTitle className="text-base">Evidence</CardTitle>
        <CardDescription>
          {bundle.claims.length} claim(s), {spans.length} evidence span(s) from the gateway bundle
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasEvidence && (
          <p className="text-sm text-muted-foreground" data-testid="evidence-unavailable">
            No evidence claims or spans were returned.
          </p>
        )}
        {bundle.claims.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Claims</h3>
            <ol className="space-y-2 list-decimal list-inside">
              {bundle.claims.map((claim, index) => (
                <li key={`claim-${String(index)}`}>
                  <pre className="inline-block align-top rounded bg-muted/40 p-2 text-xs font-mono whitespace-pre-wrap break-words max-w-full">
                    {jsonText(claim)}
                  </pre>
                </li>
              ))}
            </ol>
          </div>
        )}
        {spans.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Evidence spans</h3>
            <div className="space-y-2">
              {spans.map((span, index) => (
                <pre
                  key={`span-${String(index)}`}
                  className="rounded bg-muted/40 p-2 text-xs font-mono whitespace-pre-wrap break-words"
                >
                  {jsonText(span)}
                </pre>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function GeneratedQueryCard({ bundle }: { bundle: NaturalLanguageQueryBundle }) {
  const query = generatedQueryForDisplay(bundle)
  return (
    <Card data-testid="natural-language-generated-query">
      <CardHeader>
        <CardTitle className="text-base">Generated query</CardTitle>
        <CardDescription>Compile preview; execution was not requested.</CardDescription>
      </CardHeader>
      <CardContent>
        {query ? (
          <pre className="rounded bg-muted/40 p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words">
            {query}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="generated-query-unavailable">
            Generated query unavailable: the gateway did not include one in its reasoning trace.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function PlanCard({ bundle }: { bundle: NaturalLanguageQueryBundle }) {
  const plans = plansForDisplay(bundle)
  const grammarVersions = Array.from(
    new Set(plans.map((plan) => plan.grammar_version).filter((version): version is string => Boolean(version))),
  )
  return (
    <Card data-testid="natural-language-plans">
      <CardHeader>
        <CardTitle className="text-base">Plan</CardTitle>
        {grammarVersions.length > 0 && (
          <CardDescription>
            Grammar:{' '}
            {grammarVersions.map((version) => (
              <span key={version} className="font-mono">
                {version}
              </span>
            ))}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {plans.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="plan-unavailable">
            No generated plan was returned in the reasoning trace.
          </p>
        ) : (
          plans.map((plan, index) => (
            <pre
              key={`plan-${String(index)}`}
              className="rounded bg-muted/40 p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words"
            >
              {jsonText(plan)}
            </pre>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function AttemptsCard({ bundle }: { bundle: NaturalLanguageQueryBundle }) {
  const attempts = attemptsForDisplay(bundle)
  return (
    <Card data-testid="natural-language-attempts">
      <CardHeader>
        <CardTitle className="text-base">Planner attempts</CardTitle>
        <CardDescription>{attempts.length} bounded attempt(s) recorded</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {attempts.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="attempts-unavailable">
            No planner attempts were returned in the reasoning trace.
          </p>
        ) : (
          attempts.map((attempt, index) => (
            <pre
              key={`attempt-${String(index)}`}
              className="rounded bg-muted/40 p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words"
            >
              {jsonText(attempt)}
            </pre>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function ProvenanceCard({ provenance }: { provenance: NaturalLanguageQueryProvenance }) {
  const sourceAuthority = sourceAuthorityForDisplay(provenance.response?.sourceAuthority)
  return (
    <Card data-testid="natural-language-provenance">
      <CardHeader>
        <CardTitle className="text-base">Provenance</CardTitle>
        <CardDescription>
          Request and response coverage recorded by Atlas
          {provenance.response && (
            <span>
              {' '}
              ({provenance.response.claimCount} claims, {provenance.response.evidenceSpanCount} evidence spans,{' '}
              {provenance.response.traceStepCount} trace steps)
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          Endpoint: <span className="font-mono">{provenance.endpoint}</span>
        </p>
        <p>
          Operation: <span className="font-mono">{provenance.operation}</span>
        </p>
        {provenance.request && (
          <pre className="rounded bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap break-words">
            {jsonText(provenance.request)}
          </pre>
        )}
        {sourceAuthority && (
          <pre className="rounded bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap break-words">
            {jsonText(sourceAuthority)}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}

function BundleErrorNotice({ bundle }: { bundle: NaturalLanguageQueryBundle }) {
  const message = bundleErrorMessage(bundle)
  if (!message) return null
  return <ErrorNotice error={`The gateway reported an NL query failure: ${message}`} />
}

function NaturalLanguageResponseSection({
  bundle,
  provenance,
}: {
  bundle: NaturalLanguageQueryBundle
  provenance: NaturalLanguageQueryProvenance
}) {
  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Natural-language query response"
      className="space-y-4"
      data-testid="natural-language-response"
    >
      <BundleErrorNotice bundle={bundle} />
      <NaturalLanguageAnswerCard bundle={bundle} />
      <EvidenceCard bundle={bundle} />
      <GeneratedQueryCard bundle={bundle} />
      <PlanCard bundle={bundle} />
      <AttemptsCard bundle={bundle} />
      <ProvenanceCard provenance={provenance} />
    </div>
  )
}

function ResponseContent({
  mode,
  naturalLanguageResponse,
  legacyResponse,
}: {
  mode: Mode
  naturalLanguageResponse: NaturalLanguageResponse | null
  legacyResponse: LegacyAnalystResponse | null
}) {
  if (mode === 'query' && naturalLanguageResponse) {
    return (
      <NaturalLanguageResponseSection
        bundle={naturalLanguageResponse.bundle}
        provenance={naturalLanguageResponse.provenance}
      />
    )
  }
  if (mode === 'analyst' && legacyResponse) return <ResponseSection response={legacyResponse} />
  return null
}

export default function DataAnalystView() {
  const [mode, setMode] = useState<Mode>('analyst')
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [legacyResponse, setLegacyResponse] = useState<LegacyAnalystResponse | null>(null)
  const [naturalLanguageResponse, setNaturalLanguageResponse] = useState<NaturalLanguageResponse | null>(null)
  const requestGeneration = useRef(0)
  const activeController = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      invalidateActiveRequest(activeController, requestGeneration)
    }
  }, [])

  const ask = () => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) return
    invalidateActiveRequest(activeController, requestGeneration)
    const controller = new AbortController()
    activeController.current = controller
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    const callbacks: AskCallbacks = {
      isCurrent: () => requestGeneration.current === generation && activeController.current === controller,
      setLoading,
      setError,
      setUnavailable,
      setLegacyResponse,
      setNaturalLanguageResponse,
    }
    void askDataAnalyst({
      mode,
      question: trimmedQuestion,
      signal: controller.signal,
      callbacks,
    }).finally(() => {
      if (activeController.current === controller) activeController.current = null
    })
  }

  return (
    <div className="space-y-6" data-testid="data-analyst-view" aria-busy={loading}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="size-6" />
          Data Analyst
        </h1>
        <p className="text-muted-foreground text-sm">
          Ask in natural language — the governed planner returns an auditable query, evidence, and reasoning trace.
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
              invalidateActiveRequest(activeController, requestGeneration)
              setLoading(false)
              setError(null)
              setUnavailable(false)
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
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                ask()
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              onClick={() => {
                ask()
              }}
              disabled={!canAsk(question)}
            >
              <AskIcon loading={loading} />
              Ask
            </Button>
          </div>
        </CardContent>
      </Card>

      {unavailable && <UnavailableNotice mode={mode} />}
      {error && <ErrorNotice error={error} />}
      <ResponseContent mode={mode} naturalLanguageResponse={naturalLanguageResponse} legacyResponse={legacyResponse} />
    </div>
  )
}
