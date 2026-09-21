import { useState, useEffect, type MouseEvent } from 'react'
import { z } from 'zod'
import {
  Compass,
  Play,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Terminal,
  Clock,
  Plus,
  Minus,
  Settings2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { fetchValidated, looseArray } from '@/lib/api-validation'

interface GoalIteration {
  iteration: number
  action: string
  result: string
  validation_output: string
  is_complete: boolean
  duration_ms: number
  tool_calls: number
  timestamp: number
}

interface GoalRun {
  goal_id: string
  session_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  iterations: GoalIteration[]
  total_iterations: number
  total_duration_ms: number
  total_tool_calls: number
  summary: string
  error?: string
}

// D-WUI-12: /api/enhanced/goals and /api/enhanced/goals/{id}/iterations can
// legitimately answer null, {}, or an error envelope (cold cache, unknown
// goal id, non-2xx body) instead of the shape below. Validate at the fetch
// boundary so a hostile/degraded response is rejected loudly here instead of
// crashing `goals.length`/`goals.map` or `data.iterations.length` downstream.
const goalIterationSchema: z.ZodType<GoalIteration> = z.object({
  iteration: z.number().int().nonnegative(),
  action: z.string(),
  result: z.string(),
  validation_output: z.string(),
  is_complete: z.boolean(),
  duration_ms: z.number().int().nonnegative(),
  tool_calls: z.number().int().nonnegative(),
  timestamp: z.number(),
})

const goalRunSchema: z.ZodType<GoalRun> = z.object({
  goal_id: z.string(),
  session_id: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  iterations: looseArray(goalIterationSchema),
  total_iterations: z.number().int().nonnegative(),
  total_duration_ms: z.number().int().nonnegative(),
  total_tool_calls: z.number().int().nonnegative(),
  summary: z.string(),
  error: z.string().optional(),
})

const goalLaunchResponseSchema = z.object({
  status: z.string(),
  goal_id: z.string().min(1),
  session_id: z.string().min(1).optional(),
  validation_action: z.string().optional(),
})

const goalCancelResponseSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
})

function requestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function constraintCountLabel(count: number): string {
  return `${count} configured guardrail${count === 1 ? '' : 's'}`
}

function canAddConstraint(constraints: string[], value: string): boolean {
  return constraints.length < 50 && Boolean(value.trim())
}

