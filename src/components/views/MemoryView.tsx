import { useState, useEffect } from 'react'
import { z } from 'zod'
import { Brain, Plus, Search, Link2, Trash2, Edit2, Calendar, Tag, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { fetchValidated, ApiError, looseArray } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'

const memoryNodeSchema = z.object({
  id: z.string(),
  content: z.string(),
  importance: z.number().min(0).max(1),
  tags: looseArray(z.string()).optional(),
  created_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Expected a valid creation timestamp'),
  updated_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Expected a valid update timestamp'),
  linked_nodes: looseArray(z.string()).optional(),
})

const memoryMutationResponseSchema = z.object({
  status: z.string(),
  id: z.string().optional(),
})

interface MemoryNode {
  id: string
  content: string
  importance: number
  tags?: string[]
  created_at: string
  updated_at: string
  linked_nodes?: string[]
}

interface MemoryFormState {
  id: string
  content: string
  importance: number
  tags: string[]
}

const EMPTY_MEMORY_FORM: MemoryFormState = { id: '', content: '', importance: 0.5, tags: [] }

function memoryPreview(content: string): string {
  return content.length > 100 ? `${content.slice(0, 100)}…` : content
}

function memoryActionLabel(memory: MemoryNode): string {
  return `Open memory ${memory.id}: ${memoryPreview(memory.content)}`
}

function memoryFormValidationError(form: { content: string; importance: number }): string | null {
  if (!form.content.trim()) return 'Memory content is required.'
  if (!Number.isFinite(form.importance) || form.importance < 0 || form.importance > 1) {
    return 'Importance must be between 0% and 100%.'
  }
  return null
}

function memoryErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function handleMemoryLoadError(
  error: unknown,
  setSessionExpired: (value: boolean) => void,
  setMemoryError: (value: string | null) => void,
): void {
  if (error instanceof ApiError && error.status === 401) {
    setSessionExpired(true)
    return
  }
  const message = memoryErrorMessage(error, 'The memory service returned an invalid response.')
  setMemoryError(message)
  toast.error('Failed to load memories', { description: message })
}

function hasFormFieldError(error: string | null, field: string): boolean {
  return error?.toLowerCase().includes(field.toLowerCase()) ?? false
}

function formFieldDescriptionId(prefix: string, field: string, error: string | null): string {
  return error ? `${prefix}-${field}-help ${prefix}-form-error` : `${prefix}-${field}-help`
}

function renderMemoryFormError(prefix: string, error: string | null) {
  if (!error) return null
  return (
    <p id={`${prefix}-form-error`} className="text-sm text-destructive" role="alert">
      {error}
    </p>
  )
}

function renderMemoryLoadError(error: string | null, onRetry: () => void) {
  if (!error) return null
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
      <p className="font-medium text-destructive">Memories could not be loaded.</p>
      <p className="mt-1 text-muted-foreground">{error}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

async function createMemory({
  form,
  setFormError,
  setIsCreateDialogOpen,
  setMemoryForm,
  fetchMemories,
}: {
  form: MemoryFormState
  setFormError: (value: string | null) => void
  setIsCreateDialogOpen: (value: boolean) => void
  setMemoryForm: (value: MemoryFormState) => void
  fetchMemories: () => Promise<void>
}): Promise<void> {
  const validationError = memoryFormValidationError(form)
  if (validationError) {
    setFormError(validationError)
    return
  }
  try {
    await fetchValidated('/api/enhanced/graph/memory', memoryMutationResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        id: form.id || `mem_${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    })
    toast.success('Memory created successfully')
    setIsCreateDialogOpen(false)
    setMemoryForm(EMPTY_MEMORY_FORM)
    setFormError(null)
    await fetchMemories()
  } catch (error: unknown) {
    const message = memoryErrorMessage(error, 'The memory service rejected this record.')
    toast.error('Failed to create memory', { description: message })
  }
}

async function updateMemory({
  memoryId,
  form,
  setFormError,
  setIsEditDialogOpen,
  setEditingMemoryId,
  setSelectedMemory,
  setMemoryForm,
  fetchMemories,
}: {
  memoryId: string | null
  form: MemoryFormState
  setFormError: (value: string | null) => void
  setIsEditDialogOpen: (value: boolean) => void
  setEditingMemoryId: (value: string | null) => void
  setSelectedMemory: (value: MemoryNode | null) => void
  setMemoryForm: (value: MemoryFormState) => void
  fetchMemories: () => Promise<void>
}): Promise<void> {
  if (!memoryId) return
  const validationError = memoryFormValidationError(form)
  if (validationError) {
    setFormError(validationError)
    return
  }
  try {
    await fetchValidated(`/api/enhanced/graph/memory/${memoryId}`, memoryMutationResponseSchema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, updated_at: new Date().toISOString() }),
    })
    toast.success('Memory updated successfully')
    setIsEditDialogOpen(false)
    setEditingMemoryId(null)
    setSelectedMemory(null)
    setMemoryForm(EMPTY_MEMORY_FORM)
    setFormError(null)
    await fetchMemories()
  } catch (error: unknown) {
    const message = memoryErrorMessage(error, 'The memory service rejected this record.')
    toast.error('Failed to update memory', { description: message })
  }
}

function MemoryBrowseCard({
  memory,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  memory: MemoryNode
  selected: boolean
  onSelect: (memory: MemoryNode) => void
  onEdit: (memory: MemoryNode) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card className={cn('transition-all hover:shadow-md', selected ? 'ring-2 ring-primary' : '')}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <button
            type="button"
            aria-pressed={selected}
            aria-label={memoryActionLabel(memory)}
            className="flex-1 border-0 bg-transparent text-left"
            onClick={() => {
              onSelect(memory)
            }}
          >
            <span className="block text-base font-semibold line-clamp-2">{memoryPreview(memory.content)}</span>
            <span className="block text-xs text-muted-foreground">{new Date(memory.created_at).toLocaleString()}</span>
          </button>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Edit memory: ${memory.id}`}
              onClick={(event) => {
                event.stopPropagation()
                onEdit(memory)
              }}
            >
              <Edit2 className="size-3" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Delete memory: ${memory.id}`}
              onClick={(event) => {
                event.stopPropagation()
                onDelete(memory.id)
              }}
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-3 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Importance:</span>
            <div className="flex-1">
              <div
                className="h-2 bg-muted rounded-full overflow-hidden"
                role="progressbar"
                aria-label={`Importance of memory ${memory.id}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={memory.importance * 100}
                aria-valuetext={`${(memory.importance * 100).toFixed(0)} percent`}
              >
                <div className="h-full bg-primary" style={{ width: `${memory.importance * 100}%` }} />
              </div>
            </div>
            <span className="text-xs font-medium">{(memory.importance * 100).toFixed(0)}%</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(memory.tags ?? []).slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                <Tag className="size-2 mr-1" aria-hidden="true" />
                {tag}
              </Badge>
            ))}
            {(memory.tags ?? []).length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{(memory.tags ?? []).length - 3}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MemoryTimelineCard({
  memory,
  selected,
  onSelect,
}: {
  memory: MemoryNode
  selected: boolean
  onSelect: (memory: MemoryNode) => void
}) {
  return (
    <div className="relative">
      <div
        className="absolute left-[-26px] w-4 h-4 rounded-full bg-primary border-2 border-background"
        aria-hidden="true"
      />
      <Card className={cn('hover:shadow-md transition-all', selected ? 'ring-2 ring-primary' : '')}>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={memoryActionLabel(memory)}
          className="w-full border-0 bg-transparent text-left"
          onClick={() => {
            onSelect(memory)
          }}
        >
          <span className="flex items-start justify-between p-6">
            <span className="flex-1">
              <span className="mb-1 flex items-center gap-2">
                <Calendar className="size-3 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs text-muted-foreground">{new Date(memory.created_at).toLocaleString()}</span>
              </span>
              <span className="block text-base font-semibold line-clamp-2">{memoryPreview(memory.content)}</span>
            </span>
            <Badge variant="outline" className="text-xs">
              {(memory.importance * 100).toFixed(0)}%
            </Badge>
          </span>
        </button>
      </Card>
    </div>
  )
}

function MemorySearchCard({
  memory,
  selected,
  onSelect,
}: {
  memory: MemoryNode
  selected: boolean
  onSelect: (memory: MemoryNode) => void
}) {
  return (
    <Card className={cn('hover:shadow-md transition-all', selected ? 'ring-2 ring-primary' : '')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            aria-pressed={selected}
            aria-label={memoryActionLabel(memory)}
            className="flex-1 border-0 bg-transparent text-left"
            onClick={() => {
              onSelect(memory)
            }}
          >
            <span className="block text-sm line-clamp-2">{memory.content}</span>
            <span className="mt-2 flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {(memory.importance * 100).toFixed(0)}%
              </Badge>
              {(memory.tags ?? []).slice(0, 2).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </span>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled
            title="Linking memories is not available yet"
            aria-label={`Link memory ${memory.id} (not available yet)`}
          >
            <Link2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function renderBrowseResults({
  loading,
  memories,
  sortedMemories,
  selectedMemory,
  onSelect,
  onEdit,
  onDelete,
}: {
  loading: boolean
  memories: MemoryNode[]
  sortedMemories: MemoryNode[]
  selectedMemory: MemoryNode | null
  onSelect: (memory: MemoryNode) => void
  onEdit: (memory: MemoryNode) => void
  onDelete: (id: string) => void
}) {
  if (loading) {
    return (
      <p className="text-center text-muted-foreground col-span-3" role="status">
        Loading memories…
      </p>
    )
  }
  if (sortedMemories.length === 0) {
    return (
      <p className="text-center text-muted-foreground col-span-3">
        {memories.length === 0 ? 'No memories found' : 'No memories match this search.'}
      </p>
    )
  }
  return sortedMemories.map((memory) => (
    <MemoryBrowseCard
      key={memory.id}
      memory={memory}
      selected={selectedMemory?.id === memory.id}
      onSelect={onSelect}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  ))
}

export default function MemoryView() {
  const [memories, setMemories] = useState<MemoryNode[]>([])
  const [selectedMemory, setSelectedMemory] = useState<MemoryNode | null>(null)
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('browse')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [memoryForm, setMemoryForm] = useState<MemoryFormState>(EMPTY_MEMORY_FORM)
  const [tagInput, setTagInput] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    void fetchMemories()
  }, [])

  const fetchMemories = async () => {
    try {
      setLoading(true)
      const data = await fetchValidated('/api/enhanced/graph/nodes?node_type=Memory', looseArray(memoryNodeSchema))
      setSessionExpired(false)
      setMemoryError(null)
      setMemories(data)
    } catch (err) {
      handleMemoryLoadError(err, setSessionExpired, setMemoryError)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateMemory = () => {
    void createMemory({ form: memoryForm, setFormError, setIsCreateDialogOpen, setMemoryForm, fetchMemories })
  }

  const handleUpdateMemory = () => {
    void updateMemory({
      memoryId: editingMemoryId,
      form: memoryForm,
      setFormError,
      setIsEditDialogOpen,
      setEditingMemoryId,
      setSelectedMemory,
      setMemoryForm,
      fetchMemories,
    })
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await fetchValidated(`/api/enhanced/graph/memory/${id}`, memoryMutationResponseSchema, {
        method: 'DELETE',
      })
      toast.success('Memory deleted successfully')
      void fetchMemories()
      if (selectedMemory?.id === id) {
        setSelectedMemory(null)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'The memory service rejected this request.'
      toast.error('Failed to delete memory', { description: message })
    }
  }

  const handleAddTag = () => {
    if (tagInput.trim() && !memoryForm.tags.includes(tagInput.trim())) {
      setMemoryForm({ ...memoryForm, tags: [...memoryForm.tags, tagInput.trim()] })
      setTagInput('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    setMemoryForm({ ...memoryForm, tags: memoryForm.tags.filter((t) => t !== tag) })
  }

  const openEditDialog = (memory: MemoryNode) => {
    setEditingMemoryId(memory.id)
    setMemoryForm({
      id: memory.id,
      content: memory.content,
      importance: memory.importance,
      tags: memory.tags ?? [],
    })
    setIsEditDialogOpen(true)
  }

  const filteredMemories = memories.filter(
    (memory) =>
      memory.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      memory.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (memory.tags ?? []).some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  const sortedMemories = [...filteredMemories].sort((a, b) => {
    // Sort by importance first, then by date
    if (b.importance !== a.importance) {
      return b.importance - a.importance
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  if (sessionExpired) {
    return <SessionExpiredNotice />
  }

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="size-6" aria-hidden="true" />
            Memory Management
          </h1>
          <p className="text-muted-foreground text-sm">
            Browse saved knowledge, inspect why it matters, and add or update memories for future work.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            aria-busy={loading}
            onClick={() => {
              void fetchMemories()
            }}
          >
            Refresh
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button">
                <Plus className="size-4 mr-2" aria-hidden="true" />
                Add Memory
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Memory</DialogTitle>
                <DialogDescription>Save a concise fact, decision, or reminder for later retrieval.</DialogDescription>
              </DialogHeader>
              <MemoryForm
                idPrefix="create-memory"
                form={memoryForm}
                setForm={setMemoryForm}
                tagInput={tagInput}
                setTagInput={setTagInput}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                onSubmit={() => {
                  handleCreateMemory()
                }}
                error={formError}
                onClearError={() => {
                  setFormError(null)
                }}
                submitLabel="Create Memory"
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {renderMemoryLoadError(memoryError, () => {
        void fetchMemories()
      })}

      <Tabs value={activeTab} onValueChange={setActiveTab} aria-label="Memory views">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
        </TabsList>

        {/* Browse Tab */}
        <TabsContent value="browse" className="space-y-4">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <label htmlFor="memory-browse-search" className="sr-only">
                Search memories
              </label>
              <Input
                id="memory-browse-search"
                type="search"
                placeholder="Search memories..."
                className="pl-9"
                value={searchQuery}
                aria-controls="memory-browse-results"
                aria-describedby="memory-browse-search-help"
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                }}
              />
              <p id="memory-browse-search-help" className="sr-only">
                Search by memory text, identifier, or tag. Results update as you type.
              </p>
            </div>
          </div>

          <div
            id="memory-browse-results"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            aria-live="polite"
          >
            {renderBrowseResults({
              loading,
              memories,
              sortedMemories,
              selectedMemory,
              onSelect: setSelectedMemory,
              onEdit: openEditDialog,
              onDelete: (id) => {
                void handleDeleteMemory(id)
              },
            })}
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="space-y-4">
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
            <div className="space-y-6 pl-10">
              {sortedMemories.map((memory) => (
                <MemoryTimelineCard
                  key={memory.id}
                  memory={memory}
                  selected={selectedMemory?.id === memory.id}
                  onSelect={setSelectedMemory}
                />
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Search Tab */}
        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Advanced Search</CardTitle>
              <CardDescription>Search across memory content and tags</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <label htmlFor="memory-advanced-search" className="sr-only">
                    Search memories
                  </label>
                  <Input
                    id="memory-advanced-search"
                    type="search"
                    placeholder="Search memories..."
                    className="pl-9"
                    value={searchQuery}
                    aria-controls="memory-search-results"
                    aria-describedby="memory-advanced-search-help"
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                    }}
                  />
                  <p id="memory-advanced-search-help" className="sr-only">
                    Search by memory text, identifier, or tag. Results update as you type.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!searchQuery}
                    aria-label="Clear memory search"
                    onClick={() => {
                      setSearchQuery('')
                    }}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    disabled
                    title="Search is applied as you type"
                    onClick={() => {
                      // Search is applied immediately by the filteredMemories derivation.
                    }}
                  >
                    Search applied automatically
                  </Button>
                </div>
                <div id="memory-search-results" className="text-sm text-muted-foreground" aria-live="polite">
                  Found {sortedMemories.length} {sortedMemories.length === 1 ? 'memory' : 'memories'}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {sortedMemories.map((memory) => (
              <MemorySearchCard
                key={memory.id}
                memory={memory}
                selected={selectedMemory?.id === memory.id}
                onSelect={setSelectedMemory}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Memory Detail Dialog */}
      {selectedMemory && (
        <Dialog
          open={!!selectedMemory}
          onOpenChange={() => {
            setSelectedMemory(null)
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Memory Details</DialogTitle>
              <DialogDescription>Review this saved item or choose an action below.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                <div>
                  <span className="text-sm font-medium">Content</span>
                  <p className="text-sm mt-1">{selectedMemory.content}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium">Importance</span>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          role="progressbar"
                          aria-label={`Importance of memory ${selectedMemory.id}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={selectedMemory.importance * 100}
                          aria-valuetext={`${(selectedMemory.importance * 100).toFixed(0)} percent`}
                          style={{ width: `${selectedMemory.importance * 100}%` }}
                        />
                      </div>
                      <span className="text-sm">{(selectedMemory.importance * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-medium">Created</span>
                    <p className="text-sm mt-1">{new Date(selectedMemory.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div>
                  <span className="text-sm font-medium">Tags</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(selectedMemory.tags ?? []).map((tag) => (
                      <Badge key={tag} variant="secondary">
                        <Tag className="size-2 mr-1" aria-hidden="true" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    onClick={() => {
                      setSelectedMemory(null)
                      openEditDialog(selectedMemory)
                    }}
                  >
                    <Edit2 className="size-4 mr-2" aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      void handleDeleteMemory(selectedMemory.id)
                      setSelectedMemory(null)
                    }}
                  >
                    <Trash2 className="size-4 mr-2" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Memory</DialogTitle>
            <DialogDescription>Update the content, importance, or tags for this memory.</DialogDescription>
          </DialogHeader>
          <MemoryForm
            idPrefix="edit-memory"
            form={memoryForm}
            setForm={setMemoryForm}
            tagInput={tagInput}
            setTagInput={setTagInput}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onSubmit={() => {
              handleUpdateMemory()
            }}
            error={formError}
            onClearError={() => {
              setFormError(null)
            }}
            submitLabel="Update Memory"
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MemoryForm({
  idPrefix,
  form,
  setForm,
  tagInput,
  setTagInput,
  onAddTag,
  onRemoveTag,
  onSubmit,
  error,
  onClearError,
  submitLabel,
}: {
  idPrefix: string
  form: MemoryFormState
  setForm: (form: MemoryFormState) => void
  tagInput: string
  setTagInput: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
  onSubmit: () => void
  error: string | null
  onClearError: () => void
  submitLabel: string
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      noValidate
    >
      <div>
        <label htmlFor={`${idPrefix}-content`} className="text-sm font-medium">
          Content <span aria-hidden="true">(required)</span>
        </label>
        <Textarea
          id={`${idPrefix}-content`}
          value={form.content}
          required
          aria-required="true"
          aria-invalid={hasFormFieldError(error, 'content')}
          aria-describedby={formFieldDescriptionId(idPrefix, 'content', error)}
          onChange={(e) => {
            onClearError()
            setForm({ ...form, content: e.target.value })
          }}
          placeholder="Memory content (for example, a fact or decision)..."
          rows={4}
        />
        <p id={`${idPrefix}-content-help`} className="mt-1 text-xs text-muted-foreground">
          Keep it concise so it is easy to find later.
        </p>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-importance`} className="text-sm font-medium">
          Importance
        </label>
        <Select
          value={(form.importance * 100).toString()}
          onValueChange={(value) => {
            onClearError()
            setForm({ ...form, importance: parseInt(value) / 100 })
          }}
        >
          <SelectTrigger
            id={`${idPrefix}-importance`}
            aria-invalid={hasFormFieldError(error, 'importance')}
            aria-describedby={formFieldDescriptionId(idPrefix, 'importance', error)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10% - Low</SelectItem>
            <SelectItem value="25">25% - Low-Medium</SelectItem>
            <SelectItem value="50">50% - Medium</SelectItem>
            <SelectItem value="75">75% - High</SelectItem>
            <SelectItem value="90">90% - Very High</SelectItem>
            <SelectItem value="100">100% - Critical</SelectItem>
          </SelectContent>
        </Select>
        <p id={`${idPrefix}-importance-help`} className="mt-1 text-xs text-muted-foreground">
          Higher values make this memory appear first in Browse.
        </p>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-tags`} className="text-sm font-medium">
          Tags
        </label>
        <div className="flex gap-2 mt-1">
          <Input
            id={`${idPrefix}-tags`}
            value={tagInput}
            aria-describedby={`${idPrefix}-tags-help`}
            onChange={(e) => {
              onClearError()
              setTagInput(e.target.value)
            }}
            placeholder="Add tag..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onAddTag()
              }
            }}
          />
          <Button type="button" onClick={onAddTag} size="sm" aria-label="Add memory tag" disabled={!tagInput.trim()}>
            Add
          </Button>
        </div>
        <p id={`${idPrefix}-tags-help`} className="mt-1 text-xs text-muted-foreground">
          Optional. Press Enter or Add to attach a short label.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {form.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag: ${tag}`}
                onClick={() => {
                  onRemoveTag(tag)
                }}
                className="hover:text-destructive"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      </div>
      {renderMemoryFormError(idPrefix, error)}
      <Button type="submit" className="w-full">
        {submitLabel}
      </Button>
    </form>
  )
}
