/**
 * @file McpAppsView.tsx
 * @description GOC-26-W04: the MCP Apps production launcher route.
 *
 * Consumes the global `MCPProvider`'s governed tool catalog
 * (`GET /api/enhanced/mcp/servers/{server}/tools`) and offers ONLY the tools
 * that declare a usable `meta.ui.resourceUri` as launchable apps. A tool
 * without one is never rendered as a card at all -- per the charter's "never
 * fabricate state" rule, a placeholder/greyed-out entry for a tool with no
 * app would still be showing UI the backend didn't back.
 *
 * Selecting an app mounts the real, already-wired `McpAppHost`/`McpAppFrame`
 * pair (`components/mcp/`), which sandbox the fetched HTML and apply a CSP
 * built from the intersection of the server's declared `meta.csp` and this
 * host's own domain ceiling. This view only decides which tool to hand to
 * `McpAppHost` and what this host permits that app instance to call.
 */
import { useMemo, useState } from 'react'
import { AppWindow, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { McpAppHost } from '@/components/mcp/McpAppHost'
import { DEFAULT_MCP_SERVER, type McpToolDescriptor } from '@/lib/mcp-client'
import { parseMcpUiMeta, type McpUiMeta } from '@/lib/mcp-apps/types'
import { useMCP } from '@/lib/mcp-context'

/** This host's own tool-call allow-list per known MCP Apps entry-point tool. */
const KNOWN_APP_TOOL_POLICY: Record<string, string[]> = {
  graph_task_progress_app: ['graph_jobs'],
  graph_trace_waterfall_app: ['graph_traces'],
}

interface LaunchableApp {
  tool: McpToolDescriptor
  meta: McpUiMeta
}

interface ParsedInitProps {
  value: Record<string, unknown>
  error: string | null
}

/** Build the host's independently configured CSP ceiling. */
function parseAllowedDomains(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => {
      try {
        const url = new URL(value)
        return (
          (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname === '/' && !url.search && !url.hash
        )
      } catch {
        return false
      }
    })
}

/** An empty default is fail-closed; deployments explicitly opt in. */
export const MCP_APP_ALLOWED_DOMAINS = parseAllowedDomains(import.meta.env.VITE_MCP_APP_ALLOWED_DOMAINS)

/** Parse the launch panel's editable JSON while retaining the last valid value. */
function parseInitProps(raw: string): ParsedInitProps {
  if (raw.trim() === '') return { value: {}, error: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { value: parsed as Record<string, unknown>, error: null }
    }
    return { value: {}, error: 'Initial props must be a JSON object; using the last valid props.' }
  } catch {
    return { value: {}, error: 'Invalid JSON; using the last valid props.' }
  }
}

function collectLaunchableApps(tools: McpToolDescriptor[] | null): LaunchableApp[] {
  const launchable: LaunchableApp[] = []
  for (const tool of tools ?? []) {
    const meta = parseMcpUiMeta(tool.meta)
    if (meta) launchable.push({ tool, meta })
  }
  return launchable
}

function collectAllowedToolSchemas(tools: McpToolDescriptor[] | null): ReadonlyMap<string, Record<string, unknown>> {
  const schemas = new Map<string, Record<string, unknown>>()
  for (const tool of tools ?? []) {
    if (!tool.schema_omitted) schemas.set(tool.name, tool.input_schema)
  }
  return schemas
}

function McpAppsHeader({ loading, onReload }: { loading: boolean; onReload: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <AppWindow className="size-6 text-violet-400" />
          MCP Apps
        </h1>
        <p className="text-sm text-muted-foreground">
          Launch a rich, sandboxed UI that a fleet MCP tool declares for itself — discovered live from the{' '}
          {DEFAULT_MCP_SERVER} tool inventory, never a hardcoded resource.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onReload}
        disabled={loading}
        aria-label="Reload MCP tool inventory"
        title="Reload MCP tool inventory"
      >
        <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  )
}

