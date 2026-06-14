import { useState, useEffect } from 'react'
import { FileText, Search, Save, RefreshCw, Code, X, Wrench, Sparkles, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface PromptSummary {
  name: string
  title: string
  goal: string
  core_directive: string
  file_path: string
}

export default function PromptsView() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [promptDetail, setPromptDetail] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editMode, setEditMode] = useState<'form' | 'json'>('form')
  const [rawJsonText, setRawJsonText] = useState('')
  const [newTool, setNewTool] = useState('')

  useEffect(() => {
    void loadPrompts()
  }, [])

  const loadPrompts = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/enhanced/prompts')
      if (!res.ok) {
        toast.error('Failed to load prompts')
        return
      }
      const data = (await res.json()) as PromptSummary[]
      setPrompts(data)
      if (data.length > 0 && !selectedName) {
        void loadPromptDetail(data[0].name)
      }
    } catch {
      toast.error('Error connecting to prompts registry')
    } finally {
      setLoading(false)
    }
  }

  const loadPromptDetail = async (name: string) => {
    try {
      setSelectedName(name)
      const res = await fetch(`/api/enhanced/prompts/${name}`)
      if (!res.ok) {
        toast.error('Failed to load prompt details')
        return
      }
      const data = await res.json()
      setPromptDetail(data)
      setRawJsonText(JSON.stringify(data, null, 4))
    } catch {
      toast.error('Error fetching prompt content')
    }
  }

  const handleFieldChange = (key: string, val: string) => {
    const updated = { ...promptDetail, [key]: val }
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
  }

  const handleNestedFieldChange = (section: string, key: string, val: any) => {
    const updated = {
      ...promptDetail,
      [section]: {
        ...(promptDetail[section] || {}),
        [key]: val,
      },
    }
    // Sync flat fields for compatibility
    if (section === 'identity' && key === 'role') updated.title = val
    if (section === 'identity' && key === 'goal') updated.goal = val
    if (section === 'instructions' && key === 'core_directive') updated.core_directive = val

    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
  }

  const handleAddTool = () => {
    if (!newTool.trim()) return
    const currentTools = promptDetail.tools || []
    if (currentTools.includes(newTool.trim())) {
      toast.error('Tool already added')
      return
    }
    const updatedTools = [...currentTools, newTool.trim()]
    const updated = { ...promptDetail, tools: updatedTools }
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
    setNewTool('')
  }

  const handleRemoveTool = (toolName: string) => {
    const currentTools = promptDetail.tools || []
    const updatedTools = currentTools.filter((t: string) => t !== toolName)
    const updated = { ...promptDetail, tools: updatedTools }
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
  }

  const handleSave = async () => {
    if (!selectedName) return
    setSaving(true)
    try {
      let payload = promptDetail
      if (editMode === 'json') {
        try {
          payload = JSON.parse(rawJsonText)
        } catch (e: any) {
          toast.error(`Invalid JSON syntax: ${e.message}`)
          setSaving(false)
          return
        }
      }
      const res = await fetch(`/api/enhanced/prompts/${selectedName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        toast.error('Failed to save prompt config')
        return
      }
      toast.success('Prompt configuration saved successfully')
      void loadPrompts()
    } catch {
      toast.error('Error sending save request')
    } finally {
      setSaving(false)
    }
  }

  const filteredPrompts = prompts.filter(
    (p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      {/* 1. Sidebar - Prompt List */}
      <Card className="lg:col-span-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-teal-400">
              Prompt Profiles
            </CardTitle>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => void loadPrompts()}>
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
          <CardDescription>System prompts stored in agent-utilities prompts package.</CardDescription>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search prompts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 bg-muted/20"
            />
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full px-4">
            <div className="space-y-2 pb-4">
              {loading ? (
                <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
              ) : filteredPrompts.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">No prompts found</div>
              ) : (
                filteredPrompts.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => void loadPromptDetail(p.name)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                      selectedName === p.name
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold'
                        : 'border-border/30 bg-muted/10 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <FileText className="size-4 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-bold text-xs truncate">{p.title}</div>
                      <div className="text-[10px] opacity-70 truncate font-mono mt-0.5">{p.name}.json</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 2. Main Prompt Editor panel */}
      <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardHeader className="border-b border-border/30 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-bold text-foreground">
                {promptDetail?.title || selectedName || 'Prompt Editor'}
              </CardTitle>
              <CardDescription>Customize behavior directives, goals, and role specifications.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex border border-border/40 rounded-lg p-0.5 bg-muted/30">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditMode('form')}
                  className={`h-7 px-2.5 text-xs font-semibold ${editMode === 'form' ? 'bg-emerald-500/10 text-emerald-400 font-bold' : ''}`}
                >
                  Form
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditMode('json')}
                  className={`h-7 px-2.5 text-xs font-semibold ${editMode === 'json' ? 'bg-emerald-500/10 text-emerald-400 font-bold' : ''}`}
                >
                  Raw JSON
                </Button>
              </div>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving || !promptDetail}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Save className="size-4 mr-1.5" />
                {saving ? 'Saving…' : 'Save Config'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-4">
          {promptDetail ? (
            <ScrollArea className="h-full pr-2">
              {editMode === 'form' ? (
                <div className="space-y-6 pb-8">
                  {/* General Profile Parameters */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Task ID
                      </label>
                      <Input
                        value={promptDetail.task || ''}
                        onChange={(e) => handleFieldChange('task', e.target.value)}
                        className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Profile Type
                      </label>
                      <Input
                        value={promptDetail.type || ''}
                        onChange={(e) => handleFieldChange('type', e.target.value)}
                        className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Version
                      </label>
                      <Input
                        value={promptDetail.version || ''}
                        onChange={(e) => handleFieldChange('version', e.target.value)}
                        className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
                      />
                    </div>
                  </div>

                  {/* Identity & Mission */}
                  <div className="space-y-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
                    <div className="flex items-center gap-2 border-b border-border/30 pb-2 mb-2">
                      <Sparkles className="size-4 text-emerald-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Identity & Mission
                      </h3>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Role / Title
                      </label>
                      <Input
                        value={promptDetail.identity?.role || promptDetail.title || ''}
                        onChange={(e) => handleNestedFieldChange('identity', 'role', e.target.value)}
                        className="mt-1.5 bg-muted/20 text-xs font-medium"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Goal / Core Intent
                      </label>
                      <Textarea
                        value={promptDetail.identity?.goal || promptDetail.goal || ''}
                        onChange={(e) => handleNestedFieldChange('identity', 'goal', e.target.value)}
                        className="mt-1.5 bg-muted/20 text-xs leading-relaxed"
                        rows={3}
                      />
                    </div>
                  </div>

                  {/* Metadata (Topic, Tone, Style) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Topic
                      </label>
                      <Input
                        value={promptDetail.metadata?.topic || ''}
                        onChange={(e) => handleNestedFieldChange('metadata', 'topic', e.target.value)}
                        className="mt-1 h-8 bg-muted/20 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Tone
                      </label>
                      <Input
                        value={promptDetail.metadata?.tone || ''}
                        onChange={(e) => handleNestedFieldChange('metadata', 'tone', e.target.value)}
                        className="mt-1 h-8 bg-muted/20 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Style
                      </label>
                      <Input
                        value={promptDetail.metadata?.style || ''}
                        onChange={(e) => handleNestedFieldChange('metadata', 'style', e.target.value)}
                        className="mt-1 h-8 bg-muted/20 text-xs"
                      />
                    </div>
                  </div>

                  {/* Core Behavior Directive */}
                  <div className="space-y-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
                    <div className="flex items-center gap-2 border-b border-border/30 pb-2 mb-2">
                      <Settings className="size-4 text-emerald-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Behavior Directives
                      </h3>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        System Prompt Directive
                      </label>
                      <Textarea
                        value={promptDetail.instructions?.core_directive || promptDetail.core_directive || ''}
                        onChange={(e) => handleNestedFieldChange('instructions', 'core_directive', e.target.value)}
                        className="mt-1.5 bg-muted/20 font-mono text-xs leading-relaxed"
                        rows={12}
                      />
                    </div>
                  </div>

                  {/* Core Provisioned Tools */}
                  <div className="space-y-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
                    <div className="flex items-center gap-2 border-b border-border/30 pb-2 mb-2">
                      <Wrench className="size-4 text-emerald-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Provisioned Capabilities
                      </h3>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Active Skill & Tool Tokens
                      </label>
                      <div className="flex flex-wrap gap-1.5 mt-2 p-2 border border-border/20 rounded-lg min-h-[4rem] bg-muted/10 items-start">
                        {(promptDetail.tools || []).length === 0 ? (
                          <span className="text-xs text-muted-foreground italic p-1">
                            No tools bound to this profile.
                          </span>
                        ) : (
                          (promptDetail.tools || []).map((tool: string) => (
                            <Badge
                              key={tool}
                              variant="secondary"
                              className="flex items-center gap-1 text-[10px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400 px-2 py-0.75 hover:bg-emerald-500/20 transition-all font-semibold"
                            >
                              {tool}
                              <button
                                onClick={() => handleRemoveTool(tool)}
                                className="hover:text-red-400 transition-colors ml-0.5 shrink-0"
                              >
                                <X className="size-3" />
                              </button>
                            </Badge>
                          ))
                        )}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Input
                          placeholder="Enter tool or skill name (e.g. react-docs)..."
                          value={newTool}
                          onChange={(e) => setNewTool(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleAddTool()
                            }
                          }}
                          className="h-8 bg-muted/20 text-xs"
                        />
                        <Button
                          size="sm"
                          onClick={handleAddTool}
                          className="h-8 bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold shrink-0"
                        >
                          Bind Tool
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col pb-4">
                  <Textarea
                    value={rawJsonText}
                    onChange={(e) => setRawJsonText(e.target.value)}
                    className="flex-1 font-mono text-xs bg-muted/10 border-border/40 p-4 resize-none h-[calc(100vh-22rem)]"
                    placeholder="Enter valid configuration JSON..."
                  />
                </div>
              )}
            </ScrollArea>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <Code className="size-12 text-muted-foreground/30 mb-2" />
              <div className="text-sm font-semibold text-muted-foreground">No Prompt Selected</div>
              <p className="text-xs text-muted-foreground/75 mt-1 max-w-xs">
                Select a prompt profile from the sidebar list to inspect or modify its parameters.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
