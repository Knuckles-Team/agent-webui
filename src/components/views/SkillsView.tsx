import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { z } from 'zod'
import {
  Wrench,
  Code,
  Zap,
  Network,
  GitBranch,
  RefreshCw,
  Search,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Sliders,
  Layers,
  AlertTriangle,
  HelpCircle,
  Plus,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { fetchValidated, ApiError, looseArray } from '@/lib/api-validation'
import { api } from '@/lib/api'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'
import { SchemaActionForm } from '@/components/capabilities/SchemaActionForm'
import type { JsonSchema } from '@/lib/capability-forms'
import type { PageContextEnvelope } from '@/lib/page-context'

interface MCPTool {
  name: string
  type: string
  status: string
  enabled: boolean
  tool_count?: number
  /** Stated reason a server is `unavailable` (e.g. "stdio transport is not
   * permitted in this process") -- `null`/absent when healthy. Never treat
   * an unavailable server with no `error` as healthy; the backend always
   * sets one when `status === 'unavailable'`. */
  error?: string | null
}

interface BuiltinTool {
  name: string
  type: string
  file_path: string
  status: string
  enabled: boolean
}

// `runnable` / `resource_type` / `kg_classified` come from the backend's
// live KG lookup (GOC-60-W06 / E7: `CallableResource.resource_type` vs a
// describe-only `WorkflowDefinition` node) -- NOT from filesystem path.
// `resource_type` is `null` and `kg_classified` is `false` for a skill the
// KG has no record of yet (surfaced honestly instead of guessed).
interface Skill {
  id: string
  name: string
  description?: string
  enabled: boolean
  tags: string[]
  domain?: string
  type: string
  runnable?: boolean
  resource_type?: string | null
  kg_classified?: boolean
}

interface SkillGraph {
  id: string
  name: string
  type: string
  file_path: string
  enabled: boolean
  domain?: string
  tags?: string[]
}

interface SkillWorkflow {
  id: string
  name: string
  type: string
  file_path: string
  enabled: boolean
  domain?: string
  tags?: string[]
  runnable?: boolean
  resource_type?: string | null
  kg_classified?: boolean
}

// GOC-60-W06b: the live filesystem-vs-KG reconciliation. Computed fresh by
// the backend on every `/api/enhanced/tools` call so a drift between what's
// on disk and what the KG has actually typed as runnable is always visible
// here, not just discoverable via a one-off script.
interface SkillClassificationSummary {
  source: string
  kg_reachable: boolean
  filesystem_skill_md_count: number
  kg_agent_skill_count: number
  kg_workflow_definition_count: number
  runnable_count: number
  describe_only_count: number
  unclassified_count: number
}

/** Why `mcp_tools` looks the way it does -- distinguishes a genuinely empty
 * fleet from a degraded/missing data source (GOC-60 lane authority/invariant
 * 1: a missing source is an ERROR/DEGRADED state, never an indistinguishable
 * silent `[]`). `error` is `null` for a healthy result (including a real
 * "this fleet has zero servers" answer); non-null names what was missing. */
interface MCPStatus {
  source: string
  error: string | null
}

interface ToolsData {
  mcp_tools: MCPTool[]
  mcp_status: MCPStatus
  builtin_tools: BuiltinTool[]
  // Includes unclassified skills (`kg_classified: false`) alongside every
  // other agent skill -- there is no separate fourth bucket. `RunnabilityBadge`
  // flags an unclassified entry in place; `ClassifySkillControl` lets it be
  // classified from right there.
  skills: Skill[]
  skill_graphs: SkillGraph[]
  skill_workflows: SkillWorkflow[]
  skill_classification: SkillClassificationSummary
}

interface LiveMCPTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  enabled: boolean
}

