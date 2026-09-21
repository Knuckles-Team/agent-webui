import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { z } from 'zod'
import {
  Wrench,
  Code,
  Zap,
  GitBranch,
  RefreshCw,
  Search,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Sliders,
  Layers,
  AlertTriangle,
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
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'
import { SchemaActionForm } from '@/components/capabilities/SchemaActionForm'
import type { JsonSchema } from '@/lib/capability-forms'
import type { PageContextEnvelope } from '@/lib/page-context'

interface MCPTool {
  server_id: string
  name: string
  url: string
  status: 'available' | 'unavailable'
  tool_count: number
  /** Stated reason a server is `unavailable` (e.g. "stdio transport is not
   * permitted in this process") -- `null`/absent when healthy. Never treat
   * an unavailable server with no `error` as healthy; the backend always
   * sets one when `status === 'unavailable'`. */
  error?: string | null
}

interface CatalogEntry {
  id: string
  name: string
  kind: 'tool' | 'skill' | 'workflow'
  description: string
  status: 'active' | 'retired' | 'withdrawn'
  authority: 'agent_component' | 'workflow_catalog'
  server_name?: string | null
  revision?: number | null
  definition_digest?: string | null
  content_digest?: string | null
}

interface ToolsData {
  source: 'epistemic_graph'
  servers: MCPTool[]
  components: CatalogEntry[]
  counts: {
    servers: number
    tools: number
    skills: number
    workflows: number
  }
}

interface LiveMCPTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  enabled: boolean
  /** Set by the backend when a descriptor's `input_schema` could not be
   * safely bounded -- the tool is still listed and toggleable, but its
   * schema was dropped rather than silently reported as empty. */
  schema_omitted?: boolean
}

/** One lazily-loaded, alphabetically-ordered page of one server's tools.
 * `total` is the server's REAL tool count (`arr-mcp` serves 1,131), so the
 * UI can say "showing 100 of 1,131" instead of presenting a page as the
 * whole catalog. `error` is the stated reason a load failed -- rendered in
 * place, never swallowed into an empty-looking list. */
interface McpToolPageState {
  tools: LiveMCPTool[]
  total: number
  error?: string
  toggleError?: string | null
}

/** Tools fetched per expand. Deliberately smaller than the backend's own
 * `_MCP_TOOL_PAGE_MAX` (200) so the first page of a 1,131-tool server paints
 * quickly; "Load more" walks the rest. */
const MCP_TOOL_PAGE_SIZE = 100

const liveMcpToolSchema: z.ZodType<LiveMCPTool> = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  schema_omitted: z.boolean().optional(),
})

/** The paginated envelope `GET /api/enhanced/mcp/servers/{s}/tools` returns.
 * A bare array (the pre-pagination shape) is still accepted so a rolling
 * deploy never blanks the panel. */
const mcpToolPageSchema = z.union([
  z.object({
    tools: looseArray(liveMcpToolSchema),
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
    has_more: z.boolean().optional(),
    toggle_status: z.object({ source: z.string(), error: z.string().nullable() }).optional(),
  }),
  looseArray(liveMcpToolSchema).transform((tools) => ({
    tools,
    total: tools.length,
    offset: 0,
    limit: tools.length,
    has_more: false,
    toggle_status: undefined,
  })),
])

const mcpToolSchema: z.ZodType<MCPTool> = z.object({
  server_id: z.string(),
  name: z.string(),
  url: z.string(),
  status: z.enum(['available', 'unavailable']),
  tool_count: z.number(),
  error: z.string().nullable().optional(),
})
function catalogAuthorityMatchesKind(entry: CatalogEntry): boolean {
  if (entry.kind === 'workflow') return entry.authority === 'workflow_catalog'
  return entry.authority === 'agent_component'
}

