import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface MCPTool {
  name: string
  type: string
  command: string
  args: string[]
  status: string
  enabled: boolean
}

interface BuiltinTool {
  name: string
  type: string
  file_path: string
  status: string
  enabled: boolean
}

interface Skill {
  id: string
  name: string
  description?: string
  enabled: boolean
  tags: string[]
  type: string
}

interface SkillGraph {
  id: string
  name: string
  type: string
  file_path: string
  enabled: boolean
}

interface SkillWorkflow {
  id: string
  name: string
  type: string
  file_path: string
  enabled: boolean
}

interface ToolsData {
  mcp_tools: MCPTool[]
  builtin_tools: BuiltinTool[]
  skills: Skill[]
  skill_graphs: SkillGraph[]
  skill_workflows: SkillWorkflow[]
}

interface LiveMCPTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  enabled: boolean
}

export default function SkillsView() {
  const [data, setData] = useState<ToolsData>({
    mcp_tools: [],
    builtin_tools: [],
    skills: [],
    skill_graphs: [],
    skill_workflows: [],
  })
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'mcp' | 'builtin' | 'cognitive'>('mcp')

  // Track expanded MCP servers and their loaded tools
  const [expandedMcp, setExpandedMcp] = useState<Record<string, boolean | undefined>>({})
  const [mcpTools, setMcpTools] = useState<Record<string, LiveMCPTool[] | undefined>>({})
  const [loadingMcpTools, setLoadingMcpTools] = useState<Record<string, boolean | undefined>>({})

  useEffect(() => {
    void fetchTools()
  }, [])

  const fetchTools = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/enhanced/tools')
      if (!res.ok) {
        toast.error('Failed to load tools catalog')
        return
      }
      const json = (await res.json()) as ToolsData
      setData(json)
    } catch {
      toast.error('Failed to connect to backend tools registry')
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

  // Filters
  const filteredMcp = data.mcp_tools.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const filteredBuiltin = data.builtin_tools.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const filteredSkills = data.skills.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const filteredGraphs = data.skill_graphs.filter((g) => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const filteredWorkflows = data.skill_workflows.filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

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
                    {filteredMcp.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground text-sm">No MCP servers registered.</div>
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
                                  </div>
                                </div>
                                <div className="space-y-1.5 mt-2">
                                  <div className="text-xs text-muted-foreground">
                                    <span className="font-semibold text-foreground">Command: </span>
                                    <code className="font-mono bg-muted/40 px-1 py-0.5 rounded text-[10px]">
                                      {server.command}
                                    </code>
                                  </div>
                                  {server.args.length > 0 && (
                                    <div className="text-xs text-muted-foreground">
                                      <span className="font-semibold text-foreground">Args: </span>
                                      <code className="font-mono bg-muted/40 px-1 py-0.5 rounded text-[10px]">
                                        {server.args.join(' ')}
                                      </code>
                                    </div>
                                  )}
                                </div>
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
                                          <span>Discovering tools via stdio handshake...</span>
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

                {/* 3. Cognitive Registry - 3 Separate Side-by-Side boxes */}
                {activeTab === 'cognitive' && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Box 1: Agent Skills */}
                    <div className="space-y-4 border border-border/40 rounded-xl bg-card/40 p-4">
                      <div className="flex items-center gap-2 border-b border-border/20 pb-3 mb-2">
                        <Zap className="size-5 text-emerald-400" />
                        <div>
                          <h3 className="font-bold text-sm text-foreground">Agent Skills</h3>
                          <p className="text-[10px] text-muted-foreground">Dynamic cognitive modular skills</p>
                        </div>
                        <Badge variant="secondary" className="ml-auto px-1.5 text-[10px] bg-muted/40">
                          {filteredSkills.length}
                        </Badge>
                      </div>

                      <ScrollArea className="h-[calc(100vh-27rem)] pr-2">
                        <div className="space-y-3">
                          {filteredSkills.length === 0 ? (
                            <div className="text-center py-6 text-xs text-muted-foreground">
                              No matching skills found.
                            </div>
                          ) : (
                            filteredSkills.map((skill) => (
                              <div
                                key={skill.id}
                                className="p-3.5 rounded-lg border border-border/30 bg-muted/5 hover:border-emerald-500/20 transition-all flex flex-col justify-between space-y-2"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="font-bold text-xs text-foreground">{skill.name}</span>
                                  <button
                                    onClick={() => {
                                      void handleToggleCognitive('skill', skill.id, skill.enabled)
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 transition-all ${
                                      skill.enabled
                                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                                    }`}
                                  >
                                    {skill.enabled ? 'ON' : 'OFF'}
                                  </button>
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-normal line-clamp-3">
                                  {skill.description ?? 'No description available.'}
                                </p>
                                {skill.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {skill.tags.slice(0, 3).map((t) => (
                                      <Badge
                                        key={t}
                                        variant="secondary"
                                        className="text-[8px] bg-muted/40 font-semibold scale-90 origin-left"
                                      >
                                        {t}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>

                    {/* Box 2: Skill Graphs */}
                    <div className="space-y-4 border border-border/40 rounded-xl bg-card/40 p-4">
                      <div className="flex items-center gap-2 border-b border-border/20 pb-3 mb-2">
                        <Network className="size-5 text-teal-400" />
                        <div>
                          <h3 className="font-bold text-sm text-foreground">Skill Graphs</h3>
                          <p className="text-[10px] text-muted-foreground">Epistemic connection abstractions</p>
                        </div>
                        <Badge variant="secondary" className="ml-auto px-1.5 text-[10px] bg-muted/40">
                          {filteredGraphs.length}
                        </Badge>
                      </div>

                      <ScrollArea className="h-[calc(100vh-27rem)] pr-2">
                        <div className="space-y-3">
                          {filteredGraphs.length === 0 ? (
                            <div className="text-center py-6 text-xs text-muted-foreground">
                              No matching graphs found.
                            </div>
                          ) : (
                            filteredGraphs.map((graph) => (
                              <div
                                key={graph.id}
                                className="p-3.5 rounded-lg border border-border/30 bg-muted/5 hover:border-emerald-500/20 transition-all flex flex-col justify-between space-y-2"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="font-bold text-xs text-foreground">{graph.name}</span>
                                  <button
                                    onClick={() => {
                                      void handleToggleCognitive('skill_graph', graph.id, graph.enabled)
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 transition-all ${
                                      graph.enabled
                                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                                    }`}
                                  >
                                    {graph.enabled ? 'ON' : 'OFF'}
                                  </button>
                                </div>
                                <div className="text-[9px] text-muted-foreground font-mono truncate break-all">
                                  {graph.file_path}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>

                    {/* Box 3: Skill Workflows */}
                    <div className="space-y-4 border border-border/40 rounded-xl bg-card/40 p-4">
                      <div className="flex items-center gap-2 border-b border-border/20 pb-3 mb-2">
                        <GitBranch className="size-5 text-green-400" />
                        <div>
                          <h3 className="font-bold text-sm text-foreground">Skill Workflows</h3>
                          <p className="text-[10px] text-muted-foreground">Orchestrated execution pipelines</p>
                        </div>
                        <Badge variant="secondary" className="ml-auto px-1.5 text-[10px] bg-muted/40">
                          {filteredWorkflows.length}
                        </Badge>
                      </div>

                      <ScrollArea className="h-[calc(100vh-27rem)] pr-2">
                        <div className="space-y-3">
                          {filteredWorkflows.length === 0 ? (
                            <div className="text-center py-6 text-xs text-muted-foreground">
                              No matching workflows found.
                            </div>
                          ) : (
                            filteredWorkflows.map((wf) => (
                              <div
                                key={wf.id}
                                className="p-3.5 rounded-lg border border-border/30 bg-muted/5 hover:border-emerald-500/20 transition-all flex flex-col justify-between space-y-2"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="font-bold text-xs text-foreground">{wf.name}</span>
                                  <button
                                    onClick={() => {
                                      void handleToggleCognitive('skill_workflow', wf.id, wf.enabled)
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 transition-all ${
                                      wf.enabled
                                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                                    }`}
                                  >
                                    {wf.enabled ? 'ON' : 'OFF'}
                                  </button>
                                </div>
                                <div className="text-[9px] text-muted-foreground font-mono truncate break-all">
                                  {wf.file_path}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                )}
              </>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
