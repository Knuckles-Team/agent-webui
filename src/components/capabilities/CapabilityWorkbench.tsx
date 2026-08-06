import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'

import {
  extractRunId,
  fetchCapabilityCatalog,
  fetchCapabilityDetail,
  fetchRuns,
  invokeCapability,
  preflightCapability,
  type CapabilityAction,
  type CapabilityAvailabilityStatus,
  type CapabilityDescriptor,
  type CapabilityInvocationResult,
  type CapabilityPreflight,
  type RunSummary,
} from '../../lib/capabilities-api'
import { contextualCapabilityScore } from '../../lib/capability-forms'
import { useConversationIdFromUrl } from '../../hooks/useConversationIdFromUrl'
import { usePageContextEnvelope } from '../../lib/page-context'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import { SchemaActionForm } from './SchemaActionForm'
import { ResultRenderer } from './ResultRenderer'
import { RunInspector } from './RunInspector'

type WorkbenchSurface = 'capabilities' | 'run'
type AvailabilityFilter = 'all' | CapabilityAvailabilityStatus

interface PendingApproval {
  approvalId: string
  runId: string
  sessionId: string
}

const CAPABILITY_SESSION_STORAGE_KEY = 'capabilityWorkbenchSessionId'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The capability service is unavailable.'
}

function ignorePromise(promise: Promise<unknown>): void {
  promise.catch(() => undefined)
}

function fallbackCapabilitySession(): string {
  const existing = window.localStorage.getItem(CAPABILITY_SESSION_STORAGE_KEY)
  if (existing) return existing
  // `crypto.randomUUID` only exists in a secure context (HTTPS or localhost); `uuid`'s v4
  // prefers it when available and otherwise falls back to `crypto.getRandomValues` (which
  // works over plain HTTP too), so plain-HTTP deployments never throw here.
  const created = `webui-${uuidv4()}`
  window.localStorage.setItem(CAPABILITY_SESSION_STORAGE_KEY, created)
  return created
}

function pendingApprovalFrom(response: CapabilityInvocationResult): PendingApproval | null {
  if (!response.approval_id || !response.run_id || !response.session_id) return null
  return { approvalId: response.approval_id, runId: response.run_id, sessionId: response.session_id }
}

function proposedPolicyTarget(action: CapabilityAction, inputs: Record<string, unknown>): string | undefined {
  const field = action.policy.target_input
  if (!field) return undefined
  const value = inputs[field]
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function availabilityClass(status: CapabilityAvailabilityStatus): string {
  if (status === 'available') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'degraded') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return 'border-destructive/30 bg-destructive/10 text-destructive'
}

function preferredAction(
  descriptor: CapabilityDescriptor,
  allowedActionIds: Set<string>,
): CapabilityAction | undefined {
  return descriptor.actions.find((action) => allowedActionIds.has(action.id.toLowerCase())) ?? descriptor.actions[0]
}

function CapabilityStatus({ descriptor }: { descriptor: CapabilityDescriptor }) {
  const status = descriptor.availability.status
  const readiness = descriptor.availability.readiness
  const reasons = [...descriptor.availability.reasons, ...descriptor.availability.missing_preconditions]
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs', availabilityClass(status))}>
      <div className="font-medium capitalize">
        {status}
        {readiness === 'cold' ? ' · cold start' : readiness && readiness !== 'warm' ? ` · ${readiness}` : ''}
      </div>
      {readiness === 'cold' && <div className="mt-0.5 opacity-90">Callable now; the engine warms on first use.</div>}
      {reasons.length > 0 && <div className="mt-0.5 opacity-90">{reasons.join(' · ')}</div>}
    </div>
  )
}

interface PreflightReviewProps {
  action: CapabilityAction
  preflight: CapabilityPreflight
  confirmed: boolean
  invoking: boolean
  approvalPending: boolean
  executionError: string | null
  onConfirmedChange: (confirmed: boolean) => void
  onInvoke: () => void
}