function renderGoalErrorNotice(error: string | null, onRetry: () => void) {
  if (!error) return null
  return (
    <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs" role="alert">
      <p className="font-medium text-destructive">Goal runs could not be refreshed.</p>
      <p className="mt-1 text-muted-foreground">{error}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function startGoalsRequest(
  silent: boolean,
  setLoading: (value: boolean) => void,
  setError: (value: string | null) => void,
): void {
  if (!silent) {
    setLoading(true)
    setError(null)
  }
}

function finishGoalsRequest(silent: boolean, setLoading: (value: boolean) => void): void {
  if (!silent) setLoading(false)
}

function renderConstraintsList({ constraints, onRemove }: { constraints: string[]; onRemove: (i: number) => void }) {
  if (constraints.length === 0) return null
  return (
    <div
      className="p-2 border border-border/20 rounded bg-muted/20 max-h-[120px] overflow-y-auto space-y-1"
      aria-label={constraintCountLabel(constraints.length)}
    >
      {constraints.map((c, i) => (
        <div
          key={i}
          className="flex justify-between items-center text-[10px] bg-background/50 px-2 py-1 rounded border border-border/10"
        >
          <span className="truncate pr-2">{c}</span>
          <button
            type="button"
            aria-label={`Remove constraint: ${c}`}
            onClick={() => {
              onRemove(i)
            }}
            className="text-destructive hover:opacity-80 transition-opacity"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

interface ConfigPanelProps {
  maxIterations: number
  onMaxIterationsChange: (n: number) => void
  validationAction: string
  onValidationActionChange: (v: string) => void
  newConstraint: string
  onNewConstraintChange: (v: string) => void
  onAddConstraint: () => void
  constraints: string[]
  onRemoveConstraint: (i: number) => void
}

function renderConfigPanel({
  maxIterations,
  onMaxIterationsChange,
  validationAction,
  onValidationActionChange,
  newConstraint,
  onNewConstraintChange,
  onAddConstraint,
  constraints,
  onRemoveConstraint,
}: ConfigPanelProps) {
  return (
    <div className="space-y-4 pt-2 border-t border-border/20 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <span id="goal-iteration-limit-label" className="text-[11px] font-semibold text-muted-foreground uppercase">
            Maximum steps
          </span>
          <div
            className="flex items-center border border-border/40 rounded-md bg-muted/10 h-9"
            role="group"
            aria-labelledby="goal-iteration-limit-label"
            aria-describedby="goal-iteration-limit-help"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-full px-2"
              aria-label="Decrease iteration limit"
              disabled={maxIterations <= 1}
              onClick={() => {
                onMaxIterationsChange(Math.max(1, maxIterations - 5))
              }}
            >
              <Minus className="size-3" aria-hidden="true" />
            </Button>
            <span
              className="flex-1 text-center text-xs font-mono"
              role="status"
              aria-live="polite"
              aria-label={`${maxIterations} maximum steps`}
            >
              {maxIterations}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-full px-2"
              aria-label="Increase iteration limit"
              disabled={maxIterations >= 100}
              onClick={() => {
                onMaxIterationsChange(Math.min(100, maxIterations + 5))
              }}
            >
              <Plus className="size-3" aria-hidden="true" />
            </Button>
          </div>
          <p id="goal-iteration-limit-help" className="text-[10px] text-muted-foreground">
            The loop stops after this many steps (1–100).
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="goal-validation-action"
            className="text-[11px] font-semibold text-muted-foreground uppercase"
          >
            Validation Action
          </label>
          <select
            id="goal-validation-action"
            value={validationAction}
            onChange={(e) => {
              onValidationActionChange(e.target.value)
            }}
            aria-describedby="goal-validation-action-help"
            className="w-full rounded-md border px-2 text-xs bg-muted/20 border-border/40 font-mono h-9"
          >
            <option value="none">No extra check</option>
            <option value="workspace-present">Confirm workspace</option>
            <option value="repository-present">Confirm repository</option>
          </select>
          <p id="goal-validation-action-help" className="text-[10px] text-muted-foreground">
            A safe, built-in check used to verify completion.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="goal-new-constraint"
          className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
        >
          Guardrail rules
        </label>
        <div className="flex gap-2">
          <Input
            id="goal-new-constraint"
            placeholder="Add a rule, such as ‘keep changes reversible’"
            value={newConstraint}
            maxLength={1024}
            aria-describedby="goal-constraints-help"
            onChange={(e) => {
              onNewConstraintChange(e.target.value)
            }}
            className="text-xs bg-muted/20 border-border/40 h-8"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onAddConstraint()
              }
            }}
          />
          <Button
            type="button"
            onClick={onAddConstraint}
            disabled={!canAddConstraint(constraints, newConstraint)}
            aria-label="Add guardrail rule"
            className="h-8 px-3 shadow-none border"
          >
            Add
          </Button>
        </div>

        <p id="goal-constraints-help" className="text-[10px] text-muted-foreground">
          Optional instructions for the agent. Add up to 50 rules; each can be 1,024 characters.
        </p>

        {renderConstraintsList({ constraints, onRemove: onRemoveConstraint })}
      </div>
    </div>
  )
}

function goalListItemTitle(g: GoalRun): string {
  return (
    g.iterations[0]?.action
      ?.replace("Analyzing workspace and executing step 1 for objective: '", '')
      ?.replace("'.", '') || 'Objective Execution'
  )
}

function renderGoalListItem({
  g,
  isSelected,
  onSelect,
}: {
  g: GoalRun
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      key={g.goal_id}
      type="button"
      aria-pressed={isSelected}
      onClick={() => {
        onSelect(g.goal_id)
      }}
      className={cn(
        'w-full border-0 bg-transparent p-4 text-left cursor-pointer hover:bg-muted/20 transition-all flex flex-col gap-2',
        isSelected && 'bg-primary/5 hover:bg-primary/10 border-l-2 border-primary',
      )}
    >
      <span className="flex justify-between items-start gap-2">
        <span className="text-xs font-medium line-clamp-1 flex-1 pr-1">{goalListItemTitle(g)}</span>
        <Badge
          className={cn(
            'capitalize text-[9px] border shadow-none px-1.5 py-0.5',
            g.status === 'running' && 'bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse',
            g.status === 'completed' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
            g.status === 'failed' && 'bg-destructive/10 text-destructive border-destructive/20',
            g.status === 'cancelled' && 'bg-muted text-muted-foreground border-border',
          )}
        >
          {g.status}
        </Badge>
      </span>

      <span className="flex items-center gap-3 text-[10px] text-muted-foreground/80 font-mono">
        <span className="flex items-center gap-1">
          <RotateCcw className="size-3" aria-hidden="true" /> Step {g.total_iterations}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="size-3" aria-hidden="true" /> {(g.total_duration_ms / 1000).toFixed(1)}s
        </span>
        <span className="flex items-center gap-1">
          <Terminal className="size-3" aria-hidden="true" /> {g.total_tool_calls} tools
        </span>
      </span>
    </button>
  )
}

function renderGoalsListBody({
  loading,
  goals,
  selectedGoalId,
  onSelect,
  error,
  onRetry,
}: {
  loading: boolean
  goals: GoalRun[]
  selectedGoalId: string | null
  onSelect: (id: string) => void
  error: string | null
  onRetry: () => void
}) {
  const errorNotice = renderGoalErrorNotice(error, onRetry)

  if (loading) {
    return (
      <>
        {errorNotice}
        <div className="p-8 flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          Loading goal runs…
        </div>
      </>
    )
  }
  if (goals.length === 0) {
    return (
      <>
        {errorNotice}
        <div className="p-8 text-center text-xs text-muted-foreground/50">
          No goal runs yet. Describe a task above to create the first one.
        </div>
      </>
    )
  }
  return (
    <>
      {errorNotice}
      {goals.map((g) => renderGoalListItem({ g, isSelected: selectedGoalId === g.goal_id, onSelect }))}
    </>
  )
}

function renderStatusBanner(selectedGoal: GoalRun | null) {
  if (!selectedGoal) return null
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'p-4 rounded-lg border text-xs leading-relaxed flex flex-col gap-1.5',
        selectedGoal.status === 'running' && 'bg-blue-500/5 border-blue-500/20 text-blue-400',
        selectedGoal.status === 'completed' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400',
        selectedGoal.status === 'failed' && 'bg-destructive/5 border-destructive/20 text-destructive',
        selectedGoal.status === 'cancelled' && 'bg-muted/10 border-border/30 text-muted-foreground',
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        {selectedGoal.status === 'completed' && <CheckCircle2 className="size-4" aria-hidden="true" />}
        {selectedGoal.status === 'failed' && <AlertTriangle className="size-4" aria-hidden="true" />}
        {selectedGoal.status === 'running' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        <span className="capitalize">{selectedGoal.status} Execution Banner</span>
      </div>
      <p className="font-mono text-[11px] opacity-80">
        {selectedGoal.summary || 'The agent is working. New steps will appear here as they finish.'}
      </p>
      {renderGoalStatusError(selectedGoal.error)}
    </div>
  )
}

function renderGoalStatusError(error: string | undefined) {
  return error ? <p className="text-destructive">{error}</p> : null
}

function renderTimelineStepBody(step: GoalIteration, detailsId: string, expanded: boolean) {
  return (
    <div
      id={detailsId}
      hidden={!expanded}
      className="mt-3 pl-2 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200"
    >
      <div className="text-xs text-[#d1d5db] bg-muted/15 border border-border/10 rounded-lg p-3 leading-relaxed">
        <span className="font-semibold text-primary/80 font-mono block text-[10px] uppercase tracking-wider mb-1">
          Observation
        </span>
        {step.result}
      </div>

      {step.validation_output && (
        <div className="rounded-lg overflow-hidden border border-border/10 bg-black font-mono">
          <div className="bg-muted/10 border-b border-border/10 px-3 py-1.5 flex items-center gap-2 justify-between text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Terminal className="size-3" aria-hidden="true" /> Validation output
            </span>
            <span aria-hidden="true">Output</span>
          </div>
          <pre
            className="p-3 text-[10px] leading-relaxed text-[#10b981] overflow-x-auto whitespace-pre"
            aria-label="Validation output"
          >
            {step.validation_output}
          </pre>
        </div>
      )}
    </div>
  )
}

function renderTimelineStep({
  step,
  expanded,
  onToggle,
}: {
  step: GoalIteration
  expanded: boolean
  onToggle: (iteration: number) => void
}) {
  const detailsId = `goal-step-${step.iteration}-details`
  return (
    <div key={step.iteration} className="relative pl-6">
      <span
        className={cn(
          'absolute -left-[9px] top-1.5 size-4 rounded-full border-2 flex items-center justify-center bg-[#030712]',
          step.is_complete ? 'border-emerald-500 text-emerald-500' : 'border-primary/60 text-primary/60',
        )}
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      </span>

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => {
          onToggle(step.iteration)
        }}
        className="flex w-full items-center justify-between gap-4 cursor-pointer border-0 bg-transparent p-2 text-left transition-all hover:bg-muted/5"
      >
        <span className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold text-muted-foreground/60">Step {step.iteration}</span>
          <span className="text-xs text-[#f3f4f6] font-medium line-clamp-1">{step.action}</span>
        </span>

        <span className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground/60 shrink-0">
          <span>{step.duration_ms}ms</span>
          {expanded ? (
            <ChevronUp className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          )}
        </span>
      </button>

      {renderTimelineStepBody(step, detailsId, expanded)}
    </div>
  )
}

function renderGoalTimeline({
  selectedGoal,
  expandedSteps,
  onToggleStep,
}: {
  selectedGoal: GoalRun | null
  expandedSteps: Record<number, boolean | undefined>
  onToggleStep: (iteration: number) => void
}) {
  return (
    <div className="space-y-8">
      {renderStatusBanner(selectedGoal)}
      <div className="relative border-l-2 border-border/20 ml-3 space-y-6">
        {selectedGoal?.iterations.map((step) =>
          renderTimelineStep({ step, expanded: Boolean(expandedSteps[step.iteration]), onToggle: onToggleStep }),
        )}
      </div>
    </div>
  )
}

function renderEmptyGoalPanel() {
  return (
    <Card className="border-border/40 bg-muted/5 border-dashed min-h-[600px] flex items-center justify-center text-center">
      <CardContent className="flex flex-col items-center justify-center p-12">
        <div className="p-4 rounded-full bg-primary/5 text-primary/60 mb-4 border border-primary/10">
          <Compass className="size-8 animate-pulse" aria-hidden="true" />
        </div>
        <h3 className="font-semibold text-lg">Goal Execution Panel</h3>
        <p className="text-muted-foreground text-sm max-w-sm mt-1">
          Choose a goal run on the left to follow its steps, or launch a new task above. Progress and checks will
          appear here as the agent works.
        </p>
      </CardContent>
    </Card>
  )
}

function renderGoalTimelineContent({
  selectedGoal,
  expandedSteps,
  onToggleStep,
  iterationsLoading,
  iterationsError,
  onRetryIterations,
}: {
  selectedGoal: GoalRun | null
  expandedSteps: Record<number, boolean | undefined>
  onToggleStep: (iteration: number) => void
  iterationsLoading: boolean
  iterationsError: string | null
  onRetryIterations: () => void
}) {
  if (iterationsLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading goal steps…
      </div>
    )
  }
  if (iterationsError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
        <p className="font-medium text-destructive">Goal steps could not be loaded.</p>
        <p className="mt-1 text-muted-foreground">{iterationsError}</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetryIterations}>
          Try again
        </Button>
      </div>
    )
  }
  return renderGoalTimeline({ selectedGoal, expandedSteps, onToggleStep })
}

