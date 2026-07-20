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
        {isStreaming && !graphCompleteEvent ? (
          <span className="flex items-center gap-2">
            <span className="animate-pulse">Graph {currentPhase}...</span>
            <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
          </span>
        ) : (
          <span>
            Graph: {specialistNames.length} specialist
            {specialistNames.length !== 1 ? 's' : ''}
            {toolCalls.length > 0 && `, ${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''}`}
            {totalDuration > 0 && <span className="ml-1 opacity-60">({(totalDuration / 1000).toFixed(1)}s)</span>}
          </span>
        )}
        <ChevronDownIcon className={cn('size-4 transition-transform ml-auto', isOpen ? 'rotate-180' : 'rotate-0')} />
      </CollapsibleTrigger>

      <CollapsibleContent className="pl-5 border-l-2 border-muted ml-2 mt-2 space-y-1.5 max-h-[400px] overflow-y-auto">
        {/* Graph Start */}
        {graphStartEvent && (
          <TimelineRow icon={<ZapIcon className="size-3" />} time={graphStartEvent.timestamp} color="text-blue-400">
            Graph started
            {graphStartEvent.query && (
              <span className="opacity-50 ml-1 truncate max-w-xs inline-block align-bottom">
                &mdash; {graphStartEvent.query.substring(0, 60)}
              </span>
            )}
          </TimelineRow>
        )}
        {/* Routing */}
        {events.find((e) => e.event === 'routing_started') && (
          <TimelineRow
            icon={<SearchIcon className="size-3" />}
            time={events.find((e) => e.event === 'routing_started')?.timestamp}
            color="text-blue-400"
          >
            Analyzing query &amp; planning route...
          </TimelineRow>
        )}
        {routingEvent && (
          <TimelineRow icon={<RouteIcon className="size-3" />} time={routingEvent.timestamp} color="text-indigo-400">
            Plan ready
            {routingEvent.plan?.steps && (
              <span className="opacity-60 ml-1">
                ({routingEvent.plan.steps.length} step
                {routingEvent.plan.steps.length !== 1 ? 's' : ''})
              </span>
            )}
            {routingEvent.reasoning && (
              <span className="block text-muted-foreground italic text-[11px] mt-0.5 truncate max-w-md">
                {routingEvent.reasoning.substring(0, 120)}
              </span>
            )}
          </TimelineRow>
        )}

        {/* Specialist Activity */}
        {specialistNames.map((agentName, i) => {
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
          return (
            <div key={`${agentName}-${i}`} className="space-y-0.5">
              {/* Specialist header */}
              <div className="flex items-center gap-2 text-xs">
                <BotIcon className="size-3 flex-shrink-0 text-violet-400" />
                <span className="font-medium">{agentName}</span>
                {exitEvent ? (
                  exitEvent.success ? (
                    <CheckCircleIcon className="size-3 text-green-500" />
                  ) : (
                    <XCircleIcon className="size-3 text-red-500" />
                  )
                ) : (
                  <span className="animate-pulse text-yellow-500 text-[10px]"> working...</span>
                )}
                {exitEvent?.duration_ms && (
                  <span className="text-[10px] opacity-50 flex items-center gap-0.5">
                    <TimerIcon className="size-2.5" />
                    {((exitEvent.duration_ms || 0) / 1000).toFixed(1)}s
                  </span>
                )}
                {toolsBound && (
                  <span className="text-[10px] opacity-40 flex items-center gap-0.5">
                    <PackageIcon className="size-2.5" />
                    {toolsBound.count ?? 0} tools
                  </span>
                )}
              </div>
              {/* Thinking indicator */}
              {agentThoughts.length > 0 && !exitEvent && (
                <div className="pl-5 text-[11px] text-muted-foreground italic flex items-center gap-1">
                  <BrainCircuitIcon className="size-2.5 animate-pulse" />
                  Thinking (attempt {agentThoughts[agentThoughts.length - 1]?.attempt ?? 1})...
                </div>
              )}

              {/* Tool Calls */}
              {agentToolCalls.map((tc, j) => {
                const matchingResult = agentToolResults.find(
                  (r) => (r.tool ?? r.tool_name) === (tc.tool ?? tc.tool_name),
                )
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
              })}
              {/* Expert text output (if no tool calls) */}
              {agentText && agentToolCalls.length === 0 && (
                <div className="pl-5 text-[11px] text-muted-foreground/70 truncate max-w-md">
                  {agentText.content?.substring(0, 150)}
                </div>
              )}
            </div>
          )
        })}

        {/* Fallback */}
        {fallbackEvent && (
          <TimelineRow icon={<ArrowRightIcon className="size-3" />} color="text-yellow-500">
            Fallback: {String(fallbackEvent.failed)} &rarr; {String(fallbackEvent.fallback)}
          </TimelineRow>
        )}

        {/* Verification */}
        {verifyEvent && (
          <TimelineRow
            icon={<ShieldCheckIcon className="size-3" />}
            time={verifyEvent.timestamp}
            color={verifyEvent.is_valid ? 'text-green-500' : 'text-yellow-500'}
          >
            Verified
            {verifyEvent.score != null && (
              <span className="opacity-60 ml-1">(score: {(verifyEvent.score * 100).toFixed(0)}%)</span>
            )}
            {verifyEvent.feedback && (
              <span className="block text-[11px] text-muted-foreground italic mt-0.5 truncate max-w-md">
                {verifyEvent.feedback.substring(0, 120)}
              </span>
            )}
          </TimelineRow>
        )}
        {/* Graph Complete */}
        {graphCompleteEvent && (
          <TimelineRow
            icon={<CheckCircleIcon className="size-3" />}
            time={graphCompleteEvent.timestamp}
            color="text-green-500"
          >
            Graph complete
            {graphCompleteEvent.status && <span className="opacity-50 ml-1">({graphCompleteEvent.status})</span>}
          </TimelineRow>
        )}
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