function PreflightReview({
  action,
  preflight,
  confirmed,
  invoking,
  approvalPending,
  executionError,
  onConfirmedChange,
  onInvoke,
}: PreflightReviewProps) {
  const mutationUnknown = action.side_effects.mutates === null
  const requiresConfirmation = action.side_effects.mutates !== false || preflight.policy.approval_required
  const canRequestApproval =
    preflight.eligible && preflight.policy.approval_required && preflight.availability.status === 'available'
  const canInvoke =
    (preflight.executable_now || canRequestApproval) && !approvalPending && (!requiresConfirmation || confirmed)

  return (
    <section className="space-y-3 rounded-xl border bg-muted/15 p-4" aria-label="Preflight review">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {preflight.executable_now ? (
            <ShieldCheck className="mt-0.5 size-5 text-emerald-600" />
          ) : canRequestApproval ? (
            <ShieldAlert className="mt-0.5 size-5 text-amber-600" />
          ) : (
            <ShieldAlert className="mt-0.5 size-5 text-destructive" />
          )}
          <div>
            <h3 className="text-sm font-semibold">Preflight preview</h3>
            <p className="text-xs text-muted-foreground">
              Policy is rechecked authoritatively with execution identity when you invoke.
            </p>
          </div>
        </div>
        <Badge variant={preflight.executable_now || canRequestApproval ? 'secondary' : 'destructive'}>
          {preflight.executable_now ? 'Eligible now' : canRequestApproval ? 'Approval needed' : 'Blocked'}
        </Badge>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-md border bg-background p-2">
          <div className="text-muted-foreground">Decision</div>
          <div className="font-semibold capitalize">{preflight.policy.decision.replaceAll('_', ' ')}</div>
        </div>
        <div className="rounded-md border bg-background p-2">
          <div className="text-muted-foreground">Tier</div>
          <div className="font-semibold">{preflight.policy.tier}</div>
        </div>
        <div className="rounded-md border bg-background p-2">
          <div className="text-muted-foreground">Side effects</div>
          <div className="font-semibold">
            {action.side_effects.mutates === true
              ? 'Mutating'
              : mutationUnknown
                ? 'Unknown — treated as mutating'
                : 'Read-only'}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{preflight.policy.reason}</p>

      {preflight.validation_issues.length > 0 && (
        <ul className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {preflight.validation_issues.map((issue) => (
            <li key={`${issue.field}:${issue.message}`}>
              {issue.field}: {issue.message}
            </li>
          ))}
        </ul>
      )}

      {requiresConfirmation && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(checked) => {
              onConfirmedChange(checked === true)
            }}
          />
          <span className="text-xs">
            <span className="block font-medium">
              {preflight.policy.approval_required
                ? 'Confirm submission to the approval policy'
                : 'Confirm this state-changing action'}
            </span>
            <span className="text-muted-foreground">
              I reviewed the target, inputs, and side-effect declaration. Execution may still be denied or queued.
            </span>
          </span>
        </label>
      )}

      {executionError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {executionError}
        </div>
      )}

      <Button type="button" disabled={!canInvoke || invoking} onClick={onInvoke}>
        {invoking ? (
          <>
            <Loader2 className="animate-spin" /> Invoking…
          </>
        ) : (
          <>
            <Play />
            {approvalPending
              ? 'Approval pending'
              : preflight.policy.approval_required
                ? 'Request approval'
                : 'Invoke action'}
          </>
        )}
      </Button>
    </section>
  )
}

