/**
 * @file DashboardView.tsx
 * @description Agent-OS Homepage-style service dashboard.
 *
 * The primary landing view — displays all configured services as
 * interactive widget cards organized by category, with live data
 * fetching, WebSocket streaming, and full customization support.
 */

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  Activity,
  Container,
  Globe,
  ShieldCheck,
  GitBranch,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  LayoutGrid,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeExternalUrl } from '@/lib/safe-url'
import { fetchValidated, looseArray } from '@/lib/api-validation'
import DashboardSettings from './DashboardSettings'
import DefaultOverviewPanel from './DefaultOverviewPanel'

/* ── Types ───────────────────────────────────────────────────────── */

interface WidgetData {
  fields: Record<string, number | string | boolean>
  status: 'ok' | 'error' | 'unreachable' | 'unknown'
  error: string | null
  timestamp: string
}

interface ServiceConfig {
  id: string
  name: string
  widget_type: string
  url: string
  icon: string
  description: string
  category: string
  href: string
  visible: boolean
  column_span: number
  row_span: number
  order: number
  refresh_interval: number
  websocket: boolean
  fields: string[] | null
}

interface ServiceGroup {
  name: string
  services: ServiceConfig[]
  order: number
  collapsed: boolean
  icon: string
}

interface DashboardLayout {
  groups: ServiceGroup[]
  columns: number
  theme: string
  card_size: string
  show_search: boolean
  show_status_indicators: boolean
  auto_refresh: boolean
  refresh_interval: number
}

// D-WUI-8: /api/dashboard/full can answer a truthy-but-layout-less body ({}
// or []). The old `res.json() as Promise<{layout: DashboardLayout; ...}>`
// type assertion lied to the compiler about that -- TS then trusted
// `dashboardData?.layout.groups` was always safe (only `dashboardData`
// itself was ever nullable per the declared type), and it crashed with
// "Cannot read properties of undefined (reading 'groups')" the moment a real
// response didn't match. Validate at the fetch boundary instead of asserting
// the shape, so the type the rest of the component sees is actually true.
const widgetDataSchema: z.ZodType<WidgetData> = z.object({
  fields: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  status: z.enum(['ok', 'error', 'unreachable', 'unknown']),
  error: z.string().nullable(),
  timestamp: z.string(),
})

const serviceConfigSchema: z.ZodType<ServiceConfig> = z.object({
  id: z.string(),
  name: z.string(),
  widget_type: z.string(),
  url: z.string(),
  icon: z.string(),
  description: z.string(),
  category: z.string(),
  href: z.string(),
  visible: z.boolean(),
  column_span: z.number(),
  row_span: z.number(),
  order: z.number(),
  refresh_interval: z.number(),
  websocket: z.boolean(),
  fields: z.array(z.string()).nullable(),
})

const serviceGroupSchema: z.ZodType<ServiceGroup> = z.object({
  name: z.string(),
  services: looseArray(serviceConfigSchema),
  order: z.number(),
  collapsed: z.boolean(),
  icon: z.string(),
})

const dashboardLayoutSchema: z.ZodType<DashboardLayout> = z.object({
  groups: looseArray(serviceGroupSchema),
  columns: z.number(),
  theme: z.string(),
  card_size: z.string(),
  show_search: z.boolean(),
  show_status_indicators: z.boolean(),
  auto_refresh: z.boolean(),
  refresh_interval: z.number(),
})

const dashboardFullSchema: z.ZodType<{ layout: DashboardLayout; data: Record<string, WidgetData> }> = z.object({
  layout: dashboardLayoutSchema,
  data: z.record(z.string(), widgetDataSchema),
})

/* ── BUG-019 (GOC-29): WebSocket reconnect backoff + stale-connection guard ──
 *
 * Extracted as pure, DOM-free logic so it is unit-testable independent of
 * this repo's react-query render harness (the same "assert the pure logic,
 * not DOM output" precedent WorkflowEditorView/ObjectView already use for
 * react-query-backed views).
 */

export const RECONNECT_BASE_DELAY_MS = 1000
export const RECONNECT_MAX_DELAY_MS = 30000

/** Doubles the delay every failed attempt, capped at {@link RECONNECT_MAX_DELAY_MS}. */
export function nextBackoffDelayMs(previousDelayMs: number): number {
  return Math.min(RECONNECT_MAX_DELAY_MS, previousDelayMs * 2)
}