const mcpToolSchema: z.ZodType<MCPTool> = z.object({
  name: z.string(),
  type: z.string(),
  status: z.string(),
  enabled: z.boolean(),
  // Backend never sends `command`/`args` -- those are per-process launch
  // config for a static local mcp_config.json, not something the KG's
  // discovered-fleet catalog carries (D-W5WR-4 follow-up fix). Requiring
  // them here silently discarded EVERY mcp_tools entry (a single item
  // failing z.array(mcpToolSchema) fails the whole array, which fails the
  // whole toolsDataSchema, which fails the whole SkillsView fetch) the
  // moment mcp_tools stopped being empty -- masked until now only because
  // it was always `[]`.
  tool_count: z.number().optional(),
  error: z.string().nullable().optional(),
})
const builtinToolSchema: z.ZodType<BuiltinTool> = z.object({
  name: z.string(),
  type: z.string(),
  file_path: z.string(),
  status: z.string(),
  enabled: z.boolean(),
})
const skillSchema: z.ZodType<Skill> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  tags: looseArray(z.string()),
  domain: z.string().optional(),
  type: z.string(),
  runnable: z.boolean().optional(),
  resource_type: z.string().nullable().optional(),
  kg_classified: z.boolean().optional(),
})
const skillGraphSchema: z.ZodType<SkillGraph> = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  file_path: z.string(),
  enabled: z.boolean(),
  domain: z.string().optional(),
  tags: looseArray(z.string()).optional(),
})
const skillWorkflowSchema: z.ZodType<SkillWorkflow> = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  file_path: z.string(),
  enabled: z.boolean(),
  domain: z.string().optional(),
  tags: looseArray(z.string()).optional(),
  runnable: z.boolean().optional(),
  resource_type: z.string().nullable().optional(),
  kg_classified: z.boolean().optional(),
})
const skillClassificationSummarySchema: z.ZodType<SkillClassificationSummary> = z.object({
  source: z.string(),
  kg_reachable: z.boolean(),
  filesystem_skill_md_count: z.number(),
  kg_agent_skill_count: z.number(),
  kg_workflow_definition_count: z.number(),
  runnable_count: z.number(),
  describe_only_count: z.number(),
  unclassified_count: z.number(),
})
const mcpStatusSchema: z.ZodType<MCPStatus> = z.object({
  source: z.string(),
  error: z.string().nullable(),
})
const toolsDataSchema: z.ZodType<ToolsData> = z.object({
  mcp_tools: looseArray(mcpToolSchema),
  mcp_status: mcpStatusSchema,
  builtin_tools: looseArray(builtinToolSchema),
  skills: looseArray(skillSchema),
  skill_graphs: looseArray(skillGraphSchema),
  skill_workflows: looseArray(skillWorkflowSchema),
  skill_classification: skillClassificationSummarySchema,
})

// Exported for the zod round-trip test (GOC-60-W06c) -- proves `domain`/
// `tags`/`runnable` actually survive backend-shaped JSON through the zod
// boundary instead of being silently stripped by key-shape mismatch.
export { skillSchema, skillGraphSchema, skillWorkflowSchema, toolsDataSchema }

/** Group items by `domain` (falling back to "Uncategorized"), sorted by
 * domain name. GOC-60-W06d: every cognitive surface is organized by domain
 * instead of one flat unsectioned list. */
function groupByDomain<T extends { domain?: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = item.domain && item.domain.trim() !== '' ? item.domain : 'Uncategorized'
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      groups.set(key, [item])
    }
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}

/** Free-text match against name, domain, and tags -- keeps search working
 * across the new grouped-by-domain layout (GOC-60-W06d). */
function matchesSearch(query: string, name: string, domain?: string, tags?: string[]): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (name.toLowerCase().includes(q)) return true
  if (domain?.toLowerCase().includes(q)) return true
  if (tags?.some((t) => t.toLowerCase().includes(q))) return true
  return false
}

/** Structural shape shared by everything a cognitive-registry box renders
 * (Skill / SkillGraph / SkillWorkflow items, including an unclassified
 * skill -- it is a Skill, not a separate shape). */
interface CognitiveItem {
  id: string
  name: string
  enabled: boolean
  domain?: string
  tags?: string[]
  description?: string
  file_path?: string
  runnable?: boolean
  resource_type?: string | null
  kg_classified?: boolean
}

/** Shows runnability explicitly (GOC-60-W06a): a describe-only
 * `WorkflowDefinition` is visibly distinguished from a runnable
 * `CallableResource(AGENT_SKILL)`, and a skill whose `skill_type` the
 * catalog does not recognize reads as "Unclassified" -- flagged in place
 * among the other Agent Skills rather than hidden in a separate group or
 * silently guessed one way or the other. Renders nothing for surfaces with
 * no resource-type concept at all (Skill Graphs -- `resource_type` is
 * `undefined`, not `null`, on that shape). */
function RunnabilityBadge({ item }: { item: CognitiveItem }) {
  if (item.resource_type === undefined) return null
  if (!item.kg_classified) {
    return (
      <Badge
        variant="outline"
        className="text-[8px] font-bold border-amber-500/40 text-amber-400 bg-amber-500/10 gap-0.5"
      >
        <HelpCircle className="size-2.5" />
        Unclassified
      </Badge>
    )
  }
  return item.runnable ? (
    <Badge variant="outline" className="text-[8px] font-bold border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
      Runnable
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[8px] font-bold border-sky-500/40 text-sky-400 bg-sky-500/10">
      Describe-only
    </Badge>
  )
}

/** One cognitive-registry panel, organized by `domain` (GOC-60-W06d) instead
 * of one flat unsectioned list. */
