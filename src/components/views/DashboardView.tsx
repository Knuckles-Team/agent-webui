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

function ServiceGroupSection({
  group,
  data,
  isLoading,
}: {
  group: ServiceGroup
  data: Record<string, WidgetData>
  isLoading: boolean
}) {
  const [collapsed, setCollapsed] = useState(group.collapsed)

  const visibleServices = group.services.filter((s) => s.visible)

  return (
    <div className="mb-6">
      <button
        className="flex items-center gap-2 mb-3 group/header cursor-pointer"
        onClick={() => {
          setCollapsed(!collapsed)
        }}
      >
        {collapsed ? (
          <ChevronRight className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground group-hover/header:text-foreground transition-colors">
          {group.name}
        </h2>
        <span className="text-[10px] text-muted-foreground/50">
          {visibleServices.length} {visibleServices.length === 1 ? 'service' : 'services'}
        </span>
      </button>

      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
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
  const wsRef = useRef<WebSocket | null>(null)
  const queryClient = useQueryClient()

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

  // WebSocket connection for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/dashboard`

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          setIsConnected(true)
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as { type?: string; data?: Record<string, WidgetData> }
            if (msg.type === 'update' || msg.type === 'snapshot') {
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
          setIsConnected(false)
          wsRef.current = null
          reconnectTimer = setTimeout(connect, 5000)
        }

        ws.onerror = () => {
          ws?.close()
        }
      } catch {
        reconnectTimer = setTimeout(connect, 5000)
      }
    }

    connect()

    return () => {
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

          {/* Connection status */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isConnected ? (
              <>
                <Wifi className="size-3.5 text-emerald-500" />
                <span className="text-emerald-500">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="size-3.5 text-amber-500" />
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
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <LayoutGrid className="size-12 opacity-20" />
            <p className="text-sm">No services configured</p>
            <p className="text-xs opacity-50">Add services via services.yaml or auto-discover from mcp_config.json</p>
          </div>
        ) : (
          filteredGroups.map((group) => (
            <ServiceGroupSection
              key={group.name}
              group={group}
              data={dashboardData?.data ?? {}}
              isLoading={isLoading}
            />
          ))
        )}
      </div>
    </div>
  )
}
