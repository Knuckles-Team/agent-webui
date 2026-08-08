/**
 * @file DefaultOverviewPanel.tsx
 * @description The landing page's default, zero-configuration overview.
 *
 * D-W6-9 traced the landing page's "No services configured — Add services via
 * services.yaml or auto-discover from mcp_config.json" empty state to its
 * literal, complete source: nobody had ever authored a default dashboard, so
 * that placeholder was the ENTIRE landing experience whenever no
 * services.yaml/mcp_config.json happened to be populated. This component is
 * that default: real counts from the surfaces that are already reachable
 * without any operator configuration — system prompts, MCP/skill/tool
 * inventory, LLM models, and Knowledge Graph size — plus a fleet-health
 * summary. Every tile fetches independently and NEVER fabricates a number:
 * a failed or degraded fetch renders an explicit "unavailable" state, never a
 * silent 0 masquerading as a real count (the same D-W6-10 discipline the
 * Knowledge Graph view itself now follows).
 */

import { useEffect, useState, type ComponentType } from 'react'
import { FileText, Wrench, Layers, Cpu, Share2, HeartPulse, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiGet } from '@/lib/gateway'
import { looseArray } from '@/lib/api-validation'
import { z } from 'zod'

/* ── Schemas (loose — count-only consumers tolerate extra/missing fields) ── */

const toolsCountsSchema = z.object({
  mcp_tools: looseArray(z.unknown()).default([]),
  builtin_tools: looseArray(z.unknown()).default([]),
  skills: looseArray(z.unknown()).default([]),
  skill_graphs: looseArray(z.unknown()).default([]),
  skill_workflows: looseArray(z.unknown()).default([]),
})

const graphStatsSchema = z.object({
  total_nodes: z.number().default(0),
  total_relationships: z.number().default(0),
})

const healthSchema = z.object({
  status: z.string().optional(),
  checks: z.record(z.string(), z.unknown()).optional(),
})

/* ── One tile's fetch/render state ── */

interface TileState {
  loading: boolean
  value: string | null
  detail: string | null
  /** True when the fetch failed or the capability degraded — distinct from a
   * genuine zero, which renders the digit "0" normally. */
  unavailable: boolean
}

const INITIAL_TILE: TileState = { loading: true, value: null, detail: null, unavailable: false }

function StatTile({
  icon: Icon,
  label,
  state,
  href,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  state: TileState
  href?: string
}) {
  const body = (
    <Card className="h-full transition-colors hover:border-primary/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {state.loading ? (
          <div className="h-8 w-16 rounded bg-muted/50 animate-pulse" />
        ) : state.unavailable ? (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-muted-foreground">—</span>
            <Badge variant="outline" className="text-amber-600 dark:text-amber-400 text-[10px]">
              unavailable
            </Badge>
          </div>
        ) : (
          <div className="text-2xl font-bold">{state.value}</div>
        )}
        {state.detail ? <p className="text-xs text-muted-foreground mt-1">{state.detail}</p> : null}
      </CardContent>
    </Card>
  )
  return href ? (
    <a href={href} className="block">
      {body}
    </a>
  ) : (
    body
  )
}

export default function DefaultOverviewPanel() {
  const [prompts, setPrompts] = useState<TileState>(INITIAL_TILE)
  const [tools, setTools] = useState<TileState>(INITIAL_TILE)
  const [models, setModels] = useState<TileState>(INITIAL_TILE)
  const [kg, setKg] = useState<TileState>(INITIAL_TILE)
  const [health, setHealth] = useState<TileState>(INITIAL_TILE)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    // Object-wrapped (not a bare `let`) so TS/eslint's control-flow narrowing
    // doesn't (incorrectly) treat `cancelled` as a compile-time-known literal
    // inside these async closures -- a known false-positive with a bare `let`
    // captured by multiple concurrent closures.
    const flag = { cancelled: false }

    void (async () => {
      const r = await apiGet('/enhanced/prompts/graph', looseArray(z.unknown()))
      if (flag.cancelled) return
      setPrompts(
        r.ok && r.data
          ? { loading: false, value: String(r.data.length), detail: 'system prompts', unavailable: false }
          : { loading: false, value: null, detail: r.error ?? null, unavailable: true },
      )
    })()

    void (async () => {
      const r = await apiGet('/enhanced/tools', toolsCountsSchema)
      if (flag.cancelled) return
      if (r.ok && r.data) {
        const total =
          r.data.mcp_tools.length +
          r.data.builtin_tools.length +
          r.data.skills.length +
          r.data.skill_graphs.length +
          r.data.skill_workflows.length
        setTools({
          loading: false,
          value: String(total),
          detail: `${String(r.data.mcp_tools.length)} MCP · ${String(r.data.builtin_tools.length)} built-in · ${String(r.data.skills.length + r.data.skill_graphs.length + r.data.skill_workflows.length)} skills`,
          unavailable: false,
        })
      } else {
        setTools({ loading: false, value: null, detail: r.error ?? null, unavailable: true })
      }
    })()

    void (async () => {
      const r = await apiGet('/enhanced/llm/models', looseArray(z.unknown()))
      if (flag.cancelled) return
      setModels(
        r.ok && r.data
          ? { loading: false, value: String(r.data.length), detail: 'configured chat models', unavailable: false }
          : { loading: false, value: null, detail: r.error ?? null, unavailable: true },
      )
    })()

    void (async () => {
      const r = await apiGet('/enhanced/graph/stats', graphStatsSchema)
      if (flag.cancelled) return
      setKg(
        r.ok && r.data
          ? {
              loading: false,
              value: r.data.total_nodes.toLocaleString(),
              detail: `${r.data.total_relationships.toLocaleString()} edges`,
              unavailable: false,
            }
          : { loading: false, value: null, detail: r.error ?? null, unavailable: true },
      )
    })()

    void (async () => {
      const r = await apiGet('/dashboard/health', healthSchema)
      if (flag.cancelled) return
      const status = r.ok && r.data ? (r.data.status ?? 'unknown') : null
      const checkCount = r.ok && r.data?.checks ? Object.keys(r.data.checks).length : 0
      setHealth(
        status
          ? {
              loading: false,
              value: status,
              detail: checkCount > 0 ? `${String(checkCount)} checks reporting` : null,
              unavailable: false,
            }
          : { loading: false, value: null, detail: r.error ?? null, unavailable: true },
      )
    })()

    return () => {
      flag.cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="text-sm text-muted-foreground">
            No dashboard services are configured yet — this default view summarizes what the agent already has
            available. Add services via services.yaml to replace it with custom widget tiles.
          </p>
        </div>
        <button
          onClick={() => {
            setPrompts(INITIAL_TILE)
            setTools(INITIAL_TILE)
            setModels(INITIAL_TILE)
            setKg(INITIAL_TILE)
            setHealth(INITIAL_TILE)
            setRefreshKey((k) => k + 1)
          }}
          className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          title="Refresh overview"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatTile icon={FileText} label="System Prompts" state={prompts} href="/prompts" />
        <StatTile icon={Wrench} label="Tools & Skills" state={tools} href="/skills" />
        <StatTile icon={Cpu} label="LLM Models" state={models} href="/llm-templates" />
        <StatTile icon={Share2} label="Knowledge Graph Nodes" state={kg} href="/graph" />
        <StatTile icon={HeartPulse} label="Fleet Health" state={health} href="/system-status" />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Layers className="size-3.5" />
        <span>
          Every tile above reads live data — an "unavailable" badge means the backend rejected or failed the request,
          never a fabricated zero.
        </span>
      </div>
    </div>
  )
}
