import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  NetworkIcon,
  RouteIcon,
  BotIcon,
  WrenchIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  XCircleIcon,
  TimerIcon,
  ZapIcon,
  ShieldCheckIcon,
  SearchIcon,
  BrainCircuitIcon,
  ArrowRightIcon,
  PackageIcon,
} from 'lucide-react'
import React, { memo, useEffect, useState } from 'react'

export interface GraphEvent {
  type: 'graph-event'
  event: string
  domain?: string
  agent?: string
  expert?: string
  server?: string
  confidence?: number
  reasoning?: string
  tool?: string
  tool_name?: string
  args?: unknown
  result?: string
  content?: string
  thought?: string
  success?: boolean
  duration_ms?: number
  region_count?: number
  timestamp?: number
  score?: number
  feedback?: string
  attempt?: number
  count?: number
  tools?: string[]
  expected_tools?: string[]
  plan?: { steps?: { node_id: string }[] }
  is_valid?: boolean
  run_id?: string
  query?: string
  status?: string
  message?: string
  [key: string]: unknown
}

interface GraphActivityProps {
  events: GraphEvent[]
  isStreaming: boolean
}

const formatTime = (ts?: number) => {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** The header's status text: either the live "Graph {phase}..." line while streaming,
 * or the settled "N specialists, M tool calls (Ts)" summary. Pure — plain helper, not a
 * component, so pulling it out of `GraphActivity` cannot change reconciliation identity. */
function renderHeaderStatus(
  isStreaming: boolean,
  graphCompleteEvent: GraphEvent | undefined,
  currentPhase: string,
  specialistNames: string[],
  toolCalls: GraphEvent[],
  totalDuration: number,
): React.ReactNode {
  if (isStreaming && !graphCompleteEvent) {
    return (
      <span className="flex items-center gap-2">
        <span className="animate-pulse">Graph {currentPhase}...</span>
        <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
      </span>
    )
  }
  return (
    <span>
      Graph: {specialistNames.length} specialist
      {specialistNames.length !== 1 ? 's' : ''}
      {toolCalls.length > 0 && `, ${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''}`}
      {totalDuration > 0 && <span className="ml-1 opacity-60">({(totalDuration / 1000).toFixed(1)}s)</span>}
    </span>
  )
}

function renderGraphStartRow(ev: GraphEvent | undefined): React.ReactNode {
  if (!ev) return null
  return (
    <TimelineRow icon={<ZapIcon className="size-3" />} time={ev.timestamp} color="text-blue-400">
      Graph started
      {ev.query && (
        <span className="opacity-50 ml-1 truncate max-w-xs inline-block align-bottom">
          &mdash; {ev.query.substring(0, 60)}
        </span>
      )}
    </TimelineRow>
  )
}

function renderRoutingStartedRow(ev: GraphEvent | undefined): React.ReactNode {
  if (!ev) return null
  return (
    <TimelineRow icon={<SearchIcon className="size-3" />} time={ev.timestamp} color="text-blue-400">
      Analyzing query &amp; planning route...
    </TimelineRow>
  )
}

function renderRoutingCompletedRow(ev: GraphEvent | undefined): React.ReactNode {
  if (!ev) return null
  return (
    <TimelineRow icon={<RouteIcon className="size-3" />} time={ev.timestamp} color="text-indigo-400">
      Plan ready
      {ev.plan?.steps && (
        <span className="opacity-60 ml-1">
          ({ev.plan.steps.length} step
          {ev.plan.steps.length !== 1 ? 's' : ''})
        </span>
      )}
      {ev.reasoning && (
        <span className="block text-muted-foreground italic text-[11px] mt-0.5 truncate max-w-md">
          {ev.reasoning.substring(0, 120)}
        </span>
      )}
    </TimelineRow>
  )
}

/** Everything one specialist row needs, resolved from the raw `events` list. Pure — no
 * hooks — so `renderSpecialistRow` (a plain function, not a component) can call it. */
function specialistRowData(agentName: string, events: GraphEvent[], completedSpecs: GraphEvent[]) {
  const exitEvent = completedSpecs.find((e) => e.agent === agentName)
  const metadata = events.find((e) => e.event === 'expert-metadata' && e.expert === agentName)
  const agentToolCalls = events.filter(
    (e) =>
      (e.event === 'expert_tool_call' || e.event === 'subagent_tool_call') &&
      (e.agent === agentName || e.domain === metadata?.domain),
  )
  const agentToolResults = events.filter((e) => e.event === 'tool-result' && e.agent === agentName)
  const agentThoughts = events.filter(
    (e) => (e.event === 'expert-thinking' || e.event === 'expert_thought') && e.expert === agentName,
  )
  const agentText = events.find(
    (e) => e.event === 'expert_text' && (e.domain === metadata?.domain || e.agent === agentName),
  )
  const toolsBound = events.find((e) => e.event === 'tools-bound' && e.expert === agentName)
  return { exitEvent, agentToolCalls, agentToolResults, agentThoughts, agentText, toolsBound }
}

function renderSpecialistStatus(exitEvent: GraphEvent | undefined): React.ReactNode {
  if (!exitEvent) return <span className="animate-pulse text-yellow-500 text-[10px]"> working...</span>
  return exitEvent.success ? (
    <CheckCircleIcon className="size-3 text-green-500" />
  ) : (
    <XCircleIcon className="size-3 text-red-500" />
  )
}

function renderToolCallRow(tc: GraphEvent, j: number, agentToolResults: GraphEvent[]): React.ReactNode {
  const matchingResult = agentToolResults.find((r) => (r.tool ?? r.tool_name) === (tc.tool ?? tc.tool_name))
  return (
    <div key={j} className="pl-5 space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <WrenchIcon className="size-3 flex-shrink-0 text-purple-400" />
        <span className="font-mono text-[11px]">{tc.tool ?? tc.tool_name}</span>
        {matchingResult && <CheckCircleIcon className="size-3 text-green-500" />}
      </div>
      {matchingResult?.result && (
        <div className="pl-5 text-[10px] text-muted-foreground/70 font-mono break-all max-h-16 overflow-hidden line-clamp-3">
          {matchingResult.result.substring(0, 300)}
          {matchingResult.result.length > 300 && '...'}
        </div>
      )}
    </div>
  )
}

function renderSpecialistDurationBadge(exitEvent: GraphEvent | undefined): React.ReactNode {
  if (!exitEvent?.duration_ms) return null
  return (
    <span className="text-[10px] opacity-50 flex items-center gap-0.5">
      <TimerIcon className="size-2.5" />
      {(exitEvent.duration_ms / 1000).toFixed(1)}s
    </span>
  )
}

function renderToolsBoundBadge(toolsBound: GraphEvent | undefined): React.ReactNode {
  if (!toolsBound) return null
  return (
    <span className="text-[10px] opacity-40 flex items-center gap-0.5">
      <PackageIcon className="size-2.5" />
      {toolsBound.count ?? 0} tools
    </span>
  )
}

function renderThinkingIndicator(agentThoughts: GraphEvent[], exitEvent: GraphEvent | undefined): React.ReactNode {
  if (agentThoughts.length === 0 || exitEvent) return null
  const lastAttempt = agentThoughts[agentThoughts.length - 1]?.attempt ?? 1
  return (
    <div className="pl-5 text-[11px] text-muted-foreground italic flex items-center gap-1">
      <BrainCircuitIcon className="size-2.5 animate-pulse" />
      Thinking (attempt {lastAttempt})...
    </div>
  )
}

function renderExpertTextRow(agentText: GraphEvent | undefined, agentToolCalls: GraphEvent[]): React.ReactNode {
  if (!agentText || agentToolCalls.length > 0) return null
  return (
    <div className="pl-5 text-[11px] text-muted-foreground/70 truncate max-w-md">
      {agentText.content?.substring(0, 150)}
    </div>
  )
}

function renderSpecialistRow(
  agentName: string,
  i: number,
  events: GraphEvent[],
  completedSpecs: GraphEvent[],
): React.ReactNode {
  const { exitEvent, agentToolCalls, agentToolResults, agentThoughts, agentText, toolsBound } = specialistRowData(
    agentName,
    events,
    completedSpecs,
  )
  return (
    <div key={`${agentName}-${i}`} className="space-y-0.5">
      {/* Specialist header */}
      <div className="flex items-center gap-2 text-xs">
        <BotIcon className="size-3 flex-shrink-0 text-violet-400" />
        <span className="font-medium">{agentName}</span>
        {renderSpecialistStatus(exitEvent)}
        {renderSpecialistDurationBadge(exitEvent)}
        {renderToolsBoundBadge(toolsBound)}
      </div>
      {/* Thinking indicator */}
      {renderThinkingIndicator(agentThoughts, exitEvent)}
      {/* Tool Calls */}
      {agentToolCalls.map((tc, j) => renderToolCallRow(tc, j, agentToolResults))}
      {/* Expert text output (if no tool calls) */}
      {renderExpertTextRow(agentText, agentToolCalls)}
    </div>
  )
}

function renderFallbackRow(ev: GraphEvent | undefined): React.ReactNode {
  if (!ev) return null
  return (
    <TimelineRow icon={<ArrowRightIcon className="size-3" />} color="text-yellow-500">
      Fallback: {String(ev.failed)} &rarr; {String(ev.fallback)}
    </TimelineRow>
  )
}

function renderVerificationRow(ev: GraphEvent | undefined): React.ReactNode {
  if (!ev) return null
  return (
    <TimelineRow
      icon={<ShieldCheckIcon className="size-3" />}
      time={ev.timestamp}
      color={ev.is_valid ? 'text-green-500' : 'text-yellow-500'}
    >
      Verified
      {ev.score != null && <span className="opacity-60 ml-1">(score: {(ev.score * 100).toFixed(0)}%)</span>}
      {ev.feedback && (
        <span className="block text-[11px] text-muted-foreground italic mt-0.5 truncate max-w-md">
          {ev.feedback.substring(0, 120)}
        </span>
      )}
    </TimelineRow>
  )
}

function renderGraphCompleteRow(ev: GraphEvent | undefined): React.ReactNode {
  if (!ev) return null
  return (
    <TimelineRow icon={<CheckCircleIcon className="size-3" />} time={ev.timestamp} color="text-green-500">
      Graph complete
      {ev.status && <span className="opacity-50 ml-1">({ev.status})</span>}
    </TimelineRow>
  )
}

export const GraphActivity = memo(({ events, isStreaming }: GraphActivityProps) => {
  const [isOpen, setIsOpen] = useState(true)

  const routingEvent = events.find((e) => e.event === 'routing_completed' || e.event === 'planning_completed')
  const graphStartEvent = events.find((e) => e.event === 'graph-start')
  const graphCompleteEvent = events.find((e) => e.event === 'graph-complete')
  const fallbackEvent = events.find((e) => e.event === 'specialist_fallback')
  const verifyEvent = events.find((e) => e.event === 'verification_result')

  const specialistNames = Array.from(
    new Set(events.filter((e) => e.agent ?? e.expert).map((e) => e.agent ?? e.expert ?? '')),
  ).filter(Boolean)
  const completedSpecs = events.filter((e) => e.event === 'specialist_exit')
  const toolCalls = events.filter((e) => e.event === 'expert_tool_call' || e.event === 'subagent_tool_call')
  const routingStartedEvent = events.find((e) => e.event === 'routing_started')

  // Auto-close when execution completes
  useEffect(() => {
    if (!isStreaming && graphCompleteEvent) {
      const timer = setTimeout(() => {
        setIsOpen(false)
      }, 3000)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [isStreaming, graphCompleteEvent])

  if (events.length === 0) return null

  const totalDuration = completedSpecs.reduce((sum, e) => sum + (Number(e.duration_ms) || 0), 0)

  // Derive current phase for the header
  const lastEvent = events[events.length - 1]
  const currentPhase = (() => {
    if (graphCompleteEvent) return 'completed'
    if (verifyEvent) return 'verifying'
    if (completedSpecs.length > 0) return 'executing tools'
    if (specialistNames.length > 0) return 'specialist working'
    if (routingEvent) return 'dispatching'
    if (lastEvent.event === 'routing_started') return 'routing'
    return 'starting'
  })()

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="not-prose mb-2">
      {/* Header */}
      <CollapsibleTrigger
        aria-label="Toggle graph execution details"
        className="flex items-center gap-2 text-muted-foreground text-sm cursor-pointer hover:text-foreground transition-colors w-full"
      >
        <NetworkIcon className="size-4 flex-shrink-0" />
        {renderHeaderStatus(isStreaming, graphCompleteEvent, currentPhase, specialistNames, toolCalls, totalDuration)}
        <ChevronDownIcon className={cn('size-4 transition-transform ml-auto', isOpen ? 'rotate-180' : 'rotate-0')} />
      </CollapsibleTrigger>

      <CollapsibleContent className="pl-5 border-l-2 border-muted ml-2 mt-2 space-y-1.5 max-h-[400px] overflow-y-auto">
        {renderGraphStartRow(graphStartEvent)}
        {renderRoutingStartedRow(routingStartedEvent)}
        {renderRoutingCompletedRow(routingEvent)}
        {specialistNames.map((agentName, i) => renderSpecialistRow(agentName, i, events, completedSpecs))}
        {renderFallbackRow(fallbackEvent)}
        {renderVerificationRow(verifyEvent)}
        {renderGraphCompleteRow(graphCompleteEvent)}
      </CollapsibleContent>
    </Collapsible>
  )
})

GraphActivity.displayName = 'GraphActivity'

/* TimelineRow */

function TimelineRow({
  icon,
  time,
  color = 'text-muted-foreground',
  children,
}: {
  icon: React.ReactNode
  time?: number
  color?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <span className={cn('flex-shrink-0 mt-0.5', color)}>{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-foreground/80">{children}</span>
      </div>
      {time && <span className="text-[10px] opacity-40 tabular-nums flex-shrink-0">{formatTime(time)}</span>}
    </div>
  )
}
