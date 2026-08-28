/**
 * @file SparqlView.tsx
 * @description SPARQL query panel + SHACL validation-report view
 * (Ontology-Playground coverage rows #9 / #97 frontend gaps).
 *
 * Backend is already complete — `POST/GET /api/sparql` (a local, zero-dependency
 * SPARQL 1.1 bridge) and `POST /api/ontology/validate` (the valid/connected/SHACL
 * gate, `graph_ontology(action='validate')`'s granular REST twin). This view is
 * thin by design (transport + render), analogous to `DataAnalystView.tsx`'s
 * NL-query UI: a textarea, a submit button, and a results table / report panel
 * — no new query engine, no new validation logic.
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDot, Database, Loader2, Play, ShieldCheck, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, ApiError } from '@/lib/api'

type Mode = 'sparql' | 'shacl'

const DEFAULT_SPARQL = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25'

/** One SPARQL-JSON binding row — a variable may be unbound in a given row (OPTIONAL). */
type SparqlBindingRow = Record<string, { value: unknown } | undefined>

/** Renders SPARQL-JSON bindings as a table (dynamic columns from `head.vars`). */
function SparqlResultTable({ vars, bindings }: { vars: string[]; bindings: SparqlBindingRow[] }) {
  if (bindings.length === 0) return <p className="text-muted-foreground text-sm">No rows returned.</p>
  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b">
          <tr className="border-b transition-colors">
            {vars.map((v) => (
              <th key={v} className="h-10 px-3 text-left align-middle font-medium">
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {bindings.map((row, i) => (
            <tr key={`row-${String(i)}`} className="border-b transition-colors hover:bg-muted/50">
              {vars.map((v) => {
                const cell = row[v]?.value
                const text = typeof cell === 'string' ? cell : cell === undefined ? '' : JSON.stringify(cell)
                return (
                  <td key={v} className="px-3 py-2 align-middle font-mono text-xs max-w-xs truncate" title={text}>
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

interface SparqlTabProps {
  sparqlQuery: string
  onSparqlQueryChange: (v: string) => void
  sparqlRunning: boolean
  onRunSparql: () => void
}

function renderSparqlTab({ sparqlQuery, onSparqlQueryChange, sparqlRunning, onRunSparql }: SparqlTabProps) {
  return (
    <CardContent className="space-y-3">
      <Textarea
        aria-label="SPARQL query"
        value={sparqlQuery}
        onChange={(e) => {
          onSparqlQueryChange(e.target.value)
        }}
        placeholder={DEFAULT_SPARQL}
        rows={5}
        className="font-mono text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onRunSparql()
        }}
      />
      <div className="flex justify-end">
        <Button onClick={onRunSparql} disabled={sparqlRunning || !sparqlQuery.trim()}>
          {sparqlRunning ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Play className="size-4 mr-2" />}
          Run Query
        </Button>
      </div>
    </CardContent>
  )
}

interface ShaclTabProps {
  shaclSource: string
  onShaclSourceChange: (v: string) => void
  shaclSourceType: 'text' | 'file' | 'url' | 'auto'
  onShaclSourceTypeChange: (v: 'text' | 'file' | 'url' | 'auto') => void
  shaclRunning: boolean
  onRunValidate: () => void
}

function renderShaclTab({
  shaclSource,
  onShaclSourceChange,
  shaclSourceType,
  onShaclSourceTypeChange,
  shaclRunning,
  onRunValidate,
}: ShaclTabProps) {
  return (
    <CardContent className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-muted-foreground">Source type</label>
        <Select
          value={shaclSourceType}
          onValueChange={(v) => {
            onShaclSourceTypeChange(v as typeof shaclSourceType)
          }}
        >
          <SelectTrigger className="w-40 text-xs" aria-label="Source type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Raw turtle text</SelectItem>
            <SelectItem value="file">File path</SelectItem>
            <SelectItem value="url">URL</SelectItem>
            <SelectItem value="auto">Auto-detect</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Textarea
        aria-label="Ontology candidate source"
        value={shaclSource}
        onChange={(e) => {
          onShaclSourceChange(e.target.value)
        }}
        placeholder="Paste turtle/RDF text, or a file path / URL matching the selected source type..."
        rows={6}
        className="font-mono text-xs"
      />
      <div className="flex justify-end">
        <Button onClick={onRunValidate} disabled={shaclRunning || !shaclSource.trim()}>
          {shaclRunning ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ShieldCheck className="size-4 mr-2" />}
          Validate
        </Button>
      </div>
    </CardContent>
  )
}

function renderErrorBlock(error: string | null) {
  if (!error) return null
  return (
    <pre className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
      {error}
    </pre>
  )
}

function renderSparqlResultsCard({ vars, bindings }: { vars: string[]; bindings: SparqlBindingRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Results</CardTitle>
        <CardDescription>{bindings.length} row(s)</CardDescription>
      </CardHeader>
      <CardContent>
        <SparqlResultTable vars={vars} bindings={bindings} />
      </CardContent>
    </Card>
  )
}

type ShaclResult = Awaited<ReturnType<typeof api.validateOntologyCandidate>>

function renderShaclErrorsList(errors: string[]) {
  if (errors.length === 0) return null
  return (
    <div>
      <p className="font-medium text-destructive flex items-center gap-1.5 mb-1">
        <XCircle className="size-3.5" /> Errors
      </p>
      <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
        {errors.map((e, i) => (
          <li key={`err-${String(i)}`}>{e}</li>
        ))}
      </ul>
    </div>
  )
}

function renderShaclWarningsList(warnings: string[]) {
  if (warnings.length === 0) return null
  return (
    <div>
      <p className="font-medium text-amber-500 flex items-center gap-1.5 mb-1">
        <AlertTriangle className="size-3.5" /> Warnings
      </p>
      <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
        {warnings.map((w, i) => (
          <li key={`warn-${String(i)}`}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

function renderShaclSummary(summary: Record<string, unknown>) {
  if (Object.keys(summary).length === 0) return null
  return (
    <div>
      <p className="font-medium flex items-center gap-1.5 mb-1">
        <CircleDot className="size-3.5" /> Summary
      </p>
      <dl className="grid grid-cols-2 gap-1 text-xs">
        {Object.entries(summary).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-border/20 pb-0.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono text-right break-all">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function renderShaclReportRaw(shaclResult: ShaclResult) {
  if (!shaclResult.shacl_report?.text) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">sh:ValidationReport</CardTitle>
        <CardDescription>Literal SHACL validation report from pyshacl.</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="rounded bg-muted/40 p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words">
          {shaclResult.shacl_report.text}
        </pre>
      </CardContent>
    </Card>
  )
}

function renderResultsSection({
  mode,
  sparqlError,
  sparqlVars,
  sparqlBindings,
  shaclError,
  shaclResult,
}: {
  mode: Mode
  sparqlError: string | null
  sparqlVars: string[]
  sparqlBindings: SparqlBindingRow[]
  shaclError: string | null
  shaclResult: ShaclResult | null
}) {
  if (mode === 'sparql') {
    const hasResults = !sparqlError && sparqlBindings.length + sparqlVars.length > 0
    return (
      <>
        {renderErrorBlock(sparqlError)}
        {hasResults && renderSparqlResultsCard({ vars: sparqlVars, bindings: sparqlBindings })}
      </>
    )
  }
  return (
    <>
      {renderErrorBlock(shaclError)}
      {shaclResult && renderShaclReport(shaclResult)}
    </>
  )
}

function renderShaclReport(shaclResult: ShaclResult) {
  return (
    <div className="space-y-4" data-testid="shacl-report">
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          {shaclResult.valid ? (
            <CheckCircle2 className="size-5 text-emerald-500" />
          ) : (
            <XCircle className="size-5 text-destructive" />
          )}
          <CardTitle className="text-base">{shaclResult.valid ? 'Valid' : 'Invalid'}</CardTitle>
          {shaclResult.shacl_report && (
            <Badge variant={shaclResult.shacl_report.conforms ? 'secondary' : 'destructive'} className="ml-auto">
              SHACL {shaclResult.shacl_report.conforms ? 'conforms' : 'non-conforming'}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {renderShaclErrorsList(shaclResult.errors)}
          {renderShaclWarningsList(shaclResult.warnings)}
          {renderShaclSummary(shaclResult.summary)}
        </CardContent>
      </Card>

      {renderShaclReportRaw(shaclResult)}
    </div>
  )
}

export default function SparqlView() {
  const [mode, setMode] = useState<Mode>('sparql')

  // SPARQL tab state
  const [sparqlQuery, setSparqlQuery] = useState(DEFAULT_SPARQL)
  const [sparqlRunning, setSparqlRunning] = useState(false)
  const [sparqlError, setSparqlError] = useState<string | null>(null)
  const [sparqlVars, setSparqlVars] = useState<string[]>([])
  const [sparqlBindings, setSparqlBindings] = useState<SparqlBindingRow[]>([])

  // SHACL tab state
  const [shaclSource, setShaclSource] = useState('')
  const [shaclSourceType, setShaclSourceType] = useState<'text' | 'file' | 'url' | 'auto'>('text')
  const [shaclRunning, setShaclRunning] = useState(false)
  const [shaclError, setShaclError] = useState<string | null>(null)
  const [shaclResult, setShaclResult] = useState<Awaited<ReturnType<typeof api.validateOntologyCandidate>> | null>(
    null,
  )

  const runSparql = async () => {
    const q = sparqlQuery.trim()
    if (!q) return
    setSparqlRunning(true)
    setSparqlError(null)
    try {
      const res = await api.runSparqlQuery(q)
      if (res.status !== 'success') {
        setSparqlError(res.message ?? 'SPARQL query failed')
        setSparqlVars([])
        setSparqlBindings([])
      } else {
        setSparqlVars(res.head?.vars ?? [])
        setSparqlBindings(res.results?.bindings ?? [])
      }
    } catch (err) {
      setSparqlError(err instanceof ApiError ? err.message : String(err))
      setSparqlVars([])
      setSparqlBindings([])
    } finally {
      setSparqlRunning(false)
    }
  }

  const runValidate = async () => {
    const source = shaclSource.trim()
    if (!source) return
    setShaclRunning(true)
    setShaclError(null)
    try {
      const result = await api.validateOntologyCandidate({ source, source_type: shaclSourceType })
      setShaclResult(result)
    } catch (err) {
      setShaclError(err instanceof ApiError ? err.message : String(err))
      setShaclResult(null)
    } finally {
      setShaclRunning(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="sparql-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="size-6 text-emerald-400" />
          SPARQL &amp; SHACL
        </h1>
        <p className="text-muted-foreground text-sm">
          Run a SPARQL 1.1 query against the live ontology, or validate a candidate ontology against the
          valid/connected/SHACL gate.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{mode === 'sparql' ? 'SPARQL Query' : 'SHACL Validate'}</CardTitle>
            <CardDescription>
              {mode === 'sparql' ? 'POST /api/sparql — content-negotiated JSON' : 'POST /api/ontology/validate'}
            </CardDescription>
          </div>
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as Mode)
            }}
          >
            <TabsList>
              <TabsTrigger value="sparql" className="gap-1">
                <Database className="size-3" />
                SPARQL
              </TabsTrigger>
              <TabsTrigger value="shacl" className="gap-1">
                <ShieldCheck className="size-3" />
                SHACL
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>

        {mode === 'sparql'
          ? renderSparqlTab({
              sparqlQuery,
              onSparqlQueryChange: setSparqlQuery,
              sparqlRunning,
              onRunSparql: () => {
                void runSparql()
              },
            })
          : renderShaclTab({
              shaclSource,
              onShaclSourceChange: setShaclSource,
              shaclSourceType,
              onShaclSourceTypeChange: setShaclSourceType,
              shaclRunning,
              onRunValidate: () => {
                void runValidate()
              },
            })}
      </Card>

      {renderResultsSection({ mode, sparqlError, sparqlVars, sparqlBindings, shaclError, shaclResult })}
    </div>
  )
}
