import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ActivityIcon, ChevronDownIcon, CpuIcon, NetworkIcon, CheckCircle2Icon } from 'lucide-react'
import { memo, useState } from 'react'

export interface GraphEvent {
  event: string
  timestamp: number
  domain?: string
  domains?: string[]
  reasoning?: string
  tool_name?: string
  tool_args?: string
  duration?: number
  [key: string]: any
}

interface GraphActivityProps {
  events: GraphEvent[]
  isStreaming?: boolean
}

export const GraphActivity = memo(({ events, isStreaming }: GraphActivityProps) => {
  const [isOpen, setIsOpen] = useState(true)

  const validEvents = events.filter(Boolean) as GraphEvent[]
  if (validEvents.length === 0) return null

  const lastEvent = validEvents[validEvents.length - 1]

  const getIcon = (event: string = 'activity') => {
    if (event.includes('routing')) return <NetworkIcon className="size-4 text-blue-400" />
    if (event.includes('tool')) return <CpuIcon className="size-4 text-purple-400" />
    if (event.includes('completed')) return <CheckCircle2Icon className="size-4 text-green-400" />
    return <ActivityIcon className="size-4 text-muted-foreground" />
  }

  const getEventLabel = (ev: GraphEvent) => {
    if (!ev || !ev.event) return 'Internal activity'
    const domain = ev.domain || (ev as any).subagent || 'Unknown domain'
    switch (ev.event) {
      case 'routing_started':
        return 'Analyzing routing path...'
      case 'routing_completed':
        return `Routed to ${domain || ev.domains?.join(', ')}`
      case 'subagent_tool_call':
        return `Executing ${ev.tool_name}...`
      case 'subagent_tool_completed':
        return `Tool ${ev.tool_name} completed`
      case 'subagent_text':
        return `Streaming response from ${domain}...`
      case 'subagent_completed':
        return `Domain ${domain} finished`
      case 'parallel_execution_started':
        return `Executing ${ev.domains?.length} domains in parallel`
      case 'parallel_execution_completed':
        return 'Parallel execution finished'
      default:
        return (ev.event || 'activity').replace(/_/g, ' ')
    }
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full my-2 border rounded-lg bg-muted/30 p-2 overflow-hidden transition-all duration-300"
    >
      <CollapsibleTrigger className="flex items-center justify-between w-full gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        <div className="flex items-center gap-2">
          {getIcon(lastEvent?.event)}
          <span>{getEventLabel(lastEvent)}</span>
          {isStreaming && <span className="flex h-1 w-1 rounded-full bg-blue-500 animate-pulse" />}
        </div>
        <ChevronDownIcon className={cn('size-3 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2.5 border-t pt-2 max-h-[300px] overflow-y-auto scrollbar-hide">
        {validEvents.map((ev, i) => {
          if (ev.event === 'subagent_text') {
            const domainName = ev.domain || (ev as any).subagent || 'Unknown domain'
            const textPreview = ev.text ?? ''
            return (
              <div
                key={i}
                className="flex gap-3 text-[11px] leading-tight group border-l-2 border-blue-400/30 pl-2 ml-1"
              >
                <span className="text-muted-foreground/50 tabular-nums shrink-0 mt-0.5">
                  {ev.timestamp
                    ? new Date(ev.timestamp * 1000).toLocaleTimeString([], {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : '--:--:--'}
                </span>
                <div className="flex flex-col">
                  <span className="text-blue-400 font-semibold uppercase tracking-tight text-[8px]">
                    {domainName} Response DELTA
                  </span>
                  <p className="text-foreground/70 font-mono text-[10px] break-all whitespace-pre-wrap">
                    {textPreview}
                  </p>
                </div>
              </div>
            )
          }

          return (
            <div key={i} className="flex gap-3 text-[11px] leading-tight group">
              <span className="text-muted-foreground/50 tabular-nums shrink-0 mt-0.5">
                {ev.timestamp
                  ? new Date(ev.timestamp * 1000).toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : '--:--:--'}
              </span>
              <div className="flex flex-col">
                <span className="text-muted-foreground font-semibold uppercase tracking-tight text-[9px] group-hover:text-foreground transition-colors">
                  {ev.event}
                </span>
                <span className="text-foreground/80">{getEventLabel(ev)}</span>
                {ev.reasoning && <p className="text-muted-foreground italic mt-0.5">{ev.reasoning}</p>}
                {ev.tool_args && (
                  <code className="bg-muted/50 px-1 rounded text-[10px] mt-1 break-all overflow-hidden line-clamp-2 border border-border/50">
                    {ev.tool_args}
                  </code>
                )}
              </div>
            </div>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
})

GraphActivity.displayName = 'GraphActivity'
