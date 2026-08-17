/**
 * @file McpAppsView.tsx
 * @description GOC-26-W04: the MCP Apps production launcher route.
 *
 * Reads the default MCP server's governed tool catalog
 * (`fetchMcpServerTools`, `GET /api/enhanced/mcp/servers/{server}/tools`) and
 * offers ONLY the tools that declare a usable `meta.ui.resourceUri`
 * (BUG-071, `parseMcpUiMeta`) as launchable apps. A tool without one is never
 * rendered as a card at all -- per the charter's "never fabricate state"
 * rule, a placeholder/greyed-out entry for a tool with no app would still be
 * showing UI the backend didn't back.
 *
 * Selecting an app mounts the real, already-wired `McpAppHost`/`McpAppFrame`
 * pair (`components/mcp/`), which sandbox the fetched HTML
 * (`sandbox="allow-scripts"`, no `allow-same-origin`, no `allow-popups`/
 * `allow-forms`) and apply a CSP built from the INTERSECTION of the server's
 * declared `meta.csp` and this host's own domain ceiling -- see that pair's
 * module docstrings and `lib/mcp-apps/policy.ts` for the full mechanism.
 * This view adds no sandboxing of its own; it only decides WHICH tool to
 * hand `McpAppHost` and what THIS host permits that app instance to call.
 *
 * `allowedTools` (which real MCP tools an app's iframe may invoke) is never
 * derived from the server-declared `meta` -- `McpAppHost`'s own docstring
 * requires a caller to name an explicit allow-list, precisely so untrusted
 * metadata can never grant itself tool-call capability. `KNOWN_APP_TOOL_POLICY`
 * below is this host's curated allow-list per known entry-point tool, read
 * from what each shipped app's HTML actually calls
 * (`agent_utilities/mcp/tools/mcp_apps.py`). A discovered app outside that
 * registry still renders -- it just launches with an EMPTY allow-list, so it
 * can show its UI but every tool-call it attempts is refused by the host
 * (visible in `McpAppHost`'s own refusals list) until an operator curates a
 * policy for it.
 */
import { useEffect, useState } from 'react'
import { AppWindow, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { McpAppHost } from '@/components/mcp/McpAppHost'
import { DEFAULT_MCP_SERVER, fetchMcpServerTools, type McpToolDescriptor } from '@/lib/mcp-client'
import { parseMcpUiMeta, type McpUiMeta } from '@/lib/mcp-apps/types'

/** This host's own tool-call allow-list per known MCP Apps entry-point tool
 * -- see module docstring for why this is never inferred from `meta`. */
const KNOWN_APP_TOOL_POLICY: Record<string, string[]> = {
  graph_task_progress_app: ['graph_jobs'],
  graph_trace_waterfall_app: ['graph_traces'],
}

interface LaunchableApp {
  tool: McpToolDescriptor
  meta: McpUiMeta
}

/** Parse the iframe's stringified initial-props form used as the launch
 * panel's editable field, falling back to `{}` for anything that isn't a
 * plain JSON object (never throws, never fabricates a shape). */
function parseInitProps(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Handled below via `propsError`; keep the prior valid value.
  }
  return {}
}

export default function McpAppsView() {
  const [apps, setApps] = useState<LaunchableApp[]>([])
  const [totalTools, setTotalTools] = useState(0)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [selected, setSelected] = useState<LaunchableApp | null>(null)
  const [propsJson, setPropsJson] = useState('{}')
  const [propsError, setPropsError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const tools = await fetchMcpServerTools(DEFAULT_MCP_SERVER)
      const launchable: LaunchableApp[] = []
      for (const tool of tools) {
        const meta = parseMcpUiMeta(tool.meta)
        if (meta) launchable.push({ tool, meta })
      }
      setApps(launchable)
      setTotalTools(tools.length)
      setUnavailable(false)
    } catch {
      setApps([])
      setTotalTools(0)
      setUnavailable(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const launch = (app: LaunchableApp) => {
    setSelected(app)
    setPropsJson('{}')
    setPropsError(null)
  }

  return (
    <div className="space-y-6" data-testid="mcp-apps-view">
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
          onClick={() => {
            void load()
          }}
          disabled={loading}
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-8 animate-spin mb-3" />
          <p className="text-sm">Loading the tool inventory...</p>
        </div>
      ) : unavailable ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <UnavailableNotice what="The MCP tool inventory" />
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {apps.length} of {totalTools} {DEFAULT_MCP_SERVER} tool{totalTools === 1 ? '' : 's'} declare a launchable
            app.
          </p>
          {apps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <AppWindow className="size-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm">No tool in the current inventory declares an MCP App.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {apps.map((app) => (
                <Card
                  key={app.tool.name}
                  data-testid={`mcp-app-card-${app.tool.name}`}
                  className={`border-border/40 bg-card/60 cursor-pointer transition-colors hover:border-violet-400/60 ${
                    selected?.tool.name === app.tool.name ? 'border-violet-400' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    launch(app)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      launch(app)
                    }
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
                      {(app.meta.visibility ?? []).map((v) => (
                        <Badge key={v} variant="outline" className="text-[10px]">
                          {v}
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
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <Card className="border-border/40 bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <div>
              <CardTitle className="text-sm font-bold">{selected.tool.name}</CardTitle>
              <CardDescription className="text-xs">{selected.meta.resourceUri}</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(null)
              }}
            >
              Close
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="mcp-app-init-props" className="text-xs text-muted-foreground">
                Initial props (JSON) — passed to the app once it signals ready
              </label>
              <Textarea
                id="mcp-app-init-props"
                value={propsJson}
                onChange={(e) => {
                  const next = e.target.value
                  setPropsJson(next)
                  try {
                    JSON.parse(next || '{}')
                    setPropsError(null)
                  } catch {
                    setPropsError('Not valid JSON — launching with the last valid props.')
                  }
                }}
                className="font-mono text-xs"
                rows={2}
              />
              {propsError && <p className="text-xs text-amber-600 dark:text-amber-500">{propsError}</p>}
            </div>
            <div className="h-[480px] [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:rounded-md [&_iframe]:border [&_iframe]:border-border/40">
              <McpAppHost
                key={selected.tool.name}
                meta={selected.meta}
                initProps={parseInitProps(propsJson)}
                allowedTools={KNOWN_APP_TOOL_POLICY[selected.tool.name] ?? []}
                title={selected.tool.name}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
