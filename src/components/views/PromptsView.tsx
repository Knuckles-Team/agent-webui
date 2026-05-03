/**
 * @file PromptsView.tsx
 * @description 3-panel prompt management view with JSON editing, version history,
 * and Git-style diff visualization.
 *
 * CONCEPT:KG-002 — Prompt Management
 */

import { useState, useEffect, useMemo } from 'react'
import {
  ScrollText,
  Search,
  Save,
  RefreshCw,
  History,
  GitCompare,
  Plus,
  RotateCcw,
  Clock,
  User,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/* ── Types ─────────────────────────────────────────────────────────── */

interface Prompt {
  id: string
  name: string
  description?: string
  content: string
  capabilities?: string[]
  timestamp?: string
  type?: string
}

interface PromptVersion {
  id: string
  name: string
  content: string
  author?: string
  version_number?: number
  timestamp?: string
  parent_id?: string
}

/* ── API helpers ───────────────────────────────────────────────────── */

async function fetchPrompts(): Promise<Prompt[]> {
  const res = await fetch('/api/enhanced/prompts')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Prompt[]
}

async function fetchPrompt(id: string): Promise<Prompt> {
  const res = await fetch(`/api/enhanced/prompts/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Prompt
}

async function fetchVersions(id: string): Promise<PromptVersion[]> {
  const res = await fetch(
    `/api/enhanced/prompts/${encodeURIComponent(id)}/versions`,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as PromptVersion[]
}

async function savePrompt(
  id: string,
  content: string,
): Promise<PromptVersion> {
  const res = await fetch(`/api/enhanced/prompts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as PromptVersion
}

async function createPrompt(data: {
  name: string
  content: string
  description?: string
}): Promise<Prompt> {
  const res = await fetch('/api/enhanced/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Prompt
}

async function rollbackPrompt(
  promptId: string,
  versionId: string,
): Promise<PromptVersion> {
  const res = await fetch(
    `/api/enhanced/prompts/${encodeURIComponent(promptId)}/rollback/${encodeURIComponent(versionId)}`,
    { method: 'POST' },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as PromptVersion
}

async function fetchDiff(
  promptId: string,
  versionA: string,
  versionB: string,
): Promise<{ diff: string }> {
  const res = await fetch(
    `/api/enhanced/prompts/${encodeURIComponent(promptId)}/diff/${encodeURIComponent(versionA)}/${encodeURIComponent(versionB)}`,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as { diff: string }
}

/* ── Diff rendering ────────────────────────────────────────────────── */

function DiffViewer({ diffText }: { diffText: string }) {
  if (!diffText) {
    return (
      <p className="text-muted-foreground text-sm italic p-4">
        No differences found
      </p>
    )
  }

  const lines = diffText.split('\n')

  return (
    <pre className="text-xs font-mono leading-relaxed p-4 overflow-auto">
      {lines.map((line, idx) => {
        let className = 'block px-2 py-0.5 rounded-sm'
        if (line.startsWith('+++') || line.startsWith('---')) {
          className += ' text-muted-foreground font-semibold'
        } else if (line.startsWith('+')) {
          className += ' bg-green-500/10 text-green-400'
        } else if (line.startsWith('-')) {
          className += ' bg-red-500/10 text-red-400'
        } else if (line.startsWith('@@')) {
          className += ' text-blue-400 font-semibold'
        } else {
          className += ' text-muted-foreground/80'
        }
        return (
          <span key={idx} className={className}>
            {line || ' '}
          </span>
        )
      })}
    </pre>
  )
}

/* ── Main Component ────────────────────────────────────────────────── */

export default function PromptsView() {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [diffText, setDiffText] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '',
    content: '',
    description: '',
  })
  const [createSubmitting, setCreateSubmitting] = useState(false)

  useEffect(() => {
    void loadPrompts()
  }, [])

  const loadPrompts = async () => {
    setLoading(true)
    try {
      const data = await fetchPrompts()
      setPrompts(data)
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id)
        setEditContent(data[0].content || '')
      }
    } catch (err) {
      toast.error(`Failed to load prompts: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedId) {
      void loadPromptDetail(selectedId)
    }
  }, [selectedId])

  const loadPromptDetail = async (id: string) => {
    try {
      const prompt = await fetchPrompt(id)
      setEditContent(prompt.content || '')
    } catch (err) {
      toast.error(`Failed to load prompt: ${String(err)}`)
    }
  }

  const loadVersions = async (id: string) => {
    setLoadingVersions(true)
    try {
      const versionList = await fetchVersions(id)
      setVersions(versionList)
    } catch (err) {
      toast.error(`Failed to load versions: ${String(err)}`)
    } finally {
      setLoadingVersions(false)
    }
  }

  const handleSave = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      const result = await savePrompt(selectedId, editContent)
      toast.success(
        `Saved as version ${result.version_number ?? 'new'}`,
      )
      void loadPrompts()
      if (showHistory) void loadVersions(selectedId)
    } catch (err) {
      toast.error(`Save failed: ${String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleRollback = async (versionId: string) => {
    if (!selectedId) return
    try {
      const result = await rollbackPrompt(selectedId, versionId)
      toast.success(`Rolled back to version ${result.version_number ?? ''}`)
      void loadPromptDetail(selectedId)
      void loadVersions(selectedId)
      void loadPrompts()
    } catch (err) {
      toast.error(`Rollback failed: ${String(err)}`)
    }
  }

  const handleDiff = async (versionA: string, versionB: string) => {
    if (!selectedId) return
    try {
      const result = await fetchDiff(selectedId, versionA, versionB)
      setDiffText(result.diff)
    } catch (err) {
      toast.error(`Diff failed: ${String(err)}`)
    }
  }

  const handleCreate = async () => {
    setCreateSubmitting(true)
    try {
      const result = await createPrompt(createForm)
      toast.success(`Created prompt: ${result.name}`)
      setIsCreateOpen(false)
      setCreateForm({ name: '', content: '', description: '' })
      void loadPrompts()
      setSelectedId(result.id)
    } catch (err) {
      toast.error(`Create failed: ${String(err)}`)
    } finally {
      setCreateSubmitting(false)
    }
  }

  const toggleHistory = () => {
    const next = !showHistory
    setShowHistory(next)
    if (next && selectedId) {
      setDiffText('')
      void loadVersions(selectedId)
    }
  }

  const filteredPrompts = useMemo(() => {
    if (!searchQuery) return prompts
    const q = searchQuery.toLowerCase()
    return prompts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q),
    )
  }, [prompts, searchQuery])

  const selectedPrompt = prompts.find((p) => p.id === selectedId)

  const isJsonContent = useMemo(() => {
    try {
      JSON.parse(editContent)
      return true
    } catch {
      return false
    }
  }, [editContent])

  const formatJson = () => {
    try {
      const parsed = JSON.parse(editContent)
      setEditContent(JSON.stringify(parsed, null, 2))
      toast.success('Formatted JSON')
    } catch {
      toast.error('Content is not valid JSON')
    }
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-12rem)]" data-testid="prompts-view">
      {/* ── Panel 1: Prompt List ──────────────────────────────────── */}
      <div className="w-full md:w-72 flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search prompts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="size-3.5" />
            New
          </Button>
        </div>

        <ScrollArea className="flex-1 -mx-1">
          <div className="space-y-1 px-1">
            {loading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 bg-muted/30 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : filteredPrompts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <ScrollText className="size-8 mb-2 opacity-40" />
                <p className="text-sm">No prompts found</p>
              </div>
            ) : (
              filteredPrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  onClick={() => setSelectedId(prompt.id)}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition-all duration-200',
                    'hover:bg-muted/50 hover:border-primary/20',
                    selectedId === prompt.id
                      ? 'bg-primary/5 border-primary/30 shadow-sm'
                      : 'border-transparent',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="size-3.5 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {prompt.name}
                    </span>
                  </div>
                  {prompt.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 ml-5.5">
                      {prompt.description}
                    </p>
                  )}
                  {prompt.timestamp && (
                    <div className="flex items-center gap-1 ml-5.5 mt-1">
                      <Clock className="size-3 text-muted-foreground/60" />
                      <span className="text-[10px] text-muted-foreground/60">
                        {new Date(prompt.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => void loadPrompts()}
          disabled={loading}
        >
          <RefreshCw
            className={cn('size-3.5', loading && 'animate-spin')}
          />
          Refresh
        </Button>
      </div>

      {/* ── Panel 2: Editor ──────────────────────────────────────── */}
      <Card className="flex-1 flex flex-col overflow-hidden border-border/40 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3 border-b bg-muted/5 shrink-0">
          <div className="min-w-0">
            <CardTitle className="text-lg truncate">
              {selectedPrompt?.name || 'Select a prompt'}
            </CardTitle>
            {selectedPrompt?.description && (
              <CardDescription className="truncate">
                {selectedPrompt.description}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isJsonContent && (
              <Button
                variant="ghost"
                size="sm"
                onClick={formatJson}
                className="text-xs gap-1"
              >
                Format JSON
              </Button>
            )}
            <Button
              variant={showHistory ? 'secondary' : 'outline'}
              size="sm"
              onClick={toggleHistory}
              className="gap-1"
            >
              <History className="size-3.5" />
              <span className="hidden sm:inline">History</span>
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !selectedId}
              size="sm"
              className="gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Save className="size-3.5" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <ScrollText className="size-10 opacity-30" />
                <p className="text-sm">Select a prompt to edit</p>
              </div>
            </div>
          ) : (
            <textarea
              className="w-full h-full p-6 bg-transparent font-mono text-sm resize-none focus:outline-none leading-relaxed"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              spellCheck={false}
              placeholder="Enter prompt content..."
            />
          )}
        </CardContent>
      </Card>

      {/* ── Panel 3: History / Diff (collapsible) ────────────────── */}
      {showHistory && (
        <Card className="w-full md:w-80 flex flex-col overflow-hidden border-border/40 shadow-sm shrink-0">
          <CardHeader className="pb-3 border-b bg-muted/5 shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="size-4" />
              Version History
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden flex flex-col">
            {diffText ? (
              <div className="flex-1 overflow-auto">
                <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/5">
                  <div className="flex items-center gap-1.5">
                    <GitCompare className="size-3.5 text-primary" />
                    <span className="text-xs font-medium">Diff View</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => {
                      setDiffText('')
                    }}
                  >
                    Close
                  </Button>
                </div>
                <DiffViewer diffText={diffText} />
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-1">
                  {loadingVersions ? (
                    <div className="space-y-2 p-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-16 bg-muted/30 rounded-lg animate-pulse"
                        />
                      ))}
                    </div>
                  ) : versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No version history
                    </p>
                  ) : (
                    versions.map((version, idx) => (
                      <div
                        key={version.id}
                        className="relative p-3 rounded-lg border border-transparent hover:border-border/60 hover:bg-muted/30 transition-all group"
                      >
                        {/* Timeline rail */}
                        {idx < versions.length - 1 && (
                          <div className="absolute left-6 top-12 bottom-0 w-px bg-border/40" />
                        )}
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              'size-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold',
                              idx === 0
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {version.version_number ?? versions.length - idx}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {version.author && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] h-4 gap-0.5"
                                >
                                  <User className="size-2.5" />
                                  {version.author}
                                </Badge>
                              )}
                              {idx === 0 && (
                                <Badge className="text-[10px] h-4 bg-primary/10 text-primary border-primary/20">
                                  latest
                                </Badge>
                              )}
                            </div>
                            {version.timestamp && (
                              <p className="text-[10px] text-muted-foreground">
                                {new Date(version.timestamp).toLocaleString()}
                              </p>
                            )}
                            <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              {idx > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[10px] gap-0.5 px-1.5"
                                  onClick={() =>
                                    void handleDiff(
                                      versions[0].id,
                                      version.id,
                                    )
                                  }
                                >
                                  <GitCompare className="size-3" />
                                  Diff
                                </Button>
                              )}
                              {idx > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[10px] gap-0.5 px-1.5 text-amber-500 hover:text-amber-400"
                                  onClick={() =>
                                    void handleRollback(version.id)
                                  }
                                >
                                  <RotateCcw className="size-3" />
                                  Rollback
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Create Prompt Dialog ──────────────────────────────────── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Prompt</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm({ ...createForm, name: e.target.value })
                }
                placeholder="e.g. research-specialist"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                Description (optional)
              </label>
              <Input
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    description: e.target.value,
                  })
                }
                placeholder="Brief description of this prompt"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Content</label>
              <Textarea
                value={createForm.content}
                onChange={(e) =>
                  setCreateForm({ ...createForm, content: e.target.value })
                }
                placeholder="Enter the prompt content..."
                rows={8}
                className="font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={createSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={
                createSubmitting ||
                !createForm.name.trim() ||
                !createForm.content.trim()
              }
            >
              <Plus className="size-4 mr-2" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
