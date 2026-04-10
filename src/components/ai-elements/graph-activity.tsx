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
} from 'lucide-react'
import { memo, useEffect, useState } from 'react'

export interface GraphEvent {
  type: 'graph-event'
  event: string
  domain?: string
  agent?: string
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
  [key: string]: unknown
}

interface GraphActivityProps {
  events: GraphEvent[]
  isStreaming: boolean
}

export const GraphActivity = memo(({ events, isStreaming }: GraphActivityProps) => {
  const [isOpen, setIsOpen] = useState(true)

  const routingEvent = events.find((e) => e.event === 'planning_completed')
  const regionsEvent = events.find((e) => e.event === 'orthogonal_regions_start')
  const fallbackEvent = events.find((e) => e.event === 'specialist_fallback')
  const verifyEvent = events.find((e) => e.event === 'verification_result')

  const specialists = Array.from(new Set(events.filter((e) => e.agent).map((e) => e.agent))) as string[]
  const completedSpecs = events.filter((e) => e.event === 'specialist_exit')

  // Auto-close when execution completes
  useEffect(() => {
    if (!isStreaming && completedSpecs.length > 0) {
      const timer = setTimeout(() => {
        setIsOpen(false)
      }, 2000)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [isStreaming, completedSpecs.length])

  if (events.length === 0) return null

  const totalDuration = completedSpecs.reduce((sum, e) => sum + (Number(e.duration_ms) || 0), 0)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="not-prose mb-2">
      <CollapsibleTrigger
        aria-label="Toggle graph execution details"
        className="flex items-center gap-2 text-muted-foreground text-sm cursor-pointer hover:text-foreground transition-colors"
      >
        <NetworkIcon className="size-4" />
        {isStreaming ? (
          <span className="animate-pulse">Graph executing...</span>
        ) : (
          <span>
            Graph: {specialists.length} specialist{specialists.length !== 1 ? 's' : ''}
            {totalDuration > 0 && <span className="ml-1 opacity-60">({(totalDuration / 1000).toFixed(1)}s)</span>}
          </span>
        )}
        <ChevronDownIcon className={cn('size-4 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')} />
      </CollapsibleTrigger>

      <CollapsibleContent className="pl-5 border-l-2 border-muted ml-2 mt-2 space-y-1.5">
        {/* Routing Decision */}
        {routingEvent && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RouteIcon className="size-3 flex-shrink-0" />
            <span>Routed: {routingEvent.reasoning ? routingEvent.reasoning.substring(0, 120) : 'Plan created'}</span>
          </div>
        )}

        {/* Specialist Activity */}
        {specialists.map((agentName, i) => {
          const exitEvent = completedSpecs.find((e) => e.agent === agentName)
          const toolCalls = events.filter((e) => e.agent === agentName && e.event === 'expert_tool_call')
          const thoughts = events.filter((e) => e.agent === agentName && e.event === 'expert_thought')

          return (
            <div key={`${agentName}-${i}`} className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs">
                <BotIcon className="size-3 flex-shrink-0" />
                <span className="font-medium">{agentName}</span>
                {exitEvent ? (
                  exitEvent.success ? (
                    <CheckCircleIcon className="size-3 text-green-500" />
                  ) : (
                    <XCircleIcon className="size-3 text-red-500" />
                  )
                ) : (
                  <span className="animate-pulse text-yellow-500 text-xs"> working...</span>
                )}
                {exitEvent?.duration_ms && (
                  <span className="text-xs opacity-50 flex items-center gap-0.5">
                    <TimerIcon className="size-2.5" />
                    {((exitEvent.duration_ms || 0) / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              {/* Thoughts */}
              {thoughts.slice(0, 2).map((t, j) => (
                <div key={j} className="pl-5 text-xs text-muted-foreground italic truncate max-w-lg">
                  {(t.thought ?? t.content ?? '').substring(0, 150)}
                </div>
              ))}

              {/* Tool Calls */}
              {toolCalls.map((tc, j) => (
                <div key={j} className="pl-5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <WrenchIcon className="size-3 flex-shrink-0" />
                  <span className="font-mono">{tc.tool ?? tc.tool_name}</span>
                </div>
              ))}
            </div>
          )
        })}

        {/* Orthogonal Regions */}
        {regionsEvent && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ZapIcon className="size-3 flex-shrink-0" />
            <span>{regionsEvent.region_count} concurrent regions</span>
          </div>
        )}

        {/* Fallback */}
        {fallbackEvent && (
          <div className="flex items-center gap-2 text-xs text-yellow-600">
            <RouteIcon className="size-3 flex-shrink-0" />
            <span>
              Fallback: {String(fallbackEvent.failed)} → {String(fallbackEvent.fallback)}
            </span>
          </div>
        )}

        {/* Verification */}
        {verifyEvent && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RouteIcon className="size-3 flex-shrink-0" />
            <span>
              Verified: score {(Number(verifyEvent.score) * 100).toFixed(0)}%
              {verifyEvent.feedback && <span className="opacity-60"> - {verifyEvent.feedback.substring(0, 80)}</span>}
            </span>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
})

GraphActivity.displayName = 'GraphActivity'
