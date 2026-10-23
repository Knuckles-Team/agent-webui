import { useId, type KeyboardEvent } from 'react'
import { AlertTriangle, CheckCircle2, CircleDot, Database, Loader2, Play, ShieldCheck, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { api } from '@/lib/api'
import type { Mode, Pane, SparqlBindingRow, SubmittedInput, QueryValidationController } from './useQueryValidationLens'

const DEFAULT_SPARQL = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25'

/** Renders SPARQL-JSON bindings as a table (dynamic columns from `head.vars`). */
function SparqlResultTable({ vars, bindings }: { vars: string[]; bindings: SparqlBindingRow[] }) {
  if (bindings.length === 0) return <p className="text-muted-foreground text-sm">No rows returned.</p>
  return (
    <div
      role="region"
      aria-label="SPARQL result table"
      tabIndex={0}
      className="max-w-full rounded-md border overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring"
    >
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
                  <td
                    key={v}
                    className="px-3 py-2 align-middle font-mono text-xs min-w-32 max-w-xs whitespace-pre-wrap break-all"
                    title={text}
                  >
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
        className="font-mono text-base min-w-0"
        onKeyDown={(e) => {
          submitQueryShortcut(e, sparqlRunning, onRunSparql)
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
  sourceTypeId: string
  shaclSource: string
  onShaclSourceChange: (v: string) => void
  shaclSourceType: 'text' | 'file' | 'url' | 'auto'
  onShaclSourceTypeChange: (v: 'text' | 'file' | 'url' | 'auto') => void
  shaclRunning: boolean
  onRunValidate: () => void
}

function renderShaclTab({
  sourceTypeId,
  shaclSource,
  onShaclSourceChange,
  shaclSourceType,
  onShaclSourceTypeChange,
  shaclRunning,
  onRunValidate,
}: ShaclTabProps) {
  return (
    <CardContent className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={sourceTypeId} className="text-xs font-semibold text-muted-foreground">
          Source type
        </label>
        <Select
          value={shaclSourceType}
          onValueChange={(v) => {
            onShaclSourceTypeChange(v as typeof shaclSourceType)
          }}
        >
          <SelectTrigger id={sourceTypeId} className="w-40 text-xs" aria-label="Source type">
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
        className="font-mono text-base min-w-0"
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
    <pre
      role="alert"
      className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap break-all"
    >
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
      <dl className="grid grid-cols-1 gap-1 text-sm">
        {Object.entries(summary).map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-2 border-b border-border/20 pb-0.5">
            <dt className="text-muted-foreground break-all">{k}</dt>
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
        <pre className="rounded bg-muted/40 p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
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
  sparqlCompleted,
  shaclError,
  shaclResult,
}: {
  mode: Mode
  sparqlError: string | null
  sparqlVars: string[]
  sparqlBindings: SparqlBindingRow[]
  sparqlCompleted: boolean
  shaclError: string | null
  shaclResult: ShaclResult | null
}) {
  if (mode === 'sparql') {
    const hasResults = !sparqlError && sparqlCompleted
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
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
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

function submitQueryShortcut(event: KeyboardEvent<HTMLTextAreaElement>, running: boolean, submit: () => void) {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
  event.preventDefault()
  if (!running) submit()
}
function PaneControls({ pane, onChange }: { pane: Pane; onChange: (pane: Pane) => void }) {
  const labels = { editor: 'Editor', results: 'Results', both: 'Both' }
  return (
    <div role="group" aria-label="Visible panes" className="flex flex-wrap gap-2">
      {(['editor', 'results', 'both'] as const).map((value) => (
        <Button
          key={value}
          variant={pane === value ? 'default' : 'outline'}
          className="min-h-11"
          aria-pressed={pane === value}
          onClick={() => {
            onChange(value)
          }}
        >
          {labels[value]}
        </Button>
      ))}
    </div>
  )
}
function executionStatus(
  running: boolean,
  error: string | null,
  completed: boolean,
  labels: { pending: string; failed: string; complete: string; idle: string },
) {
  if (running) return labels.pending
  if (error) return labels.failed
  return completed ? labels.complete : labels.idle
}

function inputDiffers(draft: SubmittedInput, submitted: SubmittedInput | null) {
  if (!submitted) return false
  return draft.text.trim() !== submitted.text || draft.sourceType !== submitted.sourceType
}

function DraftNotice({ draft, pending, completed }: SubmissionContextProps) {
  if (inputDiffers(draft, pending))
    return (
      <p className="text-sm text-amber-700 dark:text-amber-300">
        Draft changed while this request is pending. These edits have not been submitted.
      </p>
    )
  if (pending) return null
  if (!inputDiffers(draft, completed)) return null
  return (
    <p className="text-sm text-amber-700 dark:text-amber-300">
      Current draft differs from the submitted input. Run again to update results.
    </p>
  )
}

interface SubmissionContextProps {
  draft: SubmittedInput
  pending: SubmittedInput | null
  completed: SubmittedInput | null
}

function SubmittedInputDetails({ input, label }: { input: SubmittedInput; label: string }) {
  return (
    <div className="rounded border p-3 space-y-2" role="group" aria-label={label}>
      <p className="text-sm font-medium">{label}</p>
      {input.sourceType && <p className="text-sm">Submitted source type: {input.sourceType}</p>}
      <pre className="text-sm whitespace-pre-wrap break-all">{input.text}</pre>
    </div>
  )
}

function SubmissionContext({ pending, completed }: SubmissionContextProps) {
  return (
    <div className="space-y-3">
      {pending && <SubmittedInputDetails input={pending} label="Pending submitted input" />}
      {completed && (
        <SubmittedInputDetails
          input={completed}
          label={pending ? 'Previous response input (new request pending)' : 'Response submitted input'}
        />
      )}
    </div>
  )
}

export interface QueryValidationLensProps {
  controller: QueryValidationController
}

export function QueryValidationLens({ controller }: QueryValidationLensProps) {
  const sourceTypeId = useId()
  const {
    mode,
    setMode,
    pane,
    setPane,
    sparqlCompleted,
    sparqlQuery,
    setSparqlQuery,
    sparqlRunning,
    sparqlError,
    sparqlVars,
    sparqlBindings,
    shaclSource,
    setShaclSource,
    shaclSourceType,
    setShaclSourceType,
    shaclRunning,
    shaclError,
    shaclResult,
    runSparql,
    runValidate,
    submission,
  } = controller
  return (
    <div
      className="min-w-0 max-w-full space-y-4 [&_[data-slot=card]]:min-w-0 [&_[data-slot=card-header]]:p-4 [&_[data-slot=card-content]]:p-4 [&_[data-slot=card-content]]:pt-0"
      role="region"
      aria-label="Query and validation"
      data-testid="query-validation-lens"
    >
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
      <PaneControls pane={pane} onChange={setPane} />
      <p role="status" className="text-sm text-muted-foreground">
        {mode === 'sparql'
          ? executionStatus(sparqlRunning, sparqlError, sparqlCompleted, {
              pending: 'Running query…',
              failed: 'Query failed. See Results.',
              complete: `Query complete: ${sparqlBindings.length} row(s).`,
              idle: 'Query has not run yet.',
            })
          : executionStatus(shaclRunning, shaclError, Boolean(shaclResult), {
              pending: 'Validating…',
              failed: 'Validation failed. See Results.',
              complete: 'Validation complete. See Results.',
              idle: 'Validation has not run yet.',
            })}
      </p>
      <DraftNotice {...submission} />
      <section aria-label="Editor" hidden={pane === 'results'}>
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>{{ sparql: 'SPARQL Query', shacl: 'SHACL Validate' }[mode]}</CardTitle>
              <CardDescription>
                {mode === 'sparql'
                  ? 'Write a query. Ctrl+Enter or Command+Enter runs it.'
                  : 'Choose a source type and validate the candidate.'}
              </CardDescription>
            </div>
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
                sourceTypeId,
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
      </section>
      <section aria-label="Results" hidden={pane === 'editor'} className="min-w-0 space-y-4 break-all">
        <SubmissionContext {...submission} />
        {renderResultsSection({
          mode,
          sparqlError,
          sparqlVars,
          sparqlBindings,
          sparqlCompleted,
          shaclError,
          shaclResult,
        })}
      </section>
    </div>
  )
}