function McpAppLoadingState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-muted-foreground"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="size-8 animate-spin mb-3" />
      <p className="text-sm">Loading the tool inventory...</p>
    </div>
  )
}

function McpAppUnavailableState({ toolsError }: { toolsError: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center" role="alert" aria-live="assertive">
      <UnavailableNotice what="The MCP tool inventory" />
      {toolsError && (
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground" data-testid="mcp-app-error">
          {toolsError}
        </p>
      )}
    </div>
  )
}

function McpAppEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
      <AppWindow className="size-12 text-muted-foreground/30 mb-3" />
      <p className="text-sm">No tool in the current inventory declares an MCP App.</p>
    </div>
  )
}

interface McpAppCardProps {
  app: LaunchableApp
  selected: boolean
  onLaunch: (app: LaunchableApp) => void
}

function McpAppCard({ app, selected, onLaunch }: McpAppCardProps) {
  return (
    <Card
      data-testid={`mcp-app-card-${app.tool.name}`}
      className={`border-border/40 bg-card/60 cursor-pointer transition-colors hover:border-violet-400/60 ${
        selected ? 'border-violet-400' : ''
      }`}
      role="button"
      tabIndex={0}
      onClick={() => {
        onLaunch(app)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onLaunch(app)
      }}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold truncate" title={app.tool.name}>
          {app.tool.name}
        </CardTitle>
        <CardDescription className="text-xs line-clamp-2">{app.tool.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-1.5">
          {(app.meta.visibility ?? []).map((visibility) => (
            <Badge key={visibility} variant="outline" className="text-[10px]">
              {visibility}
            </Badge>
          ))}
          {!app.tool.enabled && (
            <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-500">
              disabled
            </Badge>
          )}
          {!(app.tool.name in KNOWN_APP_TOOL_POLICY) && (
            <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-500">
              no tool policy
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground truncate" title={app.meta.resourceUri}>
          {app.meta.resourceUri}
        </p>
      </CardContent>
    </Card>
  )
}

interface McpAppGridProps {
  apps: LaunchableApp[]
  selected: LaunchableApp | null
  onLaunch: (app: LaunchableApp) => void
}

function McpAppGrid({ apps, selected, onLaunch }: McpAppGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {apps.map((app) => (
        <McpAppCard
          key={app.tool.name}
          app={app}
          selected={selected?.tool.name === app.tool.name}
          onLaunch={onLaunch}
        />
      ))}
    </div>
  )
}

interface McpAppsCatalogProps {
  apps: LaunchableApp[]
  totalTools: number | null
  loading: boolean
  unavailable: boolean
  toolsError: string | null
  selected: LaunchableApp | null
  onLaunch: (app: LaunchableApp) => void
}

function McpAppsCatalog({
  apps,
  totalTools,
  loading,
  unavailable,
  toolsError,
  selected,
  onLaunch,
}: McpAppsCatalogProps) {
  if (loading && apps.length === 0) return <McpAppLoadingState />
  if (unavailable) return <McpAppUnavailableState toolsError={toolsError} />

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {apps.length} of {totalTools ?? 0} {DEFAULT_MCP_SERVER} tool{totalTools === 1 ? '' : 's'} in the loaded catalog
        page declare a launchable app.
      </p>
      {apps.length === 0 ? <McpAppEmptyState /> : <McpAppGrid apps={apps} selected={selected} onLaunch={onLaunch} />}
    </>
  )
}

interface McpAppEditorProps {
  propsJson: string
  propsError: string | null
  onChange: (value: string) => void
}

function McpAppEditor({ propsJson, propsError, onChange }: McpAppEditorProps) {
  return (
    <div className="space-y-1">
      <label htmlFor="mcp-app-init-props" className="text-xs text-muted-foreground">
        Initial props (JSON) — passed to the app once it signals ready
      </label>
      <Textarea
        id="mcp-app-init-props"
        value={propsJson}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="font-mono text-xs"
        rows={2}
        aria-invalid={propsError !== null}
        aria-describedby={propsError ? 'mcp-app-init-props-error' : undefined}
      />
      {propsError && (
        <p id="mcp-app-init-props-error" className="text-xs text-amber-600 dark:text-amber-500" role="alert">
          {propsError}
        </p>
      )}
    </div>
  )
}

interface McpAppLaunchPanelProps {
  selected: LaunchableApp | null
  propsJson: string
  propsError: string | null
  initProps: Record<string, unknown>
  allowedToolSchemas: ReadonlyMap<string, Record<string, unknown>>
  allowedDomains: string[]
  onPropsChange: (value: string) => void
  onClose: () => void
}

function McpAppLaunchPanel({
  selected,
  propsJson,
  propsError,
  initProps,
  allowedToolSchemas,
  allowedDomains,
  onPropsChange,
  onClose,
}: McpAppLaunchPanelProps) {
  if (!selected) return null

  return (
    <Card className="border-border/40 bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <div>
          <CardTitle className="text-sm font-bold">{selected.tool.name}</CardTitle>
          <CardDescription className="text-xs">{selected.meta.resourceUri}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <McpAppEditor propsJson={propsJson} propsError={propsError} onChange={onPropsChange} />
        <div className="h-[480px] [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:rounded-md [&_iframe]:border [&_iframe]:border-border/40">
          <McpAppHost
            key={selected.tool.name}
            meta={selected.meta}
            initProps={initProps}
            allowedTools={KNOWN_APP_TOOL_POLICY[selected.tool.name] ?? []}
            allowedToolSchemas={allowedToolSchemas}
            allowedDomains={allowedDomains}
            title={selected.tool.name}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export interface McpAppsViewProps {
  /** Optional test/deployment override; it remains a host-owned ceiling. */
  allowedDomains?: string[]
}

export default function McpAppsView({ allowedDomains = MCP_APP_ALLOWED_DOMAINS }: McpAppsViewProps) {
  const { tools, totalTools, isLoadingTools, toolsError, catalogStatus, reloadTools } = useMCP()
  const [selected, setSelected] = useState<LaunchableApp | null>(null)
  const [propsJson, setPropsJson] = useState('{}')
  const [initProps, setInitProps] = useState<Record<string, unknown>>({})
  const [propsError, setPropsError] = useState<string | null>(null)

  const apps = useMemo(() => collectLaunchableApps(tools), [tools])
  const allowedToolSchemas = useMemo(() => collectAllowedToolSchemas(tools), [tools])
  const loading = isLoadingTools || catalogStatus === 'idle'
  const unavailable = catalogStatus === 'unavailable' || catalogStatus === 'error'

  const launch = (app: LaunchableApp) => {
    setSelected(app)
    setPropsJson('{}')
    setInitProps({})
    setPropsError(null)
  }

  const updateProps = (value: string) => {
    setPropsJson(value)
    const parsed = parseInitProps(value)
    setPropsError(parsed.error)
    if (!parsed.error) setInitProps(parsed.value)
  }

  return (
    <div className="space-y-6" data-testid="mcp-apps-view">
      <McpAppsHeader loading={loading} onReload={reloadTools} />
      <McpAppsCatalog
        apps={apps}
        totalTools={totalTools}
        loading={loading}
        unavailable={unavailable}
        toolsError={toolsError}
        selected={selected}
        onLaunch={launch}
      />
      <McpAppLaunchPanel
        selected={selected}
        propsJson={propsJson}
        propsError={propsError}
        initProps={initProps}
        allowedToolSchemas={allowedToolSchemas}
        allowedDomains={allowedDomains}
        onPropsChange={updateProps}
        onClose={() => {
          setSelected(null)
        }}
      />
    </div>
  )
}