function CognitiveBox({
  icon: Icon,
  iconClassName,
  title,
  description,
  groups,
  totalCount,
  emptyLabel,
  onToggle,
  renderSecondary,
  renderClassifyAction,
}: {
  icon: LucideIcon
  iconClassName: string
  title: string
  description: string
  groups: [string, CognitiveItem[]][]
  totalCount: number
  emptyLabel: string
  onToggle: (item: CognitiveItem) => void
  renderSecondary: (item: CognitiveItem) => ReactNode
  /** Optional classify affordance rendered per item -- only the Agent
   * Skills box passes this; it returns `null` itself for an already-
   * classified item, so nothing else changes. */
  renderClassifyAction?: (item: CognitiveItem) => ReactNode
}) {
  return (
    <div className="space-y-4 border border-border/40 rounded-xl bg-card/40 p-4">
      <div className="flex items-center gap-2 border-b border-border/20 pb-3 mb-2">
        <Icon className={`size-5 ${iconClassName}`} />
        <div>
          <h3 className="font-bold text-sm text-foreground">{title}</h3>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary" className="ml-auto px-1.5 text-[10px] bg-muted/40">
          {totalCount}
        </Badge>
      </div>

      <ScrollArea className="h-[calc(100vh-27rem)] pr-2">
        {totalCount === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          <div className="space-y-4">
            {groups.map(([domain, items]) => (
              <div key={domain} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{domain}</span>
                  <span className="text-[9px] text-muted-foreground/60">({items.length})</span>
                </div>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-lg border border-border/30 bg-muted/5 hover:border-emerald-500/20 transition-all flex flex-col justify-between space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-bold text-xs text-foreground">{item.name}</span>
                        <button
                          onClick={() => {
                            onToggle(item)
                          }}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 transition-all ${
                            item.enabled
                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/10 border-red-500/20 text-red-400'
                          }`}
                        >
                          {item.enabled ? 'ON' : 'OFF'}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <RunnabilityBadge item={item} />
                        {item.tags?.slice(0, 3).map((t) => (
                          <Badge
                            key={t}
                            variant="secondary"
                            className="text-[8px] bg-muted/40 font-semibold scale-90 origin-left"
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                      {renderSecondary(item)}
                      {renderClassifyAction?.(item)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

const CLASSIFY_OPTIONS: { value: 'skill' | 'workflow' | 'graph'; label: string }[] = [
  { value: 'skill', label: 'Skill' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'graph', label: 'Skill Graph' },
]

/** Classify affordance for one unclassified Agent Skill card. Renders
 * nothing for an already-classified item -- `SkillsView` passes this to
 * EVERY item in the Agent Skills box, and it is this component's own job to
 * be a no-op unless `item.kg_classified === false`. Local `pending` state
 * only tracks the pending SELECT choice; nothing here ever claims the
 * classification took effect -- that comes back from the parent's own
 * refetch after a real, backend-confirmed persist (fail-closed: see
 * `handleClassifySkill`). A plain native `<select>` rather than the styled
 * Radix picker -- this compact per-card control needs none of its extra
 * behavior, and native keeps it trivially accessible/testable. */
function ClassifySkillControl({
  item,
  busy,
  onClassify,
}: {
  item: CognitiveItem
  busy: boolean
  onClassify: (item: CognitiveItem, skillType: 'skill' | 'workflow' | 'graph') => void
}) {
  const [pending, setPending] = useState<'skill' | 'workflow' | 'graph' | ''>('')
  if (item.kg_classified !== false) return null

  return (
    <div className="flex items-center gap-1.5 pt-1 border-t border-border/20 mt-1">
      <select
        aria-label={`Classify ${item.name}`}
        value={pending}
        disabled={busy}
        onChange={(e) => {
          setPending(e.target.value as 'skill' | 'workflow' | 'graph' | '')
        }}
        className="h-6 flex-1 min-w-0 rounded border border-border/40 bg-muted/20 text-[10px] px-1.5 text-foreground disabled:opacity-50"
      >
        <option value="">Classify as…</option>
        {CLASSIFY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[10px]"
        disabled={busy || !pending}
        onClick={() => {
          if (pending) onClassify(item, pending)
        }}
      >
        {busy ? <RefreshCw className="size-3 animate-spin" /> : 'Set'}
      </Button>
    </div>
  )
}

export default function SkillsView() {
  const [data, setData] = useState<ToolsData>({
    mcp_tools: [],
    mcp_status: { source: 'multiplexer', error: null },
    builtin_tools: [],
    skills: [],
    skill_graphs: [],
    skill_workflows: [],
    skill_classification: {
      source: 'kg_resource_type',
      kg_reachable: true,
      filesystem_skill_md_count: 0,
      kg_agent_skill_count: 0,
      kg_workflow_definition_count: 0,
      runnable_count: 0,
      describe_only_count: 0,
      unclassified_count: 0,
    },
  })
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'mcp' | 'builtin' | 'cognitive'>('mcp')
  const [sessionExpired, setSessionExpired] = useState(false)

  // Track expanded MCP servers and their loaded tools
  const [expandedMcp, setExpandedMcp] = useState<Record<string, boolean | undefined>>({})
  const [mcpTools, setMcpTools] = useState<Record<string, LiveMCPTool[] | undefined>>({})
  const [loadingMcpTools, setLoadingMcpTools] = useState<Record<string, boolean | undefined>>({})

  // MCP server add/edit -- schema-derived form (BUG-260 pattern: the fields
  // come from the backend's live JSON schema, never hand-listed here).
  const [mcpServerSchema, setMcpServerSchema] = useState<JsonSchema | null>(null)
  const [mcpServerDialog, setMcpServerDialog] = useState<{ mode: 'add' | 'edit'; name: string } | null>(null)
  const [mcpServerEditValues, setMcpServerEditValues] = useState<Record<string, unknown>>({})
  const [savingMcpServer, setSavingMcpServer] = useState(false)

  useEffect(() => {
    void fetchTools()
  }, [])

  const fetchTools = async () => {
    try {
      setLoading(true)
      const json = await fetchValidated('/api/enhanced/tools', toolsDataSchema)
      setSessionExpired(false)
      setData(json)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else {
        toast.error('Failed to connect to backend tools registry')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleToggleMcpServer = async (name: string, currentVal: boolean) => {
    try {
      const res = await fetch('/api/enhanced/tools/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mcp_server',
          id: name,
          enabled: !currentVal,
        }),
      })
      if (res.ok) {
        toast.success(`MCP Server '${name}' ${!currentVal ? 'enabled' : 'disabled'}`)
        void fetchTools()
      } else {
        toast.error('Failed to toggle MCP server')
      }
    } catch {
      toast.error('Error toggling MCP server')
    }
  }

  const openAddMcpServer = async () => {
    if (!mcpServerSchema) {
      try {
        const schema = await fetchValidated(
          '/api/enhanced/mcp/server-schema',
          z.record(z.string(), z.unknown()) as unknown as z.ZodType<JsonSchema>,
        )
        setMcpServerSchema(schema)
      } catch {
        toast.error('Could not load the MCP server form schema')
        return
      }
    }
    setMcpServerEditValues({})
    setMcpServerDialog({ mode: 'add', name: '' })
  }

  const openEditMcpServer = async (name: string) => {
    try {
      const [schema, current] = await Promise.all([
        mcpServerSchema
          ? Promise.resolve(mcpServerSchema)
          : fetchValidated(
              '/api/enhanced/mcp/server-schema',
              z.record(z.string(), z.unknown()) as unknown as z.ZodType<JsonSchema>,
            ),
        fetchValidated(
          `/api/enhanced/mcp/servers/${encodeURIComponent(name)}/config`,
          z.record(z.string(), z.unknown()),
        ),
      ])
      setMcpServerSchema(schema)
      setMcpServerEditValues(current)
    } catch {
      toast.error(`Could not load the current settings for '${name}'`)
      return
    }
    setMcpServerDialog({ mode: 'edit', name })
  }

  /** Page context the reused SchemaActionForm derives its prefill from. The
   * server's ``name`` isn't part of the config schema (it's the catalog KEY,
   * entered via its own field beside the form; see the dialog below) -- for
   * 'edit', every OTHER field is prefilled by pushing the server's current
   * config through ``filters`` (``contextualValue`` in capability-forms.ts
   * checks ``name in context.filters`` before any other source), the same
   * generic prefill seam capability actions already use for a fresh page
   * selection. */
  const mcpServerFormContext = (dialog: { mode: 'add' | 'edit'; name: string }): PageContextEnvelope => ({
    schemaVersion: '1.0',
    route: '/skills',
    view: 'mcp-server-' + dialog.mode,
    selection: [],
    filters: dialog.mode === 'edit' ? (mcpServerEditValues as unknown as PageContextEnvelope['filters']) : {},
    allowedActions: [],
    capturedAt: new Date().toISOString(),
  })

  const submitMcpServer = async (dialog: { mode: 'add' | 'edit'; name: string }, config: Record<string, unknown>) => {
    const name = dialog.name.trim()
    if (!name) {
      toast.error('Give the MCP server a name')
      return
    }
    setSavingMcpServer(true)
    try {
      if (dialog.mode === 'add') {
        const res = await fetch('/api/enhanced/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, config }),
        })
        if (!res.ok) {
          toast.error('Failed to add MCP server -- check the command/url and try again')
          return
        }
        toast.success(`MCP server '${name}' added`)
      } else {
        const res = await fetch(`/api/enhanced/mcp/servers/${encodeURIComponent(dialog.name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config }),
        })
        if (!res.ok) {
          toast.error('Failed to save MCP server changes')
          return
        }
        toast.success(`MCP server '${dialog.name}' updated`)
      }
      setMcpServerDialog(null)
      await fetchTools()
    } catch {
      toast.error('Error saving MCP server')
    } finally {
      setSavingMcpServer(false)
    }
  }

  /** Destructive by nature: the default removal is a REVERSIBLE soft-disable
   * (the entry stays in the catalog file, restorable via edit); permanently
   * deleting the entry requires a second, explicit confirmation. */
  const handleDeleteMcpServer = async (name: string) => {
    if (!window.confirm(`Disable MCP server '${name}'? It stays in the catalog and can be re-enabled later.`)) return
    const hard = window.confirm(
      `Also permanently remove '${name}' from the catalog instead of just disabling it? This cannot be undone from the UI.`,
    )
    try {
      const res = await fetch(`/api/enhanced/mcp/servers/${encodeURIComponent(name)}${hard ? '?hard=true' : ''}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error(`Failed to remove '${name}'`)
        return
      }
      toast.success(hard ? `MCP server '${name}' permanently removed` : `MCP server '${name}' disabled`)
      await fetchTools()
    } catch {
      toast.error(`Error removing '${name}'`)
    }
  }

  const handleToggleBuiltin = async (name: string, currentVal: boolean) => {
    try {
      const res = await fetch('/api/enhanced/tools/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'builtin_tool',
          id: name,
          enabled: !currentVal,
        }),
      })
      if (res.ok) {
        toast.success(`Built-in tool '${name}' ${!currentVal ? 'enabled' : 'disabled'}`)
        void fetchTools()
      } else {
        toast.error('Failed to toggle tool')
      }
    } catch {
      toast.error('Error toggling tool')
    }
  }

  const handleToggleCognitive = async (
    // An unclassified item lives in `data.skills` alongside every other
    // agent skill (no separate bucket), and its toggle preference is keyed
    // under the same `skill` namespace regardless of `kg_classified`
    // (api_extensions.py's `get_toggle_state` call is identical either way).
    type: 'skill' | 'skill_graph' | 'skill_workflow',
    id: string,
    currentVal: boolean,
  ) => {
    try {
      const res = await fetch('/api/enhanced/tools/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          id,
          enabled: !currentVal,
        }),
      })
      if (res.ok) {
        toast.success(`Cognitive asset updated successfully`)
        void fetchTools()
      } else {
        toast.error('Failed to update asset status')
      }
    } catch {
      toast.error('Error saving toggle status')
    }
  }

  const [classifyingId, setClassifyingId] = useState<string | null>(null)

  /** Classify an unclassified skill and persist the choice. Fail-closed: a
   * toast only ever claims success when the backend's own `persisted` field
   * says so -- never optimistically, and the list is always refetched from
   * the real backend state afterward rather than patched locally, so the
   * badge only ever reflects what is actually on record. */
  const handleClassifySkill = async (item: CognitiveItem, skillType: 'skill' | 'workflow' | 'graph') => {
    setClassifyingId(item.id)
    try {
      const result = await api.classifySkill(item.id, skillType)
      if (!result.persisted) {
        toast.error(result.reason ?? `Could not classify '${item.name}'`)
        return
      }
      if (result.persisted_to_source_file) {
        toast.success(`'${item.name}' classified as ${result.classification} -- written to its SKILL.md.`)
      } else {
        toast.success(
          `'${item.name}' classified as ${result.classification} -- the skills source is read-only here, ` +
            'so the choice was saved as a durable override that applies on every future sync.',
        )
      }
      void fetchTools()
    } catch {
      toast.error(`Error classifying '${item.name}'`)
    } finally {
      setClassifyingId(null)
    }
  }

  const handleToggleMcpTool = async (serverName: string, toolName: string, currentVal: boolean) => {
    try {
      const res = await fetch('/api/enhanced/tools/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mcp_tool',
          id: `${serverName}:${toolName}`,
          enabled: !currentVal,
        }),
      })
      if (res.ok) {
        toast.success(`Tool '${toolName}' ${!currentVal ? 'enabled' : 'disabled'}`)
        // Refresh local cache for this server
        void loadMcpTools(serverName)
      } else {
        toast.error('Failed to toggle tool status')
      }
    } catch {
      toast.error('Error toggling tool status')
    }
  }

  const loadMcpTools = async (serverName: string) => {
    try {
      setLoadingMcpTools((prev) => ({ ...prev, [serverName]: true }))
      const res = await fetch(`/api/enhanced/mcp/servers/${encodeURIComponent(serverName)}/tools`)
      if (res.ok) {
        const toolsList = (await res.json()) as LiveMCPTool[]
        setMcpTools((prev) => ({ ...prev, [serverName]: toolsList }))
      } else {
        toast.error(`Could not load tools for server '${serverName}'`)
      }
    } catch {
      toast.error(`Error loading tools for '${serverName}'`)
    } finally {
      setLoadingMcpTools((prev) => ({ ...prev, [serverName]: false }))
    }
  }

  const toggleMcpExpansion = (serverName: string) => {
    const isExpanded = !expandedMcp[serverName]
    setExpandedMcp((prev) => ({ ...prev, [serverName]: isExpanded }))
    if (isExpanded && !mcpTools[serverName]) {
      void loadMcpTools(serverName)
    }
  }

  // Filters -- name, domain, and tags all match (GOC-60-W06d keeps free-text
  // search working across the new grouped-by-domain layout).
  const filteredMcp = data.mcp_tools.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const filteredBuiltin = data.builtin_tools.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const filteredSkills = data.skills.filter((s) => matchesSearch(searchQuery, s.name, s.domain, s.tags))
  const filteredGraphs = data.skill_graphs.filter((g) => matchesSearch(searchQuery, g.name, g.domain, g.tags))
  const filteredWorkflows = data.skill_workflows.filter((w) => matchesSearch(searchQuery, w.name, w.domain, w.tags))

  const groupedSkills = groupByDomain(filteredSkills)
  const groupedGraphs = groupByDomain(filteredGraphs)
  const groupedWorkflows = groupByDomain(filteredWorkflows)

  if (sessionExpired) {
    return <SessionExpiredNotice />
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/40 bg-card/60 backdrop-blur-md">
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 via-emerald-400 to-green-500">
                Tools & Cognitive Registry
              </CardTitle>
              <CardDescription>
                Unified control plane to discover, monitor, and dynamically toggle MCP servers, built-in operations,
                and dynamic cognitive assets.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search catalog..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                  }}
                  className="pl-9 h-9 bg-muted/20"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => {
                  void fetchTools()
                }}
                disabled={loading}
              >
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Pretty Categorized Navigation Tabs */}
          <div className="flex flex-wrap gap-2 mt-4 border-b border-border/40 pb-2">
            {[
              { id: 'mcp', label: 'MCP Servers', icon: Wrench, count: data.mcp_tools.length },
              { id: 'builtin', label: 'Built-in Tools', icon: Code, count: data.builtin_tools.length },
              {
                id: 'cognitive',
                label: 'Cognitive Skills',
                icon: Layers,
                count: data.skills.length + data.skill_graphs.length + data.skill_workflows.length,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as 'mcp' | 'builtin' | 'cognitive')
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all border ${
                  activeTab === tab.id
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold'
                    : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <tab.icon className="size-3.5" />
                <span>{tab.label}</span>
                <Badge variant="secondary" className="px-1.5 py-0.25 text-[10px] bg-muted/40">
                  {tab.count}
                </Badge>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-20rem)] pr-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <RefreshCw className="size-8 text-emerald-500 animate-spin" />
                <span className="text-sm text-muted-foreground font-medium">Querying graph registry...</span>
              </div>
            ) : (
              <>
                {/* 1. MCP Tools */}
                {activeTab === 'mcp' && (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => {
                          void openAddMcpServer()
                        }}
                      >
                        <Plus className="size-3.5" />
                        Add MCP Server
                      </Button>
                    </div>
                    {filteredMcp.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <span className="text-muted-foreground text-sm">No MCP servers registered.</span>
                        {data.mcp_status.error ? (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-300 max-w-xl text-left">
                            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                            <p className="text-xs">{data.mcp_status.error}</p>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/70">
                            Checked the MCP fleet catalog — it genuinely has no servers configured.
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {filteredMcp.map((server) => {
                          const isExpanded = !!expandedMcp[server.name]
                          const serverTools = mcpTools[server.name] ?? []
                          const isLoadingTools = !!loadingMcpTools[server.name]

                          return (
                            <div
                              key={server.name}
                              className="p-4 rounded-xl border border-border/40 bg-muted/10 backdrop-blur-sm hover:border-emerald-500/30 transition-all flex flex-col justify-between"
                            >
                              <div>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <div className="flex items-center gap-2">
                                    <Wrench className="size-4 text-emerald-400" />
                                    <h4 className="font-bold text-sm text-foreground">{server.name}</h4>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] font-semibold ${server.enabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}
                                    >
                                      {server.enabled ? 'Active' : 'Disabled'}
                                    </Badge>
                                    <button
                                      onClick={() => {
                                        void handleToggleMcpServer(server.name, server.enabled)
                                      }}
                                      className={`px-2.5 py-1 rounded text-xs font-bold transition-all border ${
                                        server.enabled
                                          ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                      }`}
                                    >
                                      {server.enabled ? 'Disable' : 'Enable'}
                                    </button>
                                    <button
                                      title={`Edit ${server.name}`}
                                      aria-label={`Edit ${server.name}`}
                                      onClick={() => {
                                        void openEditMcpServer(server.name)
                                      }}
                                      className="p-1.5 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:border-border transition-all"
                                    >
                                      <Pencil className="size-3.5" />
                                    </button>
                                    <button
                                      title={`Remove ${server.name}`}
                                      aria-label={`Remove ${server.name}`}
                                      onClick={() => {
                                        void handleDeleteMcpServer(server.name)
                                      }}
                                      className="p-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {server.status === 'unavailable' && (
                                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 mt-2 text-amber-300">
                                    <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                                    <p className="text-xs">
                                      {server.error ?? 'Unavailable for an unreported reason.'}
                                    </p>
                                  </div>
                                )}
                                {typeof server.tool_count === 'number' && (
                                  <div className="space-y-1.5 mt-2">
                                    <div className="text-xs text-muted-foreground">
                                      <span className="font-semibold text-foreground">Served tools: </span>
                                      <code className="font-mono bg-muted/40 px-1 py-0.5 rounded text-[10px]">
                                        {server.tool_count}
                                      </code>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Sub-tools list control toggle */}
                              {server.enabled && (
                                <div className="mt-4 border-t border-border/20 pt-3">
                                  <button
                                    onClick={() => {
                                      toggleMcpExpansion(server.name)
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-all"
                                  >
                                    <Sliders className="size-3.5 text-teal-400" />
                                    <span>Manage MCP Tools</span>
                                    {isExpanded ? (
                                      <ChevronUp className="size-3.5" />
                                    ) : (
                                      <ChevronDown className="size-3.5" />
                                    )}
                                  </button>

                                  {isExpanded && (
                                    <div className="mt-3 bg-muted/5 rounded-lg border border-border/20 p-3 space-y-2">
                                      {isLoadingTools ? (
                                        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground font-medium">
                                          <RefreshCw className="size-3.5 animate-spin text-teal-400" />
                                          <span>Discovering tools...</span>
                                        </div>
                                      ) : serverTools.length === 0 ? (
                                        <div className="text-xs text-muted-foreground py-2">
                                          No tools exposed by this MCP server.
                                        </div>
                                      ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                          {serverTools.map((tool) => (
                                            <div
                                              key={tool.name}
                                              className="flex items-start justify-between p-2.5 rounded-md border border-border/20 bg-muted/10"
                                            >
                                              <div className="space-y-1 pr-2">
                                                <div className="flex items-center gap-1.5">
                                                  <span className="font-mono font-bold text-xs text-foreground">
                                                    {tool.name}
                                                  </span>
                                                </div>
                                                {tool.description && (
                                                  <p className="text-[10px] text-muted-foreground leading-normal line-clamp-2">
                                                    {tool.description}
                                                  </p>
                                                )}
                                              </div>
                                              <button
                                                onClick={() => {
                                                  void handleToggleMcpTool(server.name, tool.name, tool.enabled)
                                                }}
                                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 border transition-all ${
                                                  tool.enabled
                                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                                                    : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                                                }`}
                                              >
                                                {tool.enabled ? 'ON' : 'OFF'}
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3 text-[11px] text-muted-foreground">
                                <span>Protocol: MCP Server v1.0</span>
                                <div className="flex items-center gap-1 text-emerald-400 font-bold">
                                  <CheckCircle className="size-3" /> Handshake Verified
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Built-in Agent Tools */}
                {activeTab === 'builtin' && (
                  <div className="space-y-4">
                    {filteredBuiltin.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground text-sm">No built-in tools found.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredBuiltin.map((tool) => (
                          <div
                            key={tool.name}
                            className="p-4 rounded-xl border border-border/40 bg-muted/10 backdrop-blur-sm hover:border-emerald-500/30 transition-all flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  <Code className="size-4 text-emerald-400" />
                                  <h4 className="font-bold text-sm text-foreground">{tool.name}</h4>
                                </div>
                                <button
                                  onClick={() => {
                                    void handleToggleBuiltin(tool.name, tool.enabled)
                                  }}
                                  className={`px-2 py-0.75 rounded text-[10px] font-bold border transition-all ${
                                    tool.enabled
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                      : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                                  }`}
                                >
                                  {tool.enabled ? 'Enabled' : 'Disabled'}
                                </button>
                              </div>
                              <div className="space-y-1.5 mt-2">
                                <div className="text-xs text-muted-foreground">
                                  <span className="font-semibold text-foreground">File Path: </span>
                                  <span className="font-mono text-muted-foreground text-[10px] break-all">
                                    {tool.file_path}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3 text-[11px] text-muted-foreground">
                              <span>Source: agent-utilities core</span>
                              <div className="flex items-center gap-1 text-emerald-400 font-bold">
                                <CheckCircle className="size-3" /> Class Ingested
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Cognitive Registry - classified by the catalog's own skill_type
                    truth, organized by domain, 3 boxes: agent skills (runnable
                    + unclassified, flagged in place) / skill graphs /
                    describe-only workflows. An unclassified skill is still a
                    skill -- it is NOT a fourth bucket. */}
                {activeTab === 'cognitive' && (
                  <div className="space-y-4">
                    {!data.skill_classification.kg_reachable && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-300">
                        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                        <div className="text-xs">
                          <p className="font-bold">Skill catalog unreachable</p>
                          <p className="text-amber-300/80">
                            Classification could not be read from the fleet catalog on this request. Every discovered
                            skill is shown under Agent Skills, flagged &ldquo;Unclassified&rdquo;, rather than guessed
                            from its filesystem path.
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground px-1">
                      <span className="font-semibold text-foreground">
                        {data.skill_classification.filesystem_skill_md_count}
                      </span>{' '}
                      discovered on disk ·{' '}
                      <span className="font-semibold text-emerald-400">
                        {data.skill_classification.runnable_count}
                      </span>{' '}
                      classified runnable ·{' '}
                      <span className="font-semibold text-sky-400">
                        {data.skill_classification.describe_only_count}
                      </span>{' '}
                      describe-only ·{' '}
                      <span className="font-semibold text-amber-400">
                        {data.skill_classification.unclassified_count}
                      </span>{' '}
                      unclassified
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <CognitiveBox
                        icon={Zap}
                        iconClassName="text-emerald-400"
                        title="Agent Skills"
                        description="Runnable CallableResource(AGENT_SKILL) -- unclassified skills flagged, classify them here"
                        groups={groupedSkills}
                        totalCount={filteredSkills.length}
                        emptyLabel="No matching skills found."
                        onToggle={(item) => {
                          void handleToggleCognitive('skill', item.id, item.enabled)
                        }}
                        renderSecondary={(item) => (
                          <p className="text-[11px] text-muted-foreground leading-normal line-clamp-3">
                            {item.description ?? 'No description available.'}
                          </p>
                        )}
                        renderClassifyAction={(item) => (
                          <ClassifySkillControl
                            item={item}
                            busy={classifyingId === item.id}
                            onClassify={(target, skillType) => {
                              void handleClassifySkill(target, skillType)
                            }}
                          />
                        )}
                      />

                      <CognitiveBox
                        icon={Network}
                        iconClassName="text-teal-400"
                        title="Skill Graphs"
                        description="Epistemic connection abstractions"
                        groups={groupedGraphs}
                        totalCount={filteredGraphs.length}
                        emptyLabel="No matching graphs found."
                        onToggle={(item) => {
                          void handleToggleCognitive('skill_graph', item.id, item.enabled)
                        }}
                        renderSecondary={(item) => (
                          <div className="text-[9px] text-muted-foreground font-mono truncate break-all">
                            {item.file_path}
                          </div>
                        )}
                      />

                      <CognitiveBox
                        icon={GitBranch}
                        iconClassName="text-sky-400"
                        title="Skill Workflows"
                        description="KG-verified describe-only WorkflowDefinition"
                        groups={groupedWorkflows}
                        totalCount={filteredWorkflows.length}
                        emptyLabel="No matching workflows found."
                        onToggle={(item) => {
                          void handleToggleCognitive('skill_workflow', item.id, item.enabled)
                        }}
                        renderSecondary={(item) => (
                          <div className="text-[9px] text-muted-foreground font-mono truncate break-all">
                            {item.file_path}
                          </div>
                        )}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Add / Edit MCP Server -- schema-derived form (BUG-260 pattern): the
          fields come from the live /mcp/server-schema response, never
          hand-listed, matching LLMTemplatesView/ConfigurationView's approach. */}
      <Dialog
        open={mcpServerDialog !== null}
        onOpenChange={(open) => {
          if (!open) setMcpServerDialog(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{mcpServerDialog?.mode === 'edit' ? 'Edit MCP Server' : 'Add MCP Server'}</DialogTitle>
          </DialogHeader>
          {mcpServerDialog && mcpServerSchema && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="mcp-server-name" className="text-sm font-medium">
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="mcp-server-name"
                  value={mcpServerDialog.name}
                  disabled={mcpServerDialog.mode === 'edit'}
                  placeholder="ansible-tower-mcp"
                  onChange={(event) => {
                    setMcpServerDialog({ ...mcpServerDialog, name: event.target.value })
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {mcpServerDialog.mode === 'edit'
                    ? 'The catalog key -- not editable once created.'
                    : 'A unique catalog key, e.g. matching the *-mcp deployment name.'}
                </p>
              </div>
              <SchemaActionForm
                schema={mcpServerSchema}
                context={mcpServerFormContext(mcpServerDialog)}
                busy={savingMcpServer}
                onSubmit={(inputs) => {
                  void submitMcpServer(mcpServerDialog, inputs)
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