const catalogEntrySchema: z.ZodType<CatalogEntry> = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['tool', 'skill', 'workflow']),
    description: z.string(),
    status: z.enum(['active', 'retired', 'withdrawn']),
    authority: z.enum(['agent_component', 'workflow_catalog']),
    server_name: z.string().nullable().optional(),
    revision: z.number().nullable().optional(),
    definition_digest: z.string().nullable().optional(),
    content_digest: z.string().nullable().optional(),
  })
  .refine(catalogAuthorityMatchesKind, {
    message: 'catalog entry kind does not match its authority',
    path: ['authority'],
  })
const toolsDataSchema: z.ZodType<ToolsData> = z.object({
  source: z.literal('epistemic_graph'),
  servers: looseArray(mcpToolSchema),
  components: looseArray(catalogEntrySchema),
  counts: z.object({
    servers: z.number(),
    tools: z.number(),
    skills: z.number(),
    workflows: z.number(),
  }),
})

// Exported so contract tests pin the exact GraphOS-owned response boundary.
export { catalogEntrySchema, toolsDataSchema }

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

function matchesCatalogEntry(query: string, item: CatalogEntry): boolean {
  const catalogGroup = item.server_name ?? item.authority
  return matchesSearch(query, item.name, catalogGroup, [item.description])
}

function selectCatalogEntries(data: ToolsData, kind: CatalogEntry['kind'], query: string): CatalogEntry[] {
  const matchingKind = data.components.filter((item) => item.kind === kind)
  return matchingKind.filter((item) => matchesCatalogEntry(query, item))
}

function groupCatalogEntries(items: CatalogEntry[]): [string, CognitiveItem[]][] {
  const groupedItems = items.map((item) => ({ ...item, domain: item.server_name ?? item.authority }))
  return groupByDomain(groupedItems)
}

/** Structural shape shared by the typed catalog panels. */
interface CognitiveItem extends CatalogEntry {
  id: string
  name: string
}