function renderGoalTimelinePanel({
  selectedGoalId,
  selectedGoal,
  expandedSteps,
  onToggleStep,
  onCancel,
  iterationsLoading,
  iterationsError,
  onRetryIterations,
}: {
  selectedGoalId: string | null
  selectedGoal: GoalRun | null
  expandedSteps: Record<number, boolean | undefined>
  onToggleStep: (iteration: number) => void
  onCancel: (goalId: string, e: MouseEvent) => void
  iterationsLoading: boolean
  iterationsError: string | null
  onRetryIterations: () => void
}) {
  if (!selectedGoalId) return renderEmptyGoalPanel()
  return (
    <Card className="border-border/40 backdrop-blur-md bg-card/65 shadow-lg min-h-[600px] flex flex-col h-full">
      <CardHeader className="border-b border-border/20 flex flex-row items-center justify-between gap-4 py-4 shrink-0">
        <div>
          <CardTitle className="text-sm font-semibold flex items-center gap-2 font-mono text-primary">
            <Terminal className="size-4" aria-hidden="true" />
            <span>Goal: {selectedGoalId.slice(0, 8)}...</span>
          </CardTitle>
          <CardDescription className="text-xs font-mono mt-0.5">
            Session Link: {selectedGoal?.session_id ?? 'none'}
          </CardDescription>
        </div>

        {selectedGoal?.status === 'running' && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={(e) => {
              onCancel(selectedGoalId, e)
            }}
            className="h-8 gap-1.5"
            aria-label={`Cancel goal ${selectedGoalId}`}
          >
            <XCircle className="size-4" aria-hidden="true" />
            <span>Cancel Goal</span>
          </Button>
        )}
      </CardHeader>

      <ScrollArea className="flex-1 p-6 bg-[#030712]">
        {renderGoalTimelineContent({
          selectedGoal,
          expandedSteps,
          onToggleStep,
          iterationsLoading,
          iterationsError,
          onRetryIterations,
        })}
      </ScrollArea>
    </Card>
  )
}