/**
 * Applies +/-30% full jitter around `delayMs`, clamped to
 * `[0, RECONNECT_MAX_DELAY_MS]`. Spreads simultaneously-disconnected clients'
 * retries instead of every client reconnecting on the same tick (the
 * thundering-herd pattern a flat, un-jittered delay produces).
 */
export function jitteredReconnectDelayMs(delayMs: number, random: () => number = Math.random): number {
  const jitter = delayMs * 0.3 * (random() * 2 - 1)
  return Math.min(RECONNECT_MAX_DELAY_MS, Math.max(0, delayMs + jitter))
}

/* ── GOC-29: backend wire-protocol consumption (closing BUG-019's deferred half) ──
 *
 * `/ws/dashboard` (`agent_webui/server.py::_dashboard_ws`) now carries
 * `stream_id` (minted fresh per accepted connection) and `sequence`
 * (monotonic within that connection) on every message. This endpoint has no
 * durable backlog to resume from -- every push is a fresh full poll, not a
 * delta against an event log -- so a reconnect can never "replay" a gap, it
 * can only detect one. `stream_id` is what makes that detection possible: a
 * message whose `stream_id` differs from the last one this client saw
 * proves, structurally, that whatever happened between the two was never
 * delivered. The charter rule this exists to satisfy: a dropped or
 * reconnecting realtime stream must surface as unknown/stale, never as
 * confidently rendered stale data presented as live.
 */
export type DataFreshness = 'fresh' | 'stale' | 'reset'

/** `id` of the live-region banner announcing non-fresh data; also wired via `aria-describedby`. */
export const DATA_FRESHNESS_BANNER_ID = 'dashboard-freshness-banner'

/**
 * Tracks which WebSocket "generation" (one per `connect()` attempt) is
 * currently authoritative. A stale/duplicate message or close/error event
 * from a socket a newer `connect()` has already superseded -- e.g. arriving
 * just after a forced disconnect triggers a fresh reconnect -- must never be
 * allowed to overwrite state a newer connection already established. Each
 * socket's callbacks close over the generation they were opened with and
 * call {@link isCurrent} before acting on anything.
 */
export class ConnectionGeneration {
  private current = 0

  /** Call once per `connect()` attempt; returns the generation to close over. */
  next(): number {
    this.current += 1
    return this.current
  }

  /** True only for the most recently started generation. */
  isCurrent(generation: number): boolean {
    return generation === this.current
  }
}

/* ── Icon Map ────────────────────────────────────────────────────── */

const ICON_MAP: Record<string, ReactNode | undefined> = {
  container: <Container className="size-5" />,
  activity: <Activity className="size-5" />,
  globe: <Globe className="size-5" />,
  'shield-check': <ShieldCheck className="size-5" />,
  gitlab: <GitBranch className="size-5" />,
}

/* ── Format Helpers ──────────────────────────────────────────────── */

function formatValue(value: number | string | boolean, format: string, suffix: string): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return `${value}${suffix}`

  switch (format) {
    case 'percent':
      return `${value}${suffix || '%'}`
    case 'bytes':
      if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`
      if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`
      if (value >= 1e3) return `${(value / 1e3).toFixed(1)} KB`
      return `${value} B`
    case 'duration':
      if (value >= 86400) return `${Math.floor(value / 86400)}d`
      if (value >= 3600) return `${Math.floor(value / 3600)}h`
      if (value >= 60) return `${Math.floor(value / 60)}m`
      return `${value}s`
    default:
      return `${typeof value === 'number' ? value.toLocaleString() : value}${suffix}`
  }
}

/* ── Widget Block Component ──────────────────────────────────────── */

function WidgetBlock({
  label,
  value,
  format = 'number',
  suffix = '',
  highlight = false,
}: {
  label: string
  value: number | string | boolean | undefined
  format?: string
  suffix?: string
  highlight?: boolean
}) {
  const displayValue = value !== undefined ? formatValue(value, format, suffix) : '—'

  const isWarning =
    highlight &&
    typeof value === 'number' &&
    value > 0 &&
    (label.toLowerCase().includes('down') ||
      label.toLowerCase().includes('failed') ||
      label.toLowerCase().includes('stopped') ||
      label.toLowerCase().includes('unhealthy'))

  const isGood =
    highlight &&
    typeof value === 'number' &&
    value > 0 &&
    (label.toLowerCase().includes('up') ||
      label.toLowerCase().includes('running') ||
      label.toLowerCase().includes('healthy'))

  return (
    <div className="flex flex-col items-center justify-center px-3 py-2 min-w-[70px]">
      <span
        className={cn(
          'text-xl font-bold tabular-nums transition-colors',
          isWarning && 'text-red-400',
          isGood && 'text-emerald-400',
          !isWarning && !isGood && 'text-foreground',
        )}
      >
        {displayValue}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-0.5">{label}</span>
    </div>
  )
}

