/**
 * @file GraphActivity.tsx
 * @description Visualizes real-time graph execution events in a collapsible timeline.
 *
 * CONCEPT:KG-005 — Graph Transparency
 *
 * Displays sideband events emitted by the agent orchestrator, including:
 * - Domain routing decisions
 * - Parallel execution status
 * - Tool binding and execution progress
 * - Expert specialized reasoning and warnings
 * - Node transitions and state snapshots
 * - Elicitation events for human-in-the-loop
 */

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  ActivityIcon,
  ChevronDownIcon,
  CpuIcon,
  NetworkIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  MessageSquareIcon,
  GitBranchIcon,
  CameraIcon,
  Loader2Icon,
} from 'lucide-react'
import { memo, useState, useRef, useEffect, type ReactNode } from 'react'

/**
 * Interface representing a single event emitted by the agent graph orchestrator.
 *
 * CONCEPT:KG-005 — Graph Transparency
 */
export interface GraphEvent {
  /** The unique event type identifier (e.g., 'routing_started', 'tool_call') */
  event: string
  /** Unix timestamp of the event */
  timestamp: number
  /** The domain or specialist involved in the event */
  domain?: string
  /** List of domains involved in parallel execution */
  domains?: string[]
  /** Free-text reasoning explanation from the expert */
  reasoning?: string
  /** Name of the tool being executed */
  tool_name?: string
  /** Serialized tool arguments */
  tool_args?: string
  /** Duration of the operation in seconds */
  duration?: number
  /** Alternative identifier for the specialist */
  subagent?: string
  /** The expert node identifier */
  expert?: string
  /** Count of items (e.g., tools bound) */
  count?: number
  /** Generic message payload */
  message?: string
  /** Textual delta or content */
  text?: string
  /** Source and target for node transitions */
  source_node?: string
  target_node?: string
  /** State snapshot data */
  state?: Record<string, unknown>
  /** Elicitation prompt */
  prompt?: string
  /** Catch-all for additional dynamic event data */
  [key: string]: unknown
}

/**
 * Props for the GraphActivity component
 */
interface GraphActivityProps {
  /** Ordered list of graph events for the current message */
  events: GraphEvent[]
  /** Whether the parent message is still being streamed */
  isStreaming?: boolean
}

/* ── Color scheme by event category ────────────────────────────────── */

type EventCategory =
  'routing' | 'tool' | 'text' | 'error' | 'elicitation' | 'transition' | 'snapshot' | 'complete' | 'default'

/** Ordered substring → category rules, checked in order (first match wins) — a data
 * table instead of an if-chain so adding/reordering a rule never touches control flow. */
const EVENT_CATEGORY_RULES: readonly [needle: string, category: EventCategory][] = [
  ['routing', 'routing'],
  ['tool', 'tool'],
  ['completed', 'complete'],
  ['complete', 'complete'],
  ['warning', 'error'],
  ['error', 'error'],
  ['elicitation', 'elicitation'],
  ['node_transition', 'transition'],
  ['state_snapshot', 'snapshot'],
  ['text', 'text'],
]

function getEventCategory(event: string): EventCategory {
  const rule = EVENT_CATEGORY_RULES.find(([needle]) => event.includes(needle))
  return rule ? rule[1] : 'default'
}

/** One formatter per known `event` value — a dispatch table instead of a `switch` so
 * each case is judged (and stays under cap) independently of every other case. `domain`
 * is the caller-resolved `ev.domain ?? ev.expert ?? ev.subagent ?? 'Specialist'`. */
const EVENT_LABEL_FORMATTERS: Partial<Record<string, (ev: GraphEvent, domain: string) => string>> = {
  'expert-metadata': (_ev, domain) => `Handshaking with ${domain} Specialist...`,
  'tools-bound': (ev, domain) => `Successfully bound ${ev.count ?? 0} tools to ${domain}`,
  'expert-warning': (ev) => `Expert Warning: ${ev.message ?? 'Unknown issue'}`,
  routing_started: () => 'Analyzing routing path...',
  routing_completed: (ev, domain) => {
    const domainsText = ev.domains ? ev.domains.join(', ') : 'Unknown'
    const target = domain === 'Specialist' ? domainsText : domain
    return `Routed to ${target}`
  },
  subagent_tool_call: (ev) => `Executing ${ev.tool_name ?? 'tool'}...`,
  subagent_tool_completed: (ev) =>
    `Tool ${ev.tool_name ?? 'tool'} completed${ev.duration ? ` (${ev.duration.toFixed(1)}s)` : ''}`,
  subagent_text: (_ev, domain) => `Streaming response from ${domain}...`,
  subagent_completed: (ev, domain) => `Expert ${domain} finished${ev.duration ? ` (${ev.duration.toFixed(1)}s)` : ''}`,
  parallel_execution_started: (ev) => `Executing ${ev.domains?.length ?? 0} domains in parallel`,
  parallel_execution_completed: () => 'Parallel execution finished',
  node_transition: (ev) => `${ev.source_node ?? '?'} → ${ev.target_node ?? '?'}`,
  elicitation: (ev) => `Waiting for input: ${ev.prompt ?? ev.message ?? 'user response needed'}`,
  state_snapshot: (ev) => `State captured: ${Object.keys(ev.state ?? {}).length} fields`,
  graph_complete: (ev) => `Graph execution complete${ev.duration ? ` (${ev.duration.toFixed(1)}s total)` : ''}`,
}