export default function GoalsView() {
  const [goals, setGoals] = useState<GoalRun[]>([])
  const [loading, setLoading] = useState(true)
  const [goalsError, setGoalsError] = useState<string | null>(null)
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)
  const [selectedGoal, setSelectedGoal] = useState<GoalRun | null>(null)
  const [iterationsLoading, setIterationsLoading] = useState(false)
  const [iterationsError, setIterationsError] = useState<string | null>(null)

  // Builder form state
  const [objective, setObjective] = useState('')
  const [validationAction, setValidationAction] = useState('none')
  const [maxIterations, setMaxIterations] = useState(20)
  const [newConstraint, setNewConstraint] = useState('')
  const [constraints, setConstraints] = useState<string[]>([
    'Do not remove comments or documentation strings',
    'Run unit tests to verify changes before completing',
  ])
  const [showConfig, setShowConfig] = useState(false)
  const [launching, setLaunching] = useState(false)

  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean | undefined>>({})

  useEffect(() => {
    void fetchGoals()
    const interval = setInterval(() => {
      void fetchGoals(true)
    }, 4000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (selectedGoalId) {
      setSelectedGoal(null)
      setIterationsError(null)
      void fetchGoalIterations(selectedGoalId)
      const interval = setInterval(() => {
        void fetchGoalIterations(selectedGoalId, true)
      }, 2000)
      return () => {
        clearInterval(interval)
      }
    }
    setSelectedGoal(null)
    setIterationsLoading(false)
    setIterationsError(null)
  }, [selectedGoalId])

  const fetchGoals = async (silent = false) => {
    try {
      startGoalsRequest(silent, setLoading, setGoalsError)
      const data = await fetchValidated('/api/enhanced/goals', looseArray(goalRunSchema))
      setGoals(data)
      setGoalsError(null)
    } catch (error: unknown) {
      const message = requestErrorMessage(error, 'The goal registry returned an invalid response.')
      setGoalsError(message)
      if (!silent) toast.error('Failed to query goals registry', { description: message })
    } finally {
      finishGoalsRequest(silent, setLoading)
    }
  }

  const fetchGoalIterations = async (goalId: string, silent = false) => {
    try {
      startGoalsRequest(silent, setIterationsLoading, setIterationsError)
      const data = await fetchValidated(`/api/enhanced/goals/${goalId}/iterations`, goalRunSchema)
      setSelectedGoal(data)
      setIterationsError(null)
      // Auto-expand new iterations
      if (data.iterations.length > 0) {
        const lastIdx = data.iterations.length
        setExpandedSteps((prev) => ({
          ...prev,
          [lastIdx]: prev[lastIdx] !== false, // default true for last
        }))
      }
    } catch (error: unknown) {
      const message = requestErrorMessage(error, 'The goal timeline returned an invalid response.')
      setIterationsError(message)
      if (!silent) toast.error('Failed to pull goal timeline steps', { description: message })
    } finally {
      finishGoalsRequest(silent, setIterationsLoading)
    }
  }

  const handleLaunchGoal = async () => {
    if (!objective.trim()) {
      toast.error('Goal objective target description is required')
      return
    }

    try {
      setLaunching(true)
      const data = await fetchValidated('/api/enhanced/goals', goalLaunchResponseSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          validation_action: validationAction,
          max_iterations: maxIterations,
          constraints,
        }),
      })
      toast.success('Autonomous goal loop successfully dispatched')
      setObjective('')
      setValidationAction('none')
      setSelectedGoalId(data.goal_id)
      void fetchGoals()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Network failure during goal dispatch.'
      toast.error('Failed to dispatch autonomous goal execution', { description: message })
    } finally {
      setLaunching(false)
    }
  }

  const handleCancelGoal = async (goalId: string, e: MouseEvent) => {
    e.stopPropagation()
    try {
      await fetchValidated(`/api/enhanced/goals/${goalId}/cancel`, goalCancelResponseSchema, { method: 'POST' })
      toast.success('Autonomous execution loop interrupted successfully')
      void fetchGoals()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Network error during cancel request.'
      toast.error('Failed to interrupt goal execution', { description: message })
    }
  }

  const handleAddConstraint = () => {
    if (newConstraint.trim()) {
      setConstraints([...constraints, newConstraint.trim()])
      setNewConstraint('')
    }
  }

  const handleRemoveConstraint = (index: number) => {
    setConstraints(constraints.filter((_, i) => i !== index))
  }

  const toggleStepExpand = (stepNum: number) => {
    setExpandedSteps((prev) => ({
      ...prev,
      [stepNum]: !prev[stepNum],
    }))
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
      <div className="xl:col-span-12">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Compass className="size-6 text-primary" aria-hidden="true" />
          Goals
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Describe a task, choose an optional completion check, and follow the agent&apos;s bounded work one step at a
          time. You can stop a running goal whenever you need to.
        </p>
      </div>

      {/* Sidebar Control Deck (Builder & Goals List) */}
      <div className="xl:col-span-5 space-y-6">
        {/* Goal Builder Form */}
        <Card className="border-border/40 backdrop-blur-md bg-card/65 relative overflow-hidden shadow-md">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary/60 via-purple-500/60 to-pink-500/60" />
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Compass className="size-5 text-primary" aria-hidden="true" />
              <span>Autonomous Goal Builder</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Write the outcome you want, then let a bounded background run work toward it and report each step.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="goal-objective"
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                What should the agent accomplish?
              </label>
              <Textarea
                id="goal-objective"
                placeholder="Describe the outcome (for example: Fix the sidebar alignment and verify it with tests.)"
                value={objective}
                required
                aria-required="true"
                maxLength={8192}
                aria-describedby="goal-objective-help"
                onChange={(e) => {
                  setObjective(e.target.value)
                }}
                className="min-h-[90px] text-xs bg-muted/20 border-border/40"
              />
              <p id="goal-objective-help" className="text-[10px] text-muted-foreground">
                Required. Be specific about the result; the agent can run for up to 100 steps.
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showConfig}
              aria-controls="goal-config-panel"
              aria-label="Toggle advanced goal options"
              onClick={() => {
                setShowConfig(!showConfig)
              }}
              className="w-full justify-between px-2 text-xs border border-border/20 hover:bg-muted/40 h-8"
            >
              <span className="flex items-center gap-1 text-muted-foreground font-mono">
                <Settings2 className="size-3.5" aria-hidden="true" /> Advanced options: limits and checks
              </span>
              {showConfig ? (
                <ChevronUp className="size-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4" aria-hidden="true" />
              )}
            </Button>

            <div id="goal-config-panel" hidden={!showConfig}>
              {renderConfigPanel({
                maxIterations,
                onMaxIterationsChange: setMaxIterations,
                validationAction,
                onValidationActionChange: setValidationAction,
                newConstraint,
                onNewConstraintChange: setNewConstraint,
                onAddConstraint: handleAddConstraint,
                constraints,
                onRemoveConstraint: handleRemoveConstraint,
              })}
            </div>
          </CardContent>

          <CardFooter className="bg-muted/5 border-t border-border/20 pt-4 flex justify-end">
            <Button
              type="button"
              onClick={() => {
                void handleLaunchGoal()
              }}
              disabled={launching || !objective.trim()}
              aria-busy={launching}
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 px-4 shadow-sm"
            >
              {launching ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4 fill-current" aria-hidden="true" />
              )}
              <span>{launching ? 'Launching…' : 'Launch goal'}</span>
            </Button>
          </CardFooter>
        </Card>

        {/* Goals List Registry */}
        <Card className="border-border/40 bg-card/45 shadow-sm">
          <CardHeader className="pb-3 border-b border-border/20">
            <CardTitle className="text-sm font-semibold">Goal runs</CardTitle>
            <CardDescription className="text-xs">Select a run to see its status and steps.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 max-h-[350px] overflow-y-auto divide-y divide-border/20">
            {renderGoalsListBody({
              loading,
              goals,
              selectedGoalId,
              onSelect: setSelectedGoalId,
              error: goalsError,
              onRetry: () => {
                void fetchGoals()
              },
            })}
          </CardContent>
        </Card>
      </div>

      {/* Goal Process Timeline Output */}
      <div className="xl:col-span-7">
        {renderGoalTimelinePanel({
          selectedGoalId,
          selectedGoal,
          expandedSteps,
          onToggleStep: toggleStepExpand,
          iterationsLoading,
          iterationsError,
          onRetryIterations: () => {
            if (selectedGoalId) void fetchGoalIterations(selectedGoalId)
          },
          onCancel: (goalId, e) => {
            void handleCancelGoal(goalId, e)
          },
        })}
      </div>
    </div>
  )
}