function RunnabilityBadge({ item }: { item: CognitiveItem }) {
  return item.status === 'active' ? (
    <Badge variant="outline" className="text-[8px] font-bold border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[8px] font-bold border-sky-500/40 text-sky-400 bg-sky-500/10">
      {item.status}
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
  renderSecondary,
}: {
  icon: LucideIcon
  iconClassName: string
  title: string
  description: string
  groups: [string, CognitiveItem[]][]
  totalCount: number
  emptyLabel: string
  renderSecondary: (item: CognitiveItem) => ReactNode
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
                        <RunnabilityBadge item={item} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="secondary" className="text-[8px] bg-muted/40 font-semibold">
                          {item.authority}
                        </Badge>
                        {item.server_name && (
                          <Badge variant="secondary" className="text-[8px] bg-muted/40 font-semibold">
                            {item.server_name}
                          </Badge>
                        )}
                      </div>
                      {renderSecondary(item)}
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

interface McpServerCardHandlers {
  onEditServer: (name: string) => void
  onDeleteServer: (name: string) => void
  onToggleExpansion: (name: string) => void
  onToggleTool: (serverName: string, toolName: string, enabled: boolean) => void
  onLoadMore: (serverName: string, offset: number) => void
}

function renderMcpServerHeaderActions({
  server,
  onEditServer,
  onDeleteServer,
}: {
  server: MCPTool
} & Pick<McpServerCardHandlers, 'onEditServer' | 'onDeleteServer'>) {
  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="outline"
        className={`text-[10px] font-semibold ${server.status === 'available' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}
      >
        {server.status}
      </Badge>
      <button
        title={`Edit ${server.name}`}
        aria-label={`Edit ${server.name}`}
        onClick={() => {
          onEditServer(server.name)
        }}
        className="p-1.5 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:border-border transition-all"
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        title={`Remove ${server.name}`}
        aria-label={`Remove ${server.name}`}
        onClick={() => {
          onDeleteServer(server.name)
        }}
        className="p-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

function renderMcpServerStatus(server: MCPTool) {
  return (
    <>
      {server.status === 'unavailable' && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 mt-2 text-amber-300">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <p className="text-xs">{server.error ?? 'Unavailable for an unreported reason.'}</p>
        </div>
      )}
      {typeof server.tool_count === 'number' && (
        <div className="space-y-1.5 mt-2">
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Served tools: </span>
            <code className="font-mono bg-muted/40 px-1 py-0.5 rounded text-[10px]">{server.tool_count}</code>
          </div>
        </div>
      )}
    </>
  )
}

function renderMcpToolRow({
  serverName,
  tool,
  onToggleTool,
}: {
  serverName: string
  tool: LiveMCPTool
} & Pick<McpServerCardHandlers, 'onToggleTool'>) {
  return (
    <div
      key={tool.name}
      className="flex items-start justify-between p-2.5 rounded-md border border-border/20 bg-muted/10"
    >
      <div className="space-y-1 pr-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-xs text-foreground">{tool.name}</span>
        </div>
        {tool.description && (
          <p className="text-[10px] text-muted-foreground leading-normal line-clamp-2">{tool.description}</p>
        )}
      </div>
      <button
        onClick={() => {
          onToggleTool(serverName, tool.name, tool.enabled)
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
  )
}

function renderMcpToolsList({
  serverTools,
  isLoadingTools,
  toolPageError,
  serverName,
  onToggleTool,
}: {
  serverTools: LiveMCPTool[]
  isLoadingTools: boolean
  toolPageError: string | undefined
  serverName: string
} & Pick<McpServerCardHandlers, 'onToggleTool'>) {
  if (isLoadingTools && serverTools.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground font-medium">
        <RefreshCw className="size-3.5 animate-spin text-teal-400" />
        <span>Discovering tools...</span>
      </div>
    )
  }
  if (serverTools.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        {toolPageError ? 'No tools could be read for this MCP server.' : 'No tools exposed by this MCP server.'}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {serverTools.map((tool) => renderMcpToolRow({ serverName, tool, onToggleTool }))}
    </div>
  )
}

function renderMcpToolsPanelBanner(message: string | null | undefined) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-amber-300">
      <AlertTriangle className="size-4 shrink-0 mt-0.5" />
      <p className="text-xs">{message}</p>
    </div>
  )
}

function renderMcpToolsShowingCount({ shown, total }: { shown: number; total: number }) {
  if (shown === 0) return null
  return (
    <div className="text-[10px] text-muted-foreground">
      Showing <span className="font-semibold text-foreground">{shown}</span> of{' '}
      <span className="font-semibold text-foreground">{total}</span> tools, alphabetically.
    </div>
  )
}

function renderMcpLoadMoreButton({
  serverName,
  shown,
  total,
  isLoadingTools,
  onLoadMore,
}: {
  serverName: string
  shown: number
  total: number
  isLoadingTools: boolean
} & Pick<McpServerCardHandlers, 'onLoadMore'>) {
  if (shown >= total) return null
  return (
    <Button
      size="sm"
      variant="outline"
      className="w-full gap-1.5 text-xs"
      disabled={isLoadingTools}
      onClick={() => {
        onLoadMore(serverName, shown)
      }}
    >
      {isLoadingTools ? <RefreshCw className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5" />}
      Load {Math.min(MCP_TOOL_PAGE_SIZE, total - shown)} more
    </Button>
  )
}

function renderMcpToolsPanel({
  serverName,
  toolPage,
  isLoadingTools,
  onToggleTool,
  onLoadMore,
}: {
  serverName: string
  toolPage: McpToolPageState | undefined
  isLoadingTools: boolean
} & Pick<McpServerCardHandlers, 'onToggleTool' | 'onLoadMore'>) {
  const serverTools = toolPage?.tools ?? []
  const toolTotal = toolPage?.total ?? 0
  return (
    <div className="mt-3 bg-muted/5 rounded-lg border border-border/20 p-3 space-y-2">
      {renderMcpToolsPanelBanner(toolPage?.error)}
      {renderMcpToolsPanelBanner(toolPage?.toggleError)}
      {renderMcpToolsShowingCount({ shown: serverTools.length, total: toolTotal })}
      {renderMcpToolsList({
        serverTools,
        isLoadingTools,
        toolPageError: toolPage?.error,
        serverName,
        onToggleTool,
      })}
      {renderMcpLoadMoreButton({
        serverName,
        shown: serverTools.length,
        total: toolTotal,
        isLoadingTools,
        onLoadMore,
      })}
    </div>
  )
}

function renderMcpServerExpandSection({
  server,
  isExpanded,
  toolPage,
  isLoadingTools,
  onToggleExpansion,
  onToggleTool,
  onLoadMore,
}: {
  server: MCPTool
  isExpanded: boolean
  toolPage: McpToolPageState | undefined
  isLoadingTools: boolean
} & Pick<McpServerCardHandlers, 'onToggleExpansion' | 'onToggleTool' | 'onLoadMore'>) {
  if (server.status !== 'available') return null
  return (
    <div className="mt-4 border-t border-border/20 pt-3">
      <button
        onClick={() => {
          onToggleExpansion(server.name)
        }}
        className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-all"
      >
        <Sliders className="size-3.5 text-teal-400" />
        <span>Manage MCP Tools</span>
        {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      {isExpanded &&
        renderMcpToolsPanel({ serverName: server.name, toolPage, isLoadingTools, onToggleTool, onLoadMore })}
    </div>
  )
}

function renderMcpServerCard({
  server,
  isExpanded,
  toolPage,
  isLoadingTools,
  onEditServer,
  onDeleteServer,
  onToggleExpansion,
  onToggleTool,
  onLoadMore,
}: {
  server: MCPTool
  isExpanded: boolean
  toolPage: McpToolPageState | undefined
  isLoadingTools: boolean
} & McpServerCardHandlers) {
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
          {renderMcpServerHeaderActions({ server, onEditServer, onDeleteServer })}
        </div>
        {renderMcpServerStatus(server)}
      </div>

      {renderMcpServerExpandSection({
        server,
        isExpanded,
        toolPage,
        isLoadingTools,
        onToggleExpansion,
        onToggleTool,
        onLoadMore,
      })}

      <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3 text-[11px] text-muted-foreground">
        <span>Protocol: MCP Server v1.0</span>
        <div className="flex items-center gap-1 text-emerald-400 font-bold">
          <CheckCircle className="size-3" /> Handshake Verified
        </div>
      </div>
    </div>
  )
}

function renderMcpServersList({
  filteredMcp,
  expandedMcp,
  mcpTools,
  loadingMcpTools,
  handlers,
}: {
  filteredMcp: MCPTool[]
  expandedMcp: Record<string, boolean | undefined>
  mcpTools: Record<string, McpToolPageState | undefined>
  loadingMcpTools: Record<string, boolean | undefined>
  handlers: McpServerCardHandlers
}) {
  if (filteredMcp.length === 0) return null
  return (
    <div className="grid grid-cols-1 gap-4">
      {filteredMcp.map((server) =>
        renderMcpServerCard({
          server,
          isExpanded: !!expandedMcp[server.name],
          toolPage: mcpTools[server.name],
          isLoadingTools: !!loadingMcpTools[server.name],
          ...handlers,
        }),
      )}
    </div>
  )
}

function renderMcpEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="text-muted-foreground text-sm">No MCP servers registered.</span>
      <span className="text-[10px] text-muted-foreground/70">
        The authoritative fleet catalog has no live server registrations.
      </span>
    </div>
  )
}

function renderMcpTab({
  filteredMcp,
  expandedMcp,
  mcpTools,
  loadingMcpTools,
  onAddServer,
  handlers,
}: {
  filteredMcp: MCPTool[]
  expandedMcp: Record<string, boolean | undefined>
  mcpTools: Record<string, McpToolPageState | undefined>
  loadingMcpTools: Record<string, boolean | undefined>
  onAddServer: () => void
  handlers: McpServerCardHandlers
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onAddServer}>
          <Plus className="size-3.5" />
          Add MCP Server
        </Button>
      </div>
      {filteredMcp.length === 0
        ? renderMcpEmptyState()
        : renderMcpServersList({ filteredMcp, expandedMcp, mcpTools, loadingMcpTools, handlers })}
    </div>
  )
}

function renderCatalogSummary(data: ToolsData) {
  return (
    <div className="text-[10px] text-muted-foreground px-1">
      <span className="font-semibold text-foreground">{data.counts.tools}</span> tools ·{' '}
      <span className="font-semibold text-emerald-400">{data.counts.skills}</span> skills ·{' '}
      <span className="font-semibold text-sky-400">{data.counts.workflows}</span> workflows
    </div>
  )
}

function renderCognitiveTab({
  data,
  groupedTools,
  groupedSkills,
  groupedWorkflows,
  filteredToolsCount,
  filteredSkillsCount,
  filteredWorkflowsCount,
}: {
  data: ToolsData
  groupedTools: [string, CognitiveItem[]][]
  groupedSkills: [string, CognitiveItem[]][]
  groupedWorkflows: [string, CognitiveItem[]][]
  filteredToolsCount: number
  filteredSkillsCount: number
  filteredWorkflowsCount: number
}) {
  return (
    <div className="space-y-4">
      {renderCatalogSummary(data)}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CognitiveBox
          icon={Code}
          iconClassName="text-teal-400"
          title="Tools"
          description="Current AgentComponent tools"
          groups={groupedTools}
          totalCount={filteredToolsCount}
          emptyLabel="No matching tools found."
          renderSecondary={(item) => (
            <p className="text-[11px] text-muted-foreground leading-normal line-clamp-3">{item.description}</p>
          )}
        />
        <CognitiveBox
          icon={Zap}
          iconClassName="text-emerald-400"
          title="Skills"
          description="Current AgentComponent skills"
          groups={groupedSkills}
          totalCount={filteredSkillsCount}
          emptyLabel="No matching skills found."
          renderSecondary={(item) => (
            <p className="text-[11px] text-muted-foreground leading-normal line-clamp-3">{item.description}</p>
          )}
        />
        <CognitiveBox
          icon={GitBranch}
          iconClassName="text-sky-400"
          title="Workflows"
          description="Current workflow catalog definitions"
          groups={groupedWorkflows}
          totalCount={filteredWorkflowsCount}
          emptyLabel="No matching workflows found."
          renderSecondary={(item) => (
            <p className="text-[11px] text-muted-foreground leading-normal line-clamp-3">{item.description}</p>
          )}
        />
      </div>
    </div>
  )
}

interface ActiveTabContentProps {
  activeTab: 'mcp' | 'catalog'
  data: ToolsData
  filteredMcp: MCPTool[]
  expandedMcp: Record<string, boolean | undefined>
  mcpTools: Record<string, McpToolPageState | undefined>
  loadingMcpTools: Record<string, boolean | undefined>
  onAddServer: () => void
  mcpHandlers: McpServerCardHandlers
  groupedTools: [string, CognitiveItem[]][]
  groupedSkills: [string, CognitiveItem[]][]
  groupedWorkflows: [string, CognitiveItem[]][]
  filteredToolsCount: number
  filteredSkillsCount: number
  filteredWorkflowsCount: number
}

function renderActiveTabContent(props: ActiveTabContentProps) {
  if (props.activeTab === 'mcp') {
    return renderMcpTab({
      filteredMcp: props.filteredMcp,
      expandedMcp: props.expandedMcp,
      mcpTools: props.mcpTools,
      loadingMcpTools: props.loadingMcpTools,
      onAddServer: props.onAddServer,
      handlers: props.mcpHandlers,
    })
  }
  return renderCognitiveTab({
    data: props.data,
    groupedTools: props.groupedTools,
    groupedSkills: props.groupedSkills,
    groupedWorkflows: props.groupedWorkflows,
    filteredToolsCount: props.filteredToolsCount,
    filteredSkillsCount: props.filteredSkillsCount,
    filteredWorkflowsCount: props.filteredWorkflowsCount,
  })
}

function renderNavTabs({
  activeTab,
  onSetActiveTab,
  mcpCount,
  catalogCount,
}: {
  activeTab: 'mcp' | 'catalog'
  onSetActiveTab: (tab: 'mcp' | 'catalog') => void
  mcpCount: number
  catalogCount: number
}) {
  const tabs: { id: 'mcp' | 'catalog'; label: string; icon: LucideIcon; count: number }[] = [
    { id: 'mcp', label: 'MCP Servers', icon: Wrench, count: mcpCount },
    { id: 'catalog', label: 'Component Catalog', icon: Layers, count: catalogCount },
  ]
  return (
    <div className="flex flex-wrap gap-2 mt-4 border-b border-border/40 pb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => {
            onSetActiveTab(tab.id)
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
  )
}

function renderMcpServerDialog({
  mcpServerDialog,
  mcpServerSchema,
  savingMcpServer,
  onOpenChange,
  onNameChange,
  formContext,
  onSubmit,
}: {
  mcpServerDialog: { mode: 'add' | 'edit'; name: string } | null
  mcpServerSchema: JsonSchema | null
  savingMcpServer: boolean
  onOpenChange: (open: boolean) => void
  onNameChange: (name: string) => void
  formContext: (dialog: { mode: 'add' | 'edit'; name: string }) => PageContextEnvelope
  onSubmit: (dialog: { mode: 'add' | 'edit'; name: string }, inputs: Record<string, unknown>) => void
}) {
  return (
    <Dialog open={mcpServerDialog !== null} onOpenChange={onOpenChange}>
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
                  onNameChange(event.target.value)
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
              context={formContext(mcpServerDialog)}
              busy={savingMcpServer}
              onSubmit={(inputs) => {
                onSubmit(mcpServerDialog, inputs)
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function SkillsView() {
  const [data, setData] = useState<ToolsData>({
    source: 'epistemic_graph',
    servers: [],
    components: [],
    counts: { servers: 0, tools: 0, skills: 0, workflows: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'mcp' | 'catalog'>('mcp')
  const [sessionExpired, setSessionExpired] = useState(false)

  // Track expanded MCP servers and their loaded tools
  const [expandedMcp, setExpandedMcp] = useState<Record<string, boolean | undefined>>({})
  const [mcpTools, setMcpTools] = useState<Record<string, McpToolPageState | undefined>>({})
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
        // Update this tool in place. Re-fetching the server would discard
        // every page already loaded (up to 1,131 tools) to re-read a value
        // this request just persisted.
        setMcpTools((prev) => {
          const entry = prev[serverName]
          if (!entry) return prev
          return {
            ...prev,
            [serverName]: {
              ...entry,
              tools: entry.tools.map((t) => (t.name === toolName ? { ...t, enabled: !currentVal } : t)),
            },
          }
        })
      } else {
        toast.error('Failed to toggle tool status')
      }
    } catch {
      toast.error('Error toggling tool status')
    }
  }

  /** Fetch ONE page of `serverName`'s tools. `offset === 0` replaces the
   * panel's contents; a later offset appends, so "Load more" walks a
   * 1,131-tool server without ever asking for all of it at once. A failure
   * is stored on the server's own entry and rendered in place -- a backend
   * outage must not read as a healthy server that serves no tools. */
  const loadMcpTools = async (serverName: string, offset = 0) => {
    try {
      setLoadingMcpTools((prev) => ({ ...prev, [serverName]: true }))
      const page = await fetchValidated(
        `/api/enhanced/mcp/servers/${encodeURIComponent(serverName)}/tools?offset=${String(offset)}&limit=${String(MCP_TOOL_PAGE_SIZE)}`,
        mcpToolPageSchema,
      )
      setMcpTools((prev) => {
        const previous = offset > 0 ? (prev[serverName]?.tools ?? []) : []
        return {
          ...prev,
          [serverName]: {
            tools: [...previous, ...page.tools],
            total: page.total,
            toggleError: page.toggle_status?.error ?? null,
          },
        }
      })
    } catch (err) {
      const reason =
        err instanceof ApiError
          ? `The tool catalog for '${serverName}' could not be read (HTTP ${String(err.status)}).`
          : `The tool catalog for '${serverName}' could not be read.`
      setMcpTools((prev) => ({
        ...prev,
        [serverName]: { tools: prev[serverName]?.tools ?? [], total: prev[serverName]?.total ?? 0, error: reason },
      }))
      toast.error(reason)
    } finally {
      setLoadingMcpTools((prev) => ({ ...prev, [serverName]: false }))
    }
  }

  /** Lazy: nothing is fetched for a server until its panel is opened, so the
   * fleet list never pays for 9,561 tool descriptors it does not show. */
  const toggleMcpExpansion = (serverName: string) => {
    const isExpanded = !expandedMcp[serverName]
    setExpandedMcp((prev) => ({ ...prev, [serverName]: isExpanded }))
    if (isExpanded && !mcpTools[serverName]) {
      void loadMcpTools(serverName)
    }
  }

  // Filters -- name, domain, and tags all match (GOC-60-W06d keeps free-text
  // search working across the new grouped-by-domain layout).
  const filteredMcp = data.servers.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const filteredTools = selectCatalogEntries(data, 'tool', searchQuery)
  const filteredSkills = selectCatalogEntries(data, 'skill', searchQuery)
  const filteredWorkflows = selectCatalogEntries(data, 'workflow', searchQuery)

  const groupedTools = groupCatalogEntries(filteredTools)
  const groupedSkills = groupCatalogEntries(filteredSkills)
  const groupedWorkflows = groupCatalogEntries(filteredWorkflows)

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
                Live MCP registrations and typed tool, skill, and workflow catalogs from the GraphOS gateway.
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

          {renderNavTabs({
            activeTab,
            onSetActiveTab: setActiveTab,
            mcpCount: data.counts.servers,
            catalogCount: data.counts.tools + data.counts.skills + data.counts.workflows,
          })}
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-20rem)] pr-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <RefreshCw className="size-8 text-emerald-500 animate-spin" />
                <span className="text-sm text-muted-foreground font-medium">Querying graph registry...</span>
              </div>
            ) : (
              renderActiveTabContent({
                activeTab,
                data,
                filteredMcp,
                expandedMcp,
                mcpTools,
                loadingMcpTools,
                onAddServer: () => {
                  void openAddMcpServer()
                },
                mcpHandlers: {
                  onEditServer: (name) => {
                    void openEditMcpServer(name)
                  },
                  onDeleteServer: (name) => {
                    void handleDeleteMcpServer(name)
                  },
                  onToggleExpansion: toggleMcpExpansion,
                  onToggleTool: (serverName, toolName, enabled) => {
                    void handleToggleMcpTool(serverName, toolName, enabled)
                  },
                  onLoadMore: (serverName, offset) => {
                    void loadMcpTools(serverName, offset)
                  },
                },
                groupedTools,
                groupedSkills,
                groupedWorkflows,
                filteredToolsCount: filteredTools.length,
                filteredSkillsCount: filteredSkills.length,
                filteredWorkflowsCount: filteredWorkflows.length,
              })
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Add / Edit MCP Server -- schema-derived form (BUG-260 pattern): the
          fields come from the live /mcp/server-schema response, never
          hand-listed, matching LLMTemplatesView/ConfigurationView's approach. */}
      {renderMcpServerDialog({
        mcpServerDialog,
        mcpServerSchema,
        savingMcpServer,
        onOpenChange: (open) => {
          if (!open) setMcpServerDialog(null)
        },
        onNameChange: (name) => {
          if (mcpServerDialog) setMcpServerDialog({ ...mcpServerDialog, name })
        },
        formContext: mcpServerFormContext,
        onSubmit: (dialog, inputs) => {
          void submitMcpServer(dialog, inputs)
        },
      })}
    </div>
  )
}