/**
 * Generates a human-friendly label for common graph events
 */
function getEventLabelText(ev: GraphEvent): string {
  if (!ev.event) return 'Internal activity'
  const domain = ev.domain ?? ev.expert ?? ev.subagent ?? 'Specialist'
  const formatter = EVENT_LABEL_FORMATTERS[ev.event]
  return formatter ? formatter(ev, domain) : ev.event.replace(/_/g, ' ')
}

/**
 * Returns the appropriate Lucide icon for a given event type
 */
function getEventIcon(event = 'activity'): ReactNode {
  const category = getEventCategory(event)
  const color = categoryColors[category]
  if (event.includes('routing')) return <NetworkIcon className={cn('size-3.5', color)} />
  if (event.includes('tool')) return <CpuIcon className={cn('size-3.5', color)} />
  if (event.includes('completed') || event.includes('complete'))
    return <CheckCircle2Icon className={cn('size-3.5', color)} />
  if (event.includes('warning') || event.includes('error'))
    return <AlertTriangleIcon className={cn('size-3.5', color)} />
  if (event.includes('elicitation')) return <MessageSquareIcon className={cn('size-3.5', color)} />
  if (event.includes('node_transition')) return <GitBranchIcon className={cn('size-3.5', color)} />
  if (event.includes('state_snapshot')) return <CameraIcon className={cn('size-3.5', color)} />
  return <ActivityIcon className={cn('size-3.5', color)} />
}

/** Shared HH:MM:SS timestamp cell for a timeline row (both the subagent-text and the
 * generic row shape use the exact same formatting). */