export function CapabilityWorkbench() {
  const pageContext = usePageContextEnvelope()
  const [conversationId] = useConversationIdFromUrl()
  const [fallbackSessionId] = useState(fallbackCapabilitySession)
  const capabilitySessionId = conversationId === '/' ? fallbackSessionId : conversationId.replace(/^\/+/, '')
  const currentSelection = pageContext.selection.at(0)
  const executionContextKey = JSON.stringify({
    route: pageContext.route,
    selection: pageContext.selection,
    filters: pageContext.filters,
    timeRange: pageContext.timeRange,
  })
  const [surface, setSurface] = useState<WorkbenchSurface>('capabilities')
  const [query, setQuery] = useState('')
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [preflight, setPreflight] = useState<CapabilityPreflight | null>(null)
  const [proposedInputs, setProposedInputs] = useState<Record<string, unknown> | null>(null)
  const [proposedTarget, setProposedTarget] = useState<string | undefined>(undefined)
  const [preflightBusy, setPreflightBusy] = useState(false)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [invoking, setInvoking] = useState(false)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(undefined)
  const [hasResult, setHasResult] = useState(false)
  const [resultRunId, setResultRunId] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [acceptedInvocation, setAcceptedInvocation] = useState<CapabilityInvocationResult | null>(null)
  const [runDraft, setRunDraft] = useState('')
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<'all' | NonNullable<RunSummary['status']>>('all')
  const executionGeneration = useRef(0)

  const catalogQuery = useQuery({
    queryKey: ['capability-catalog'],
    queryFn: ({ signal }) => fetchCapabilityCatalog(signal),
    staleTime: 30_000,
    retry: 1,
  })
  const detailQuery = useQuery({
    queryKey: ['capability-detail', selectedId],
    queryFn: ({ signal }) => fetchCapabilityDetail(selectedId!, signal),
    enabled: Boolean(selectedId),
    staleTime: 30_000,
    retry: 1,
  })
  const runsQuery = useQuery({
    queryKey: ['canonical-runs', runStatus],
    queryFn: ({ signal }) => fetchRuns({ status: runStatus === 'all' ? undefined : runStatus, limit: 50, signal }),
    enabled: surface === 'run',
    staleTime: 5_000,
    retry: 1,
  })

  const allowedActionIds = useMemo(
    () => new Set(pageContext.allowedActions.map((action) => action.id.toLowerCase())),
    [pageContext.allowedActions],
  )
  const descriptor = detailQuery.data

  useEffect(() => {
    if (!descriptor) return
    const currentIsValid = descriptor.actions.some((action) => action.id === selectedActionId)
    if (!currentIsValid) setSelectedActionId(preferredAction(descriptor, allowedActionIds)?.id ?? null)
  }, [allowedActionIds, descriptor, selectedActionId])

  const action = descriptor?.actions.find((candidate) => candidate.id === selectedActionId)
  const governedInvokeRoute = descriptor
    ? (descriptor.execution.governed_invoke_route ?? `/api/capabilities/${encodeURIComponent(descriptor.id)}/invoke`)
    : null
  const legacyRestRoute = action?.typed_io.legacy_rest_route ?? action?.typed_io.rest_route
  const legacyRequestEncoding = action?.typed_io.legacy_request_encoding ?? action?.typed_io.request_encoding

  const resetExecution = useCallback(() => {
    executionGeneration.current += 1
    setPreflightBusy(false)
    setInvoking(false)
    setPreflight(null)
    setProposedInputs(null)
    setProposedTarget(undefined)
    setPreflightError(null)
    setConfirmed(false)
    setExecutionError(null)
    setResult(undefined)
    setHasResult(false)
    setResultRunId(null)
    setPendingApproval(null)
    setAcceptedInvocation(null)
  }, [])

  useEffect(() => {
    resetExecution()
  }, [executionContextKey, resetExecution])

  const chooseCapability = (capability: CapabilityDescriptor) => {
    setSelectedId(capability.id)
    setSelectedActionId(preferredAction(capability, allowedActionIds)?.id ?? null)
    resetExecution()
  }

  const chooseAction = (actionId: string) => {
    setSelectedActionId(actionId)
    resetExecution()
  }

  const catalog = catalogQuery.data
  const capabilities = Array.isArray(catalog?.capabilities) ? catalog.capabilities : []
  const filteredCapabilities = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return capabilities
      .map((capability) => ({ capability, score: contextualCapabilityScore(capability, pageContext) }))
      .filter(({ capability }) => {
        if (availabilityFilter !== 'all' && capability.availability.status !== availabilityFilter) return false
        if (!needle) return true
        const text = [
          capability.id,
          capability.title,
          capability.one_line,
          ...capability.typed_io.tags,
          ...capability.actions.map((item) => item.id),
          ...(capability.intent_verbs ?? []),
        ]
          .join(' ')
          .toLowerCase()
        return text.includes(needle)
      })
      .sort((left, right) => right.score - left.score || left.capability.title.localeCompare(right.capability.title))
  }, [availabilityFilter, capabilities, pageContext, query])

  const submitPreflight = async (inputs: Record<string, unknown>) => {
    if (!descriptor || !action) return
    const target = proposedPolicyTarget(action, inputs)
    resetExecution()
    const generation = executionGeneration.current
    setPreflightBusy(true)
    setProposedInputs(inputs)
    setProposedTarget(target)
    try {
      const preview = await preflightCapability(descriptor.id, {
        action: action.id,
        inputs,
        target,
      })
      if (generation === executionGeneration.current) setPreflight(preview)
    } catch (nextError) {
      if (generation === executionGeneration.current) setPreflightError(errorMessage(nextError))
    } finally {
      if (generation === executionGeneration.current) setPreflightBusy(false)
    }
  }

  const invoke = async (approval?: PendingApproval) => {
    if (!descriptor || !action || !proposedInputs) return
    const generation = executionGeneration.current
    setInvoking(true)
    setExecutionError(null)
    try {
      const response = await invokeCapability(descriptor.id, {
        action: action.id,
        inputs: proposedInputs,
        target: proposedTarget,
        session_id: approval?.sessionId ?? capabilitySessionId,
        approval_id: approval?.approvalId,
        run_id: approval?.runId,
      })
      if (generation !== executionGeneration.current) return
      setResult(response)
      setHasResult(response.result !== undefined)
      setResultRunId(extractRunId(response))
      if (response.status === 'approval_required') {
        setAcceptedInvocation(null)
        const nextPending = pendingApprovalFrom(response)
        if (nextPending) setPendingApproval(nextPending)
        else setExecutionError('The approval response did not bind both a run and approval ID.')
      } else {
        setPendingApproval(null)
        if (response.status === 'running' && (!response.run_id || !response.session_id)) {
          setAcceptedInvocation(null)
          setExecutionError('The running response did not include its bound run and session IDs.')
        } else {
          setAcceptedInvocation(response.status === 'running' ? response : null)
        }
      }
    } catch (nextError) {
      if (generation === executionGeneration.current) setExecutionError(errorMessage(nextError))
    } finally {
      if (generation === executionGeneration.current) setInvoking(false)
    }
  }

  const inspectRun = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const runId = runDraft.trim()
    if (runId) setInspectedRunId(runId)
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col gap-0 overflow-hidden rounded-xl border bg-card">
      <div className="shrink-0 border-b px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
              <Sparkles className="size-5 text-primary" /> Unified Agent View
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Discover live actions, review policy, invoke through the governed gateway, and inspect run events.
            </p>
          </div>
          <div className="flex rounded-lg bg-muted p-1">
            <button
              type="button"
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium',
                surface === 'capabilities' && 'bg-background shadow-sm',
              )}
              onClick={() => {
                setSurface('capabilities')
              }}
            >
              <Wrench className="mr-1 inline size-3.5" /> Capabilities
            </button>
            <button
              type="button"
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium',
                surface === 'run' && 'bg-background shadow-sm',
              )}
              onClick={() => {
                setSurface('run')
              }}
            >
              <Activity className="mr-1 inline size-3.5" /> Runs
            </button>
          </div>
        </div>
      </div>

      {surface === 'run' ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-3xl space-y-5 p-5">
            <div>
              <h2 className="text-base font-semibold">Replay or follow a run</h2>
              <p className="text-sm text-muted-foreground">
                Enter a canonical run ID. Missing event infrastructure is reported as unavailable.
              </p>
            </div>
            <form className="flex gap-2" onSubmit={inspectRun}>
              <Input
                value={runDraft}
                onChange={(event) => {
                  setRunDraft(event.target.value)
                }}
                placeholder="run_…"
                aria-label="Run ID"
              />
              <Button type="submit" disabled={!runDraft.trim()}>
                Inspect
              </Button>
            </form>
            {inspectedRunId && <RunInspector key={inspectedRunId} runId={inspectedRunId} />}
            <section className="space-y-3" aria-label="Recent runs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Recent runs</h3>
                  <p className="text-xs text-muted-foreground">
                    Newest-first lifecycle summaries from the canonical event store.
                  </p>
                </div>
                <select
                  aria-label="Run status filter"
                  value={runStatus}
                  className="border-input bg-background h-8 rounded-md border px-2 text-xs shadow-xs"
                  onChange={(event) => {
                    setRunStatus(event.target.value as typeof runStatus)
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="running">Running</option>
                  <option value="waiting_for_input">Waiting for input</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              {runsQuery.isPending ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Loading recent runs…</div>
              ) : runsQuery.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  Run discovery unavailable: {errorMessage(runsQuery.error)}
                </div>
              ) : !runsQuery.data.runs.length ? (
                <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                  No runs match this status.
                </div>
              ) : (
                <div className="space-y-2">
                  {runsQuery.data.runs.map((run) => (
                    <button
                      key={run.run_id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:border-primary/40 hover:bg-accent/30"
                      onClick={() => {
                        setRunDraft(run.run_id)
                        setInspectedRunId(run.run_id)
                      }}
                    >
                      <div className="min-w-0">
                        <code className="block truncate text-xs font-medium">{run.run_id}</code>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {run.event_count} events · {run.last_event_type ?? 'no last event'}
                          {run.session_id ? ` · session ${run.session_id}` : ''}
                        </div>
                      </div>
                      <Badge variant="outline">{run.status?.replaceAll('_', ' ') ?? 'unknown'}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </ScrollArea>
      ) : selectedId ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-3xl space-y-5 p-5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => {
                setSelectedId(null)
                resetExecution()
              }}
            >
              <ArrowLeft /> Back to catalog
            </Button>

            {detailQuery.isPending ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" /> Loading live descriptor…
              </div>
            ) : detailQuery.error || !descriptor ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                <div className="font-semibold">Capability detail unavailable</div>
                <div className="mt-1 text-xs">{errorMessage(detailQuery.error)}</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    ignorePromise(detailQuery.refetch())
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{descriptor.title}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{descriptor.one_line}</p>
                      <code className="mt-1 block text-xs text-muted-foreground">{descriptor.id}</code>
                    </div>
                    <Badge variant="outline">{descriptor.render.renderer}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {descriptor.typed_io.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <CapabilityStatus descriptor={descriptor} />
                </div>

                {descriptor.actions.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    The live descriptor exposes no invocable actions.
                  </div>
                ) : action ? (
                  <div className="space-y-5">
                    {descriptor.actions.length > 1 && (
                      <div className="space-y-1.5">
                        <label htmlFor="capability-action" className="text-sm font-medium">
                          Action
                        </label>
                        <select
                          id="capability-action"
                          value={action.id}
                          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs"
                          onChange={(event) => {
                            chooseAction(event.target.value)
                          }}
                        >
                          {descriptor.actions.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.id}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{action.id}</Badge>
                      <Badge className="bg-sky-600">Governed invoke</Badge>
                      <code>{governedInvokeRoute}</code>
                      {action.side_effects.mutates !== false && (
                        <Badge className="bg-amber-600">Confirmation required</Badge>
                      )}
                    </div>

                    {legacyRestRoute && (
                      <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        <summary className="cursor-pointer font-medium">
                          Legacy transport metadata · display only
                        </summary>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <code>{legacyRestRoute}</code>
                          {legacyRequestEncoding && (
                            <Badge variant="outline">{legacyRequestEncoding.replaceAll('_', ' ')}</Badge>
                          )}
                          <span>Direct frontend execution is disabled.</span>
                        </div>
                      </details>
                    )}

                    <SchemaActionForm
                      key={`${descriptor.id}:${action.id}`}
                      schema={action.input_schema}
                      context={pageContext}
                      busy={preflightBusy}
                      onDirty={resetExecution}
                      onSubmit={(inputs) => {
                        ignorePromise(submitPreflight(inputs))
                      }}
                    />

                    {preflightError && (
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <div className="font-medium">Preflight unavailable</div>
                          <div className="text-xs">{preflightError}</div>
                        </div>
                      </div>
                    )}

                    {preflight && (
                      <PreflightReview
                        action={action}
                        preflight={preflight}
                        confirmed={confirmed}
                        invoking={invoking}
                        approvalPending={Boolean(pendingApproval)}
                        executionError={executionError}
                        onConfirmedChange={setConfirmed}
                        onInvoke={() => {
                          ignorePromise(invoke())
                        }}
                      />
                    )}

                    {pendingApproval && (
                      <section
                        className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
                        aria-label="Pending capability approval"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold">Approval required</h3>
                            <p className="text-xs text-muted-foreground">
                              Grant this request in an authorized approval surface, then resume this exact invocation.
                            </p>
                          </div>
                          <Badge className="bg-amber-600">Waiting for input</Badge>
                        </div>
                        <div className="grid gap-2 text-xs sm:grid-cols-3">
                          <div className="rounded-md border bg-background p-2">
                            <div className="text-muted-foreground">Approval</div>
                            <code className="block truncate" title={pendingApproval.approvalId}>
                              {pendingApproval.approvalId}
                            </code>
                          </div>
                          <div className="rounded-md border bg-background p-2">
                            <div className="text-muted-foreground">Run</div>
                            <code className="block truncate" title={pendingApproval.runId}>
                              {pendingApproval.runId}
                            </code>
                          </div>
                          <div className="rounded-md border bg-background p-2">
                            <div className="text-muted-foreground">Session</div>
                            <code className="block truncate" title={pendingApproval.sessionId}>
                              {pendingApproval.sessionId}
                            </code>
                          </div>
                        </div>
                        <Button
                          type="button"
                          disabled={invoking}
                          onClick={() => {
                            ignorePromise(invoke(pendingApproval))
                          }}
                        >
                          {invoking ? <Loader2 className="animate-spin" /> : <Play />}
                          Resume approved action
                        </Button>
                      </section>
                    )}

                    {acceptedInvocation && (
                      <section className="space-y-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold">Execution accepted</h3>
                            <p className="text-xs text-muted-foreground">
                              The governed run is executing asynchronously. Live results appear in its timeline.
                            </p>
                          </div>
                          <Badge className="bg-sky-600">Accepted</Badge>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>
                            Run: <code>{acceptedInvocation.run_id}</code>
                          </span>
                          <span>
                            Session: <code>{acceptedInvocation.session_id}</code>
                          </span>
                        </div>
                      </section>
                    )}

                    {hasResult && (
                      <section className="space-y-3" aria-label="Capability result">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="size-5 text-emerald-600" />
                          <h3 className="font-semibold">Result</h3>
                        </div>
                        <ResultRenderer value={result} hint={descriptor.render.renderer} />
                      </section>
                    )}

                    {resultRunId && (
                      <RunInspector
                        key={resultRunId}
                        runId={resultRunId}
                        autoFollow
                        renderHint={descriptor.render.renderer}
                      />
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </ScrollArea>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-3 border-b p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  autoFocus
                  className="pl-9"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                  }}
                  placeholder="Search capabilities, actions, intents, and tags…"
                />
              </div>
              <select
                value={availabilityFilter}
                aria-label="Availability filter"
                className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
                onChange={(event) => {
                  setAvailabilityFilter(event.target.value as AvailabilityFilter)
                }}
              >
                <option value="all">All availability</option>
                <option value="available">Available</option>
                <option value="degraded">Degraded</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Context: <strong className="text-foreground">{pageContext.view}</strong>
                {currentSelection ? ` · ${currentSelection.label ?? currentSelection.id}` : ''}
              </span>
              {catalog && (
                <span>
                  {catalog.action_count} actions · catalog {catalog.catalog_version}
                </span>
              )}
            </div>
            {catalog?.runtime.status === 'initializing' && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2 text-xs text-sky-700 dark:text-sky-300">
                Runtime is cold but callable; the engine initializes on the first action.
              </div>
            )}
            {catalog?.runtime.status === 'degraded' && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                Runtime degraded
                {catalog.runtime.reason ? `: ${catalog.runtime.reason}` : ''}
              </div>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-4">
              {catalogQuery.isPending ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="animate-spin" /> Loading live catalog…
                </div>
              ) : catalogQuery.error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
                  <div className="font-semibold">Capability catalog unavailable</div>
                  <div className="mt-1 text-xs">{errorMessage(catalogQuery.error)}</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      ignorePromise(catalogQuery.refetch())
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : filteredCapabilities.length === 0 ? (
                <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
                  No live capabilities match this search and availability filter.
                </div>
              ) : (
                filteredCapabilities.map(({ capability, score }) => (
                  <button
                    key={capability.id}
                    type="button"
                    className="group w-full rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      chooseCapability(capability)
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{capability.title}</span>
                          {score > 0 && (
                            <Badge variant="secondary">
                              <Sparkles /> Contextual
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{capability.one_line}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {capability.actions.slice(0, 5).map((item) => (
                            <Badge key={item.id} variant="outline">
                              {item.id}
                            </Badge>
                          ))}
                          {capability.actions.length > 5 && (
                            <Badge variant="outline">+{capability.actions.length - 5}</Badge>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className={availabilityClass(capability.availability.status)}>
                        {capability.availability.status}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