/* ── Widget Card Component ───────────────────────────────────────── */

function WidgetCard({ service, data, isLoading }: { service: ServiceConfig; data?: WidgetData; isLoading: boolean }) {
  const icon = ICON_MAP[service.icon] ?? <LayoutGrid className="size-5" />
  const status = data?.status ?? 'unknown'
  const externalHref = safeExternalUrl(service.href)

  const statusColor = {
    ok: 'bg-emerald-500',
    error: 'bg-red-500',
    unreachable: 'bg-amber-500',
    unknown: 'bg-zinc-500',
  }[status]

  return (
    <div
      className={cn(
        'group relative rounded-xl border widget-card widget-enter',
        'bg-card/50 backdrop-blur-md',
        'hover:bg-card/80',
        'hover:border-primary/20',
        service.column_span === 2 && 'col-span-2',
        service.column_span === 3 && 'col-span-3',
        service.column_span === 4 && 'col-span-4',
      )}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="text-primary/80">{icon}</div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{service.name}</span>
            {service.description && (
              <span className="text-[10px] text-muted-foreground/60 line-clamp-1">{service.description}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <div className={cn('size-2 rounded-full animate-pulse', statusColor)} />
          {/* External link */}
          {externalHref && (
            <a
              href={externalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Widget Data Blocks */}
      <div className="flex items-stretch justify-center divide-x divide-border/30 px-2 pb-3">
        {isLoading && !data ? (
          <div className="flex items-center justify-center py-4 w-full">
            <div className="flex gap-1">
              <div className="size-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:0ms]" />
              <div className="size-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:150ms]" />
              <div className="size-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        ) : data?.status === 'error' ? (
          <div className="flex items-center justify-center py-3 w-full text-xs text-red-400/80">
            {data.error ?? 'Connection failed'}
          </div>
        ) : data ? (
          Object.entries(data.fields).map(([key, value]) => (
            <WidgetBlock
              key={key}
              label={key.replace(/_/g, ' ')}
              value={value}
              highlight={key === 'running' || key === 'stopped' || key === 'up' || key === 'down' || key === 'failed'}
            />
          ))
        ) : (
          <div className="flex items-center justify-center py-3 w-full text-xs text-muted-foreground/50">
            No data available
          </div>
        )}
      </div>

      {/* Subtle bottom gradient accent */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 h-[2px] rounded-b-xl opacity-0 group-hover:opacity-100 transition-opacity',
          status === 'ok' && 'bg-gradient-to-r from-emerald-500/0 via-emerald-500/60 to-emerald-500/0',
          status === 'error' && 'bg-gradient-to-r from-red-500/0 via-red-500/60 to-red-500/0',
          status === 'unknown' && 'bg-gradient-to-r from-zinc-500/0 via-zinc-500/40 to-zinc-500/0',
        )}
      />
    </div>
  )
}

/* ── Service Group Section ───────────────────────────────────────── */

/** Stable id-safe slug for a group name, used to wire `aria-controls`. */
function groupPanelId(name: string): string {
  return `dashboard-group-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`
}

function ServiceGroupSection({
  group,
  data,
  isLoading,
  dataFreshness,
  collapsed,
  onToggleCollapsed,
}: {
  group: ServiceGroup
  data: Record<string, WidgetData>
  isLoading: boolean
  dataFreshness: DataFreshness
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const panelId = groupPanelId(group.name)

  const visibleServices = group.services.filter((s) => s.visible)

  return (
    <div className="mb-6">
      <button
        type="button"
        className="flex items-center gap-2 mb-3 group/header cursor-pointer"
        aria-expanded={!collapsed}
        aria-controls={panelId}
        onClick={onToggleCollapsed}
      >
        {collapsed ? (
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground group-hover/header:text-foreground transition-colors">
          {group.name}
        </h2>
        <span className="text-[10px] text-muted-foreground/50">
          {visibleServices.length} {visibleServices.length === 1 ? 'service' : 'services'}
        </span>
      </button>

      {!collapsed && (
        <div
          id={panelId}
          className={cn(
            'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 transition-opacity',
            dataFreshness !== 'fresh' && 'opacity-60',
          )}
          aria-describedby={dataFreshness !== 'fresh' ? DATA_FRESHNESS_BANNER_ID : undefined}
        >
          {visibleServices.map((service) => (
            <WidgetCard key={service.id} service={service} data={data[service.id]} isLoading={isLoading} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Main Dashboard View ─────────────────────────────────────────── */

export default function DashboardView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [columns, setColumns] = useState(4)
  const [cardSize, setCardSize] = useState('medium')
  const [theme, setTheme] = useState('system')
  const [refreshInterval, setRefreshInterval] = useState(30)
  // GOC-29: never render stale WebSocket data as if it were confidently
  // live (program charter -- "never fabricate state"). Starts 'fresh'
  // because the very first render is backed by a just-completed REST fetch,
  // which is itself current data, not a stale replay -- the ordinary "still
  // connecting" window before the socket opens is already communicated by
  // the header's Live/Polling badge and does not need an alarming banner.
  // Becomes 'reset' the moment a message's `stream_id` differs from the
  // previously-seen one (a forced disconnect => a genuine, undeliverable gap
  // for this endpoint, since it has no replay/cursor -- see the
  // wire-protocol comment below), back to 'fresh' on the next message of
  // that new stream, and 'stale' the instant a connection that HAD gone live
  // drops (a socket that never managed to open once yet is "still
  // connecting", not "lost").
  const [dataFreshness, setDataFreshness] = useState<DataFreshness>('fresh')
  const wsRef = useRef<WebSocket | null>(null)
  const lastStreamIdRef = useRef<string | null>(null)
  const everLiveRef = useRef(false)
  const queryClient = useQueryClient()
  // BUG-019 (GOC-29, subscription-scoped fetch): per-group collapse state
  // lifted out of `ServiceGroupSection` so this component can compute which
  // widget ids are actually on screen and tell `/ws/dashboard` to stop
  // pushing data for the rest. Keyed by group name; a name absent here
  // falls back to the server-supplied `group.collapsed` default.
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({})
  const isGroupCollapsed = (group: ServiceGroup): boolean => collapsedOverrides[group.name] ?? group.collapsed
  const visibleWidgetIdsRef = useRef<string[]>([])
  const lastSentSubscriptionKeyRef = useRef<string | null>(null)

  // Fetch full dashboard (layout + data) on mount
  const {
    data: dashboardData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['dashboard-full'],
    queryFn: () => fetchValidated('/api/dashboard/full', dashboardFullSchema),
    refetchInterval: 30000,
    staleTime: 10000,
  })

  // WebSocket connection for real-time updates.
  //
  // BUG-019 (GOC-29): the frontend-only half (jittered exponential backoff +
  // connection-generation guard) landed first. This closes the backend half
  // that left open: `/ws/dashboard` (`agent_webui/server.py::_dashboard_ws`)
  // now carries `stream_id` (minted fresh per accepted connection) and
  // `sequence` (monotonic within that connection) on every message. The
  // endpoint still has no durable backlog to replay -- each push is a fresh
  // full poll, not a delta against an event log -- so a reconnect can never
  // resume a cursor; `stream_id` is what lets this client tell a genuine
  // reconnect-after-gap apart from an ordinary periodic update instead of
  // silently treating a fresh snapshot as an in-sequence continuation.
  // Three things are fixed here:
  //   1. Reconnect used a flat, un-jittered 5000ms retry -- every client
  //      that lost the connection at the same moment (a single dashboard
  //      pod restart affects all of them at once) would reconnect in
  //      lockstep, a thundering-herd pattern BD-019 explicitly calls out
  //      ("exponential jittered reconnect"). Replaced with exponential
  //      backoff (1s -> 30s cap) plus +/-30% jitter, reset to the base delay
  //      on every successful `onopen`.
  //   2. There was no guard against a stale/duplicate message from a
  //      SUPERSEDED socket landing after a newer connection already took
  //      over (e.g. the old socket's `onmessage`/`onclose` firing after
  //      `connect()` already opened a replacement following a forced
  //      disconnect) -- each socket now closes over its own connection
  //      generation and is ignored once a newer generation exists, so a
  //      late-arriving stale message can never overwrite fresher data.
  //   3. A dropped connection previously left the widget grid showing old
  //      numbers with no visual change beyond a small header badge --
  //      "frozen but plausible" data, which the program charter forbids.
  //      `dataFreshness` now degrades to 'stale' the instant the socket
  //      closes and to 'reset' the instant a reconnect's `stream_id` proves
  //      a gap, and both states dim the widget grid and announce themselves
  //      through a live region (`DATA_FRESHNESS_BANNER_ID`) instead of
  //      staying silent.
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/dashboard`

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout>
    let reconnectDelayMs: number = RECONNECT_BASE_DELAY_MS
    const generation = new ConnectionGeneration()
    let disposed = false

    const scheduleReconnect = () => {
      if (disposed) return
      reconnectTimer = setTimeout(connect, jitteredReconnectDelayMs(reconnectDelayMs))
      reconnectDelayMs = nextBackoffDelayMs(reconnectDelayMs)
    }

    const connect = () => {
      if (disposed) return
      const myGeneration = generation.next()

      try {
        ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (!generation.isCurrent(myGeneration)) return
          setIsConnected(true)
          everLiveRef.current = true
          // BUG-019: a fresh connection starts unfiltered server-side until
          // told otherwise -- tell it immediately which widgets are already
          // on screen instead of taking one full unscoped push first.
          ws?.send(JSON.stringify({ type: 'subscribe', widget_ids: visibleWidgetIdsRef.current }))
          // A confirmed connection resets the backoff -- a run of failures
          // shouldn't keep the delay elevated after recovery.
          reconnectDelayMs = RECONNECT_BASE_DELAY_MS
        }

        ws.onmessage = (event) => {
          // Ignore anything from a socket a newer `connect()` has already
          // superseded (BUG-019 duplicate/stale guard).
          if (!generation.isCurrent(myGeneration)) return
          try {
            const msg = JSON.parse(event.data as string) as {
              type?: string
              data?: Record<string, WidgetData>
              stream_id?: string
              sequence?: number
            }
            if (msg.type === 'update' || msg.type === 'snapshot') {
              const incomingStreamId = typeof msg.stream_id === 'string' ? msg.stream_id : null
              // A `stream_id` different from the last one this client saw
              // proves, structurally, that whatever changed between the two
              // was never delivered -- the server mints a fresh id per
              // connection because this endpoint has no backlog to resume
              // from (see the wire-protocol comment above `_dashboard_ws`).
              // `lastStreamIdRef.current === null` means this is the very
              // first stream this tab has ever seen, which is not a gap.
              const isReconnectGap =
                incomingStreamId !== null &&
                lastStreamIdRef.current !== null &&
                incomingStreamId !== lastStreamIdRef.current
              if (incomingStreamId !== null) lastStreamIdRef.current = incomingStreamId
              setDataFreshness(isReconnectGap ? 'reset' : 'fresh')
              queryClient.setQueryData(
                ['dashboard-full'],
                (old: { layout: DashboardLayout; data: Record<string, WidgetData> } | undefined) => {
                  if (!old) return old
                  return {
                    ...old,
                    data: { ...old.data, ...(msg.data ?? {}) },
                  }
                },
              )
            }
          } catch {
            // Ignore parse errors
          }
        }

        ws.onclose = () => {
          if (!generation.isCurrent(myGeneration)) return
          setIsConnected(false)
          // GOC-29: the connection is gone -- whatever is on screen may
          // already be out of date. Degrade immediately rather than let the
          // widget grid keep presenting the last-known numbers as current.
          // Only applies once the socket has actually gone live at least
          // once; a still-connecting first attempt is not a "dropped"
          // connection and is already communicated by the header badge.
          if (everLiveRef.current) setDataFreshness('stale')
          wsRef.current = null
          scheduleReconnect()
        }

        ws.onerror = () => {
          if (!generation.isCurrent(myGeneration)) return
          ws?.close()
        }
      } catch {
        if (generation.isCurrent(myGeneration)) scheduleReconnect()
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    }
  }, [queryClient])

  // Filter services by search query. D-WUI-8: `dashboardData` (now validated
  // by `dashboardFullSchema` above) genuinely always carries a full `layout`
  // once present, so guarding only `dashboardData` itself is correct -- the
  // bug this used to hit was that the old code TRUSTED that same shape via a
  // bare type assertion instead of actually checking it.
  const filteredGroups =
    dashboardData?.layout.groups
      .map((group) => ({
        ...group,
        services: group.services.filter(
          (s) =>
            !searchQuery ||
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.widget_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.category.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
      }))
      .filter((g) => g.services.length > 0) ?? []

  // BUG-019 (GOC-29, subscription-scoped fetch): exactly the widget ids
  // rendered right now -- a collapsed group or one the search query hid
  // contributes none. Re-sent to `/ws/dashboard` on every change so a
  // collapsed section's widgets stop being pushed instead of arriving on
  // every push and being discarded client-side after the fact.
  const visibleWidgetIds = filteredGroups
    .filter((group) => !isGroupCollapsed(group))
    .flatMap((group) => group.services.filter((s) => s.visible).map((s) => s.id))
  const visibleWidgetIdsKey = [...visibleWidgetIds].sort().join(',')

  useEffect(() => {
    // Only the SET of visible ids matters, not array identity -- `filteredGroups`
    // is a new array every render, so guard on the sorted key and bail out
    // rather than re-sending the identical subscription on every unrelated
    // state change.
    if (lastSentSubscriptionKeyRef.current === visibleWidgetIdsKey) return
    lastSentSubscriptionKeyRef.current = visibleWidgetIdsKey
    visibleWidgetIdsRef.current = visibleWidgetIds
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', widget_ids: visibleWidgetIds }))
    }
  }, [visibleWidgetIds, visibleWidgetIdsKey])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Dashboard Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <LayoutGrid className="size-5 text-primary" />
          <h1 className="text-lg font-bold">Agent-OS Dashboard</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search services..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
              }}
              className="h-8 w-56 rounded-lg border border-border/50 bg-background/50 pl-8 pr-3 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
            />
          </div>

          {/* Connection status -- GOC-29: role="status" + aria-live so a
              screen reader hears "Live" <-> "Polling" transitions instead of
              relying on the icon color alone. */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
            {isConnected ? (
              <>
                <Wifi className="size-3.5 text-emerald-500" aria-hidden="true" />
                <span className="text-emerald-500">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="size-3.5 text-amber-500" aria-hidden="true" />
                <span className="text-amber-500">Polling</span>
              </>
            )}
          </div>

          {/* Refresh */}
          <button
            onClick={() => {
              void refetch()
            }}
            className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            title="Refresh all"
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </button>

          {/* Settings */}
          <DashboardSettings
            columns={columns}
            cardSize={cardSize}
            theme={theme}
            refreshInterval={refreshInterval}
            onColumnsChange={setColumns}
            onCardSizeChange={setCardSize}
            onThemeChange={setTheme}
            onRefreshIntervalChange={setRefreshInterval}
          />
        </div>
      </div>

      {/* GOC-29: explicit, announced degraded-data state -- never let the
          widget grid keep showing old numbers with no visible or
          screen-reader-audible signal that they may be wrong. 'stale' means
          the socket is down (banner is advisory, `aria-live="polite"`);
          'reset' means a reconnect proved a gap occurred (data was just
          replaced by a fresh snapshot and may have skipped updates, so it is
          announced immediately, `aria-live="assertive"`). */}
      {dataFreshness !== 'fresh' && (
        <div
          id={DATA_FRESHNESS_BANNER_ID}
          role="status"
          aria-live={dataFreshness === 'reset' ? 'assertive' : 'polite'}
          className={cn(
            'px-6 py-1.5 text-xs border-b',
            dataFreshness === 'reset'
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
              : 'bg-muted/50 text-muted-foreground border-border/40',
          )}
        >
          {dataFreshness === 'reset'
            ? 'Reconnected after a dropped connection — some updates may have been missed. Showing the latest snapshot.'
            : 'Connection lost — the data below may be out of date while reconnecting.'}
        </div>
      )}

      {/* Dashboard Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative">
              <div className="size-12 rounded-full border-2 border-primary/20 animate-pulse" />
              <div className="absolute inset-0 size-12 rounded-full border-t-2 border-primary animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground animate-pulse">Loading dashboard...</p>
          </div>
        ) : filteredGroups.length === 0 ? (
          // D-W6-9: this used to be the ENTIRE landing experience whenever no
          // services.yaml/mcp_config.json was populated -- a literal, static
          // "No services configured" placeholder with no real data behind it.
          // DefaultOverviewPanel replaces it with a zero-configuration summary
          // built from surfaces that are already reachable (prompts/tools/
          // models/KG/health), never seeded/fabricated data.
          <DefaultOverviewPanel />
        ) : (
          filteredGroups.map((group) => (
            <ServiceGroupSection
              key={group.name}
              group={group}
              data={dashboardData?.data ?? {}}
              isLoading={isLoading}
              dataFreshness={dataFreshness}
              collapsed={isGroupCollapsed(group)}
              onToggleCollapsed={() => {
                setCollapsedOverrides((prev) => ({ ...prev, [group.name]: !isGroupCollapsed(group) }))
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}
