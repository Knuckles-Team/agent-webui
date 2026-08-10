import { useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle, ExternalLink, Globe, Plus, RefreshCw, Search, Sparkles, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { toast } from 'sonner'

/**
 * @file AgentLibraryView.tsx
 * @description The Agent Library: compose a local agent from a name, instructions,
 * and hand-picked (or whole-server) tools, register an external A2A agent, browse
 * what already exists, and see suggestions derived from what is actually installed
 * and ingested. Every entry here is a real `CallableResource` graph node the
 * delegation engine can run by name — this page is the missing "create" half of
 * the prompt/skills/tools views, not a separate silo.
 */

interface LibraryAgent {
  id: string
  name: string
  description: string
  kind: 'local' | 'a2a'
  mcp_server?: string | null
  model_preference?: string | null
  timestamp?: string | null
  status?: string
  runnable_bound?: boolean
  tools?: { id?: string; name?: string }[]
  endpoint?: string | null
}

interface LibraryTool {
  id: string
  name: string
  mcp_server?: string | null
  tags: string[]
}

interface Suggestion {
  mcp_server: string
  tool_count: number
  sample_tools: string[]
  reason: string
}

interface ChatModelSummary {
  id: string
  provider: string
  intelligence_level?: string
  vision?: boolean
  reasoning?: boolean
  tools_enabled?: boolean
  can_route?: boolean
  can_kg?: boolean
  context_window?: number | null
}

interface EmbeddingModelSummary {
  id: string
  provider: string
  chunk_size?: number
  context_window?: number | null
}

interface ConfigSummary {
  app_profile: string
  deployment_profile: string
  chat_models: ChatModelSummary[]
  embedding_models: EmbeddingModelSummary[]
}

type TabId = 'library' | 'compose' | 'external' | 'config'

function navigateTo(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new Event('history-state-changed'))
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

const EMPTY_CONFIG: ConfigSummary = {
  app_profile: '',
  deployment_profile: '',
  chat_models: [],
  embedding_models: [],
}

export default function AgentLibraryView() {
  const [tab, setTab] = useState<TabId>('library')

  const [agents, setAgents] = useState<LibraryAgent[]>([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [search, setSearch] = useState('')

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(true)

  const [tools, setTools] = useState<LibraryTool[]>([])
  const [loadingTools, setLoadingTools] = useState(false)

  const [config, setConfig] = useState<ConfigSummary>(EMPTY_CONFIG)
  const [loadingConfig, setLoadingConfig] = useState(true)

  // BUG-008 (dashboard-wide follow-on, GOC-28-W06): each fetch below used to
  // leave its list at the same empty default on a failed request as on a
  // real "nothing here yet" response, with only a transient toast (or
  // nothing at all for the best-effort tools/config calls). Each now records
  // whether its most recent fetch actually reached the backend.
  const [agentsUnavailable, setAgentsUnavailable] = useState(false)
  const [toolsUnavailable, setToolsUnavailable] = useState(false)
  const [configUnavailable, setConfigUnavailable] = useState(false)

  // Compose form state
  const [composeName, setComposeName] = useState('')
  const [composeDescription, setComposeDescription] = useState('')
  const [composeInstructions, setComposeInstructions] = useState('')
  const [composeServer, setComposeServer] = useState('')
  const [composeModel, setComposeModel] = useState('')
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set())
  const [composing, setComposing] = useState(false)

  // External agent form state
  const [a2aUrl, setA2aUrl] = useState('')
  const [a2aCardJson, setA2aCardJson] = useState('')
  const [registering, setRegistering] = useState(false)

  const fetchAgents = async () => {
    try {
      setLoadingAgents(true)
      const res = await fetch('/api/enhanced/agent-library/agents')
      if (!res.ok) {
        toast.error('Failed to load the Agent Library')
        setAgentsUnavailable(true)
        return
      }
      setAgents(asArray<LibraryAgent>(await res.json()))
      setAgentsUnavailable(false)
    } catch {
      toast.error('Failed to connect to the Agent Library')
      setAgentsUnavailable(true)
    } finally {
      setLoadingAgents(false)
    }
  }

  const fetchSuggestions = async () => {
    try {
      setLoadingSuggestions(true)
      const res = await fetch('/api/enhanced/agent-library/suggestions')
      if (!res.ok) return
      setSuggestions(asArray<Suggestion>(await res.json()))
    } catch {
      // Suggestions are best-effort; a failure here should not block the page.
    } finally {
      setLoadingSuggestions(false)
    }
  }

  const fetchTools = async (server?: string) => {
    try {
      setLoadingTools(true)
      const qs = server ? `?mcp_server=${encodeURIComponent(server)}` : ''
      const res = await fetch(`/api/enhanced/agent-library/tools${qs}`)
      if (!res.ok) {
        setToolsUnavailable(true)
        return
      }
      setTools(asArray<LibraryTool>(await res.json()))
      setToolsUnavailable(false)
    } catch {
      // Best-effort catalog for the picker; the compose form still works without it --
      // but the picker must still say so rather than silently looking empty.
      setToolsUnavailable(true)
    } finally {
      setLoadingTools(false)
    }
  }

  const fetchConfig = async () => {
    try {
      setLoadingConfig(true)
      const res = await fetch('/api/enhanced/agent-library/config-summary')
      if (!res.ok) {
        setConfig(EMPTY_CONFIG)
        setConfigUnavailable(true)
        return
      }
      const data = (await res.json()) as Partial<ConfigSummary> | null
      setConfig({
        app_profile: data?.app_profile ?? '',
        deployment_profile: data?.deployment_profile ?? '',
        chat_models: asArray<ChatModelSummary>(data?.chat_models),
        embedding_models: asArray<EmbeddingModelSummary>(data?.embedding_models),
      })
      setConfigUnavailable(false)
    } catch {
      setConfig(EMPTY_CONFIG)
      setConfigUnavailable(true)
    } finally {
      setLoadingConfig(false)
    }
  }

  useEffect(() => {
    void fetchAgents()
    void fetchSuggestions()
    void fetchTools()
    void fetchConfig()
  }, [])

  const serverNames = useMemo(() => {
    const names = new Set<string>()
    for (const t of tools) {
      if (t.mcp_server) names.add(t.mcp_server)
    }
    return Array.from(names).sort()
  }, [tools])

  const toggleTool = (id: string) => {
    setSelectedToolIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startFromSuggestion = (suggestion: Suggestion) => {
    setTab('compose')
    setComposeServer(suggestion.mcp_server)
    setComposeName((prev) => prev || `${suggestion.mcp_server} agent`)
    setComposeDescription(
      (prev) => prev || `Uses the ${suggestion.mcp_server} tools: ${suggestion.sample_tools.join(', ')}.`,
    )
    void fetchTools(suggestion.mcp_server)
    toast.message(`Composing an agent for '${suggestion.mcp_server}'`)
  }

  const handleCompose = async () => {
    if (!composeName.trim() || !composeInstructions.trim()) {
      toast.error('Name and instructions are required')
      return
    }
    setComposing(true)
    try {
      const res = await fetch('/api/enhanced/agent-library/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: composeName.trim(),
          description: composeDescription.trim(),
          instructions: composeInstructions.trim(),
          bind_server: composeServer || undefined,
          model_preference: composeModel || undefined,
          tool_ids: Array.from(selectedToolIds),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        toast.error(body?.detail ?? 'Failed to compose the agent')
        return
      }
      toast.success(`Agent '${composeName.trim()}' saved and ready to delegate to`)
      setComposeName('')
      setComposeDescription('')
      setComposeInstructions('')
      setComposeServer('')
      setComposeModel('')
      setSelectedToolIds(new Set())
      setTab('library')
      void fetchAgents()
      void fetchSuggestions()
    } catch {
      toast.error('Network error composing the agent')
    } finally {
      setComposing(false)
    }
  }

  const handleArchive = async (agent: LibraryAgent) => {
    try {
      const res = await fetch(`/api/enhanced/agent-library/agents/${encodeURIComponent(agent.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error('Failed to archive that agent')
        return
      }
      toast.success(`Archived '${agent.name}'`)
      void fetchAgents()
    } catch {
      toast.error('Network error archiving the agent')
    }
  }

  const handleRegisterA2A = async () => {
    if (!a2aUrl.trim()) {
      toast.error('An agent URL is required')
      return
    }
    let agentCard: unknown
    if (a2aCardJson.trim()) {
      try {
        agentCard = JSON.parse(a2aCardJson)
      } catch {
        toast.error('The pasted agent card is not valid JSON')
        return
      }
    }
    setRegistering(true)
    try {
      const res = await fetch('/api/enhanced/agent-library/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: a2aUrl.trim(), agent_card: agentCard }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        toast.error(body?.detail ?? 'Failed to register that agent')
        return
      }
      toast.success('External agent registered')
      setA2aUrl('')
      setA2aCardJson('')
      void fetchAgents()
    } catch {
      toast.error('Network error registering the external agent')
    } finally {
      setRegistering(false)
    }
  }

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()),
  )

  const tabs: { id: TabId; label: string; icon: typeof Bot }[] = [
    { id: 'library', label: 'Library', icon: Bot },
    { id: 'compose', label: 'Compose an Agent', icon: Plus },
    { id: 'external', label: 'External Agents', icon: Globe },
    { id: 'config', label: 'Model & Config', icon: Sparkles },
  ]

  return (
    <div className="space-y-6">
      <Card className="border-border/40 bg-card/60 backdrop-blur-md">
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 via-emerald-400 to-green-500">
                Agent Library
              </CardTitle>
              <CardDescription>
                Compose agents from prompts and tools you already have, register outside A2A agents, and call on any of
                them whenever you need — stored in the knowledge graph, not your browser.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigateTo('/prompts')
                }}
              >
                Prompts Registry <ExternalLink className="size-3.5 ml-1.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigateTo('/skills')
                }}
              >
                Tools &amp; Skills <ExternalLink className="size-3.5 ml-1.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4 border-b border-border/40 pb-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id)
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all border ${
                  tab === t.id
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold'
                    : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <t.icon className="size-3.5" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent>
          {tab === 'library' && (
            <div className="space-y-6">
              {!loadingSuggestions && suggestions.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-emerald-400" /> Suggested, from what is installed
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {suggestions.slice(0, 6).map((s) => (
                      <div
                        key={s.mcp_server}
                        className="p-3.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm text-foreground">{s.mcp_server}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {s.tool_count} tool{s.tool_count === 1 ? '' : 's'}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{s.reason}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="self-start h-7 text-xs"
                          onClick={() => {
                            startFromSuggestion(s)
                          }}
                        >
                          <Plus className="size-3.5 mr-1" /> Build this agent
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search your agents..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value)
                    }}
                    className="pl-9 h-9 bg-muted/20"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => {
                    void fetchAgents()
                    void fetchSuggestions()
                  }}
                  disabled={loadingAgents}
                >
                  <RefreshCw className={`size-4 ${loadingAgents ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setTab('compose')
                  }}
                >
                  <Plus className="size-4 mr-1.5" /> New agent
                </Button>
              </div>

              <ScrollArea className="h-[calc(100vh-32rem)] min-h-[16rem] pr-2">
                {loadingAgents ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <RefreshCw className="size-8 text-emerald-500 animate-spin" />
                    <span className="text-sm text-muted-foreground font-medium">Querying the graph...</span>
                  </div>
                ) : agentsUnavailable ? (
                  <div className="text-center py-12">
                    <UnavailableNotice what="The Agent Library" className="justify-center" />
                  </div>
                ) : filteredAgents.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    No agents yet. Compose one, or register an external A2A agent.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className="p-4 rounded-xl border border-border/40 bg-muted/10 backdrop-blur-sm hover:border-emerald-500/30 transition-all flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {agent.kind === 'a2a' ? (
                                <Globe className="size-4 text-teal-400 shrink-0" />
                              ) : (
                                <Bot className="size-4 text-emerald-400 shrink-0" />
                              )}
                              <h4 className="font-bold text-sm text-foreground truncate">{agent.name}</h4>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-semibold shrink-0 ${
                                agent.kind === 'a2a'
                                  ? 'bg-teal-500/10 border-teal-500/30 text-teal-400'
                                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              }`}
                            >
                              {agent.kind === 'a2a' ? 'External · A2A' : 'Local'}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-normal line-clamp-3">
                            {agent.description || 'No description.'}
                          </p>
                          {agent.mcp_server && (
                            <div className="text-[10px] text-muted-foreground mt-2">
                              <Wrench className="size-3 inline mr-1" />
                              bound to <code className="font-mono">{agent.mcp_server}</code>
                            </div>
                          )}
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3">
                          <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                            <CheckCircle className="size-3" />
                            {agent.runnable_bound === false ? 'Prompt only' : 'Delegatable'}
                          </div>
                          <button
                            onClick={() => {
                              void handleArchive(agent)
                            }}
                            className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
                            aria-label={`Archive ${agent.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          {tab === 'compose' && (
            <div className="max-w-2xl space-y-5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Name</label>
                <Input
                  value={composeName}
                  onChange={(e) => {
                    setComposeName(e.target.value)
                  }}
                  placeholder="e.g. release-notes-writer"
                  className="mt-1 bg-muted/20"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Description
                </label>
                <Input
                  value={composeDescription}
                  onChange={(e) => {
                    setComposeDescription(e.target.value)
                  }}
                  placeholder="One line: what does this agent do for you?"
                  className="mt-1 bg-muted/20"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Instructions (its system prompt)
                </label>
                <Textarea
                  value={composeInstructions}
                  onChange={(e) => {
                    setComposeInstructions(e.target.value)
                  }}
                  placeholder="You are a specialist that..."
                  className="mt-1 bg-muted/20 font-mono text-xs leading-relaxed"
                  rows={8}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Bind an entire MCP server&apos;s tools (optional)
                  </label>
                  <select
                    value={composeServer}
                    onChange={(e) => {
                      setComposeServer(e.target.value)
                      void fetchTools(e.target.value || undefined)
                    }}
                    className="w-full h-9 mt-1 px-3 rounded-md border border-input bg-muted/20 text-xs"
                  >
                    <option value="">— none —</option>
                    {serverNames.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Preferred model (optional, advisory)
                  </label>
                  <select
                    value={composeModel}
                    onChange={(e) => {
                      setComposeModel(e.target.value)
                    }}
                    className="w-full h-9 mt-1 px-3 rounded-md border border-input bg-muted/20 text-xs"
                  >
                    <option value="">— default —</option>
                    {config.chat_models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id} ({m.provider})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Or pick individual tools
                </label>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border/20 bg-muted/5 p-2 space-y-1">
                  {loadingTools ? (
                    <div className="text-xs text-muted-foreground p-2">Loading tools...</div>
                  ) : toolsUnavailable ? (
                    <div className="p-2">
                      <UnavailableNotice what="The tool catalog" />
                    </div>
                  ) : tools.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-2">
                      No tools ingested yet for this filter — the agent can still run prompt-only.
                    </div>
                  ) : (
                    tools.map((t) => (
                      <label
                        key={t.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/20 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedToolIds.has(t.id)}
                          onCheckedChange={() => {
                            toggleTool(t.id)
                          }}
                        />
                        <span className="text-xs font-mono">{t.name}</span>
                        {t.mcp_server && (
                          <span className="text-[10px] text-muted-foreground ml-auto">{t.mcp_server}</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </div>

              <Button
                onClick={() => {
                  void handleCompose()
                }}
                disabled={composing || !composeName.trim() || !composeInstructions.trim()}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {composing ? 'Saving...' : 'Save agent to the Library'}
              </Button>
            </div>
          )}

          {tab === 'external' && (
            <div className="max-w-2xl space-y-5">
              <p className="text-xs text-muted-foreground">
                Register an outside agent that speaks the A2A protocol. Give its URL and, if it doesn&apos;t publish a
                discoverable agent card, paste the card JSON yourself.
              </p>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Agent URL
                </label>
                <Input
                  value={a2aUrl}
                  onChange={(e) => {
                    setA2aUrl(e.target.value)
                  }}
                  placeholder="https://agent.example.com"
                  className="mt-1 bg-muted/20 font-mono text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Agent card JSON (optional — auto-fetched from the URL if left blank)
                </label>
                <Textarea
                  value={a2aCardJson}
                  onChange={(e) => {
                    setA2aCardJson(e.target.value)
                  }}
                  placeholder='{"name": "...", "description": "...", "capabilities": []}'
                  className="mt-1 bg-muted/20 font-mono text-xs"
                  rows={8}
                />
              </div>
              <Button
                onClick={() => {
                  void handleRegisterA2A()
                }}
                disabled={registering || !a2aUrl.trim()}
                className="bg-teal-600 hover:bg-teal-700"
              >
                {registering ? 'Registering...' : 'Register external agent'}
              </Button>
            </div>
          )}

          {tab === 'config' && (
            <div className="space-y-6">
              {loadingConfig ? (
                <div className="flex items-center justify-center py-12 gap-3">
                  <RefreshCw className="size-8 text-emerald-500 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2">
                      <div className="text-muted-foreground">App profile</div>
                      <div className="font-bold">{config.app_profile || '—'}</div>
                    </div>
                    <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2">
                      <div className="text-muted-foreground">Deployment profile</div>
                      <div className="font-bold">{config.deployment_profile || '—'}</div>
                    </div>
                  </div>

                  {configUnavailable && <UnavailableNotice what="The model configuration summary" />}

                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                      Chat models
                    </h3>
                    {configUnavailable ? null : config.chat_models.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No chat models configured.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {config.chat_models.map((m) => (
                          <div key={m.id} className="p-3 rounded-lg border border-border/30 bg-muted/5 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-xs">{m.id}</span>
                              <Badge variant="outline" className="text-[9px]">
                                {m.provider}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {m.intelligence_level && (
                                <Badge variant="secondary" className="text-[9px]">
                                  {m.intelligence_level}
                                </Badge>
                              )}
                              {m.can_route && (
                                <Badge variant="secondary" className="text-[9px]">
                                  router
                                </Badge>
                              )}
                              {m.can_kg && (
                                <Badge variant="secondary" className="text-[9px]">
                                  kg
                                </Badge>
                              )}
                              {m.vision && (
                                <Badge variant="secondary" className="text-[9px]">
                                  vision
                                </Badge>
                              )}
                              {m.reasoning && (
                                <Badge variant="secondary" className="text-[9px]">
                                  reasoning
                                </Badge>
                              )}
                              {m.tools_enabled && (
                                <Badge variant="secondary" className="text-[9px]">
                                  tools
                                </Badge>
                              )}
                            </div>
                            {m.context_window ? (
                              <div className="text-[10px] text-muted-foreground">
                                {m.context_window.toLocaleString()} token context
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                      Embedding models
                    </h3>
                    {configUnavailable ? null : config.embedding_models.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No embedding models configured.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {config.embedding_models.map((m) => (
                          <div key={m.id} className="p-3 rounded-lg border border-border/30 bg-muted/5 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-xs">{m.id}</span>
                              <Badge variant="outline" className="text-[9px]">
                                {m.provider}
                              </Badge>
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              chunk {m.chunk_size ?? '—'}
                              {m.context_window ? ` · ${m.context_window.toLocaleString()} token context` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Read-only view of the active <code>AgentConfig</code> model registry. Secrets and provider
                    credentials are never sent to the browser.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