function formatEventTimestamp(timestamp: number | undefined): string {
  if (!timestamp) return '--:--:--'
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** One timeline row for a batched `subagent_text` delta. */
function renderSubagentTextEventRow(
  ev: GraphEvent,
  i: number,
  category: EventCategory,
  isLast: boolean,
  isStreaming?: boolean,
): ReactNode {
  const domainName = ev.domain ?? ev.subagent ?? 'Unknown domain'
  const textPreview = ev.text ?? ''
  return (
    <div
      key={i}
      className={cn(
        'relative flex gap-3 text-[11px] leading-tight py-1.5',
        'border-l-2 ml-[-9px] pl-4',
        categoryBorderColors[category],
      )}
    >
      {/* Timeline dot */}
      <div
        className={cn(
          'absolute left-[-5px] top-2.5 size-2 rounded-full',
          categoryDotColors[category],
          isLast && isStreaming && 'animate-pulse',
        )}
      />
      <span className="text-muted-foreground/50 tabular-nums shrink-0 mt-0.5 w-14">
        {formatEventTimestamp(ev.timestamp)}
      </span>
      <div className="flex flex-col min-w-0">
        <span className={cn('font-semibold uppercase tracking-tight text-[8px]', categoryColors[category])}>
          {domainName} Response DELTA
        </span>
        <p className="text-foreground/70 font-mono text-[10px] break-all whitespace-pre-wrap line-clamp-3">
          {textPreview}
        </p>
      </div>
    </div>
  )
}

/** One timeline row for any other (non-`subagent_text`) event. */
function renderGenericEventRow(
  ev: GraphEvent,
  i: number,
  category: EventCategory,
  isLast: boolean,
  isStreaming?: boolean,
): ReactNode {
  return (
    <div key={i} className="relative flex gap-3 text-[11px] leading-tight py-1.5 ml-[-9px] pl-4">
      {/* Timeline dot */}
      <div
        className={cn(
          'absolute left-[-5px] top-2.5 size-2 rounded-full',
          categoryDotColors[category],
          isLast && isStreaming && 'animate-pulse',
        )}
      />
      <span className="text-muted-foreground/50 tabular-nums shrink-0 mt-0.5 w-14">
        {formatEventTimestamp(ev.timestamp)}
      </span>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          {getEventIcon(ev.event)}
          <span className={cn('font-semibold uppercase tracking-tight text-[9px]', categoryColors[category])}>
            {ev.event}
          </span>
          {ev.duration && (
            <Badge variant="secondary" className="h-3.5 text-[8px] px-1">
              {ev.duration.toFixed(1)}s
            </Badge>
          )}
        </div>
        <span className="text-foreground/80 mt-0.5">{getEventLabelText(ev)}</span>
        {ev.reasoning && <p className="text-muted-foreground italic mt-0.5 text-[10px]">{ev.reasoning}</p>}
        {ev.tool_args && (
          <code className="bg-muted/50 px-1.5 py-0.5 rounded text-[10px] mt-1 break-all overflow-hidden line-clamp-2 border border-border/50 font-mono">
            {ev.tool_args}
          </code>
        )}
      </div>
    </div>
  )
}

/** One timeline row, dispatched by event shape. */
function renderEventRow(ev: GraphEvent, i: number, isLast: boolean, isStreaming?: boolean): ReactNode {
  const category = getEventCategory(ev.event)
  return ev.event === 'subagent_text'
    ? renderSubagentTextEventRow(ev, i, category, isLast, isStreaming)
    : renderGenericEventRow(ev, i, category, isLast, isStreaming)
}

const categoryColors: Record<EventCategory, string> = {
  routing: 'text-blue-400',
  tool: 'text-purple-400',
  text: 'text-green-400',
  error: 'text-red-400',
  elicitation: 'text-amber-400',
  transition: 'text-cyan-400',
  snapshot: 'text-teal-400',
  complete: 'text-emerald-400',
  default: 'text-muted-foreground',
}

const categoryBorderColors: Record<EventCategory, string> = {
  routing: 'border-blue-400/30',
  tool: 'border-purple-400/30',
  text: 'border-green-400/30',
  error: 'border-red-400/30',
  elicitation: 'border-amber-400/30',
  transition: 'border-cyan-400/30',
  snapshot: 'border-teal-400/30',
  complete: 'border-emerald-400/30',
  default: 'border-border/30',
}

const categoryDotColors: Record<EventCategory, string> = {
  routing: 'bg-blue-400',
  tool: 'bg-purple-400',
  text: 'bg-green-400',
  error: 'bg-red-400',
  elicitation: 'bg-amber-400',
  transition: 'bg-cyan-400',
  snapshot: 'bg-teal-400',
  complete: 'bg-emerald-400',
  default: 'bg-muted-foreground',
}

/**
 * GraphActivity Component
 *
 * CONCEPT:KG-005 — Graph Transparency
 *
 * Renders a specialized timeline of events associated with a message.
 * Features color-coded event categories, visual timeline rail, duration badges,
 * auto-scrolling, and support for node_transition / elicitation / state_snapshot events.
 */
export const GraphActivity = memo(({ events, isStreaming }: GraphActivityProps) => {
  const [isOpen, setIsOpen] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest event
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events.length, isOpen])

  // Batch subagent_text deltas — only show the last one per domain
  const displayEvents = events.filter(Boolean).reduce<GraphEvent[]>((acc, ev) => {
    if (ev.event === 'subagent_text') {
      const domain = ev.domain ?? ev.subagent ?? 'Unknown'
      let lastIdx = -1
      for (let j = acc.length - 1; j >= 0; j--) {
        if (acc[j].event === 'subagent_text' && (acc[j].domain ?? acc[j].subagent ?? 'Unknown') === domain) {
          lastIdx = j
          break
        }
      }
      if (lastIdx >= 0) {
        acc[lastIdx] = ev // Replace with latest delta
        return acc
      }
    }
    acc.push(ev)
    return acc
  }, [])

  if (displayEvents.length === 0) return null

  const lastEvent = displayEvents[displayEvents.length - 1]
  const lastCategory = getEventCategory(lastEvent.event)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full my-2 border rounded-lg bg-muted/20 overflow-hidden transition-all duration-300"
    >
      <CollapsibleTrigger className="flex items-center justify-between w-full gap-2 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-2">
        <div className="flex items-center gap-2">
          {getEventIcon(lastEvent.event)}
          <span className={cn('transition-colors', categoryColors[lastCategory])}>{getEventLabelText(lastEvent)}</span>
          {isStreaming && (
            <Badge variant="outline" className="h-4 text-[9px] gap-1 border-blue-500/30 text-blue-400 animate-pulse">
              <Loader2Icon className="size-2.5 animate-spin" />
              Live
            </Badge>
          )}
          {lastEvent.duration && (
            <Badge variant="secondary" className="h-4 text-[9px]">
              {lastEvent.duration.toFixed(1)}s
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/50">{displayEvents.length} events</span>
          <ChevronDownIcon className={cn('size-3 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div ref={scrollRef} className="border-t max-h-[350px] overflow-y-auto scrollbar-hide">
          <div className="relative pl-6 pr-3 py-2 space-y-0">
            {/* Timeline rail */}
            <div className="absolute left-[15px] top-3 bottom-3 w-px bg-border/40" />

            {displayEvents.map((ev, i) => renderEventRow(ev, i, i === displayEvents.length - 1, isStreaming))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

GraphActivity.displayName = 'GraphActivity'
