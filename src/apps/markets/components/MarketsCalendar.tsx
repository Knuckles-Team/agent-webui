/**
 * @file MarketsCalendar.tsx
 * @description The Calendar destination (FUI-01): documented macro events
 * with their public source, reusing the existing `GET
 * /api/apps/markets/macro-events` route and schema (already served for the
 * chart's macro overlay).
 */
import { useQuery } from '@tanstack/react-query'
import { fetchMacroEvents } from '../api'
import type { MacroEvent } from '../schemas'
import { MarketsGate, RequestFailed } from './Availability'
import { MarketsShell } from './MarketsShell'

function EventRow({ event }: { event: MacroEvent }) {
  const when = new Date(event.announced_at).toLocaleString()
  return (
    <li className="flex flex-col gap-1 border-b border-border/40 py-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{event.title}</span>
        <span className="text-xs text-muted-foreground">{when}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {event.action}
        {event.source_url ? (
          <>
            {' · '}
            <a href={event.source_url} target="_blank" rel="noreferrer" className="underline">
              Source
            </a>
          </>
        ) : null}
      </div>
    </li>
  )
}

function CalendarBody() {
  const events = useQuery({ queryKey: ['markets', 'macro-events'], queryFn: fetchMacroEvents, staleTime: 60_000 })
  if (events.isError) return <RequestFailed what="The macro-event calendar" error={events.error} />
  if (!events.data) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (events.data.events.length === 0) {
    return <p className="text-sm text-muted-foreground">No documented macro events right now.</p>
  }
  return (
    <ul aria-label="Macro events">
      {events.data.events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </ul>
  )
}

export default function MarketsCalendar() {
  return (
    <MarketsGate>
      <MarketsShell>
        <CalendarBody />
      </MarketsShell>
    </MarketsGate>
  )
}
