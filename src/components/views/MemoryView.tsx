import { useState, useEffect } from 'react'
import { z } from 'zod'
import { Brain, Plus, Search, Link2, Trash2, Edit2, Calendar, Tag, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { fetchValidated, ApiError, looseArray } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'

const memoryNodeSchema = z.object({
  id: z.string(),
  content: z.string(),
  importance: z.number(),
  tags: looseArray(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
  linked_nodes: looseArray(z.string()).optional(),
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

export default function MemoryView() {
  const [memories, setMemories] = useState<MemoryNode[]>([])
  const [selectedMemory, setSelectedMemory] = useState<MemoryNode | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('browse')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [memoryForm, setMemoryForm] = useState({
    id: '',
    content: '',
    importance: 0.5,
    tags: [] as string[],
  })
  const [tagInput, setTagInput] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    void fetchMemories()
  }, [])

  const fetchMemories = async () => {
    try {
      setLoading(true)
      const data = await fetchValidated('/api/enhanced/graph/nodes?node_type=Memory', looseArray(memoryNodeSchema))
      setSessionExpired(false)
      setMemories(data)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else {
        toast.error('Failed to load memories')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCreateMemory = async () => {
    try {
      const res = await fetch('/api/enhanced/graph/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...memoryForm,
          id: memoryForm.id || `mem_${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      })
      if (res.ok) {
        toast.success('Memory created successfully')
        setIsCreateDialogOpen(false)
        setMemoryForm({ id: '', content: '', importance: 0.5, tags: [] })
        void fetchMemories()
      } else {
        toast.error('Failed to create memory')
      }
    } catch {
      toast.error('Failed to create memory')
    }
  }

  const handleUpdateMemory = async () => {
    if (!selectedMemory) return

    try {
      const res = await fetch(`/api/enhanced/graph/memory/${selectedMemory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...memoryForm,
          updated_at: new Date().toISOString(),
        }),
      })
      if (res.ok) {
        toast.success('Memory updated successfully')
        setIsEditDialogOpen(false)
        setSelectedMemory(null)
        setMemoryForm({ id: '', content: '', importance: 0.5, tags: [] })
        void fetchMemories()
      } else {
        toast.error('Failed to update memory')
      }
    } catch {
      toast.error('Failed to update memory')
    }
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      const res = await fetch(`/api/enhanced/graph/memory/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Memory deleted successfully')
        void fetchMemories()
        if (selectedMemory?.id === id) {
          setSelectedMemory(null)
        }
      } else {
        toast.error('Failed to delete memory')
      }
    } catch {
      toast.error('Failed to delete memory')
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
    setSelectedMemory(memory)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="size-6" />
            Memory Management
          </h1>
          <p className="text-muted-foreground text-sm">Manage knowledge graph memory nodes</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void fetchMemories()
            }}
          >
            Refresh
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                Add Memory
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Memory</DialogTitle>
              </DialogHeader>
              <MemoryForm
                form={memoryForm}
                setForm={setMemoryForm}
                tagInput={tagInput}
                setTagInput={setTagInput}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                onSubmit={() => {
                  void handleCreateMemory()
                }}
                submitLabel="Create Memory"
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
        </TabsList>

        {/* Browse Tab */}
        <TabsContent value="browse" className="space-y-4">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search memories..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              <p className="text-center text-muted-foreground col-span-3">Loading memories...</p>
            ) : sortedMemories.length === 0 ? (
              <p className="text-center text-muted-foreground col-span-3">No memories found</p>
            ) : (
              sortedMemories.map((memory) => (
                <Card
                  key={memory.id}
                  className={cn(
                    'cursor-pointer transition-all hover:shadow-md',
                    selectedMemory?.id === memory.id ? 'ring-2 ring-primary' : '',
                  )}
                  onClick={() => {
                    setSelectedMemory(memory)
                  }}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base line-clamp-2">{memory.content.substring(0, 100)}...</CardTitle>
                        <CardDescription className="text-xs">
                          {new Date(memory.created_at).toLocaleString()}
                        </CardDescription>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditDialog(memory)
                          }}
                        >
                          <Edit2 className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleDeleteMemory(memory.id)
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="size-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Importance:</span>
                        <div className="flex-1">
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${memory.importance * 100}%` }} />
                          </div>
                        </div>
                        <span className="text-xs font-medium">{(memory.importance * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(memory.tags ?? []).slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            <Tag className="size-2 mr-1" />
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
              ))
            )}
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="space-y-4">
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
            <div className="space-y-6 pl-10">
              {sortedMemories.map((memory) => (
                <div key={memory.id} className="relative">
                  <div className="absolute left-[-26px] w-4 h-4 rounded-full bg-primary border-2 border-background" />
                  <Card
                    className="cursor-pointer hover:shadow-md transition-all"
                    onClick={() => {
                      setSelectedMemory(memory)
                    }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Calendar className="size-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              {new Date(memory.created_at).toLocaleString()}
                            </span>
                          </div>
                          <CardTitle className="text-base line-clamp-2">
                            {memory.content.substring(0, 100)}...
                          </CardTitle>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {(memory.importance * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    </CardHeader>
                  </Card>
                </div>
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
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search memories..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                    }}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery('')
                    }}
                  >
                    Clear
                  </Button>
                  <Button
                    onClick={() => {
                      /* Advanced search logic */
                    }}
                  >
                    Advanced Search
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">Found {sortedMemories.length} memories</div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {sortedMemories.map((memory) => (
              <Card
                key={memory.id}
                className="cursor-pointer hover:shadow-md transition-all"
                onClick={() => {
                  setSelectedMemory(memory)
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm line-clamp-2">{memory.content}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">
                          {(memory.importance * 100).toFixed(0)}%
                        </Badge>
                        {(memory.tags ?? []).slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm">
                      <Link2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
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
            </DialogHeader>
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Content</label>
                  <p className="text-sm mt-1">{selectedMemory.content}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Importance</label>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${selectedMemory.importance * 100}%` }} />
                      </div>
                      <span className="text-sm">{(selectedMemory.importance * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Created</label>
                    <p className="text-sm mt-1">{new Date(selectedMemory.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Tags</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(selectedMemory.tags ?? []).map((tag) => (
                      <Badge key={tag} variant="secondary">
                        <Tag className="size-2 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={() => {
                      setSelectedMemory(null)
                      openEditDialog(selectedMemory)
                    }}
                  >
                    <Edit2 className="size-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      void handleDeleteMemory(selectedMemory.id)
                      setSelectedMemory(null)
                    }}
                  >
                    <Trash2 className="size-4 mr-2" />
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
          </DialogHeader>
          <MemoryForm
            form={memoryForm}
            setForm={setMemoryForm}
            tagInput={tagInput}
            setTagInput={setTagInput}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onSubmit={() => {
              void handleUpdateMemory()
            }}
            submitLabel="Update Memory"
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MemoryForm({
  form,
  setForm,
  tagInput,
  setTagInput,
  onAddTag,
  onRemoveTag,
  onSubmit,
  submitLabel,
}: {
  form: { id: string; content: string; importance: number; tags: string[] }
  setForm: (form: { id: string; content: string; importance: number; tags: string[] }) => void
  tagInput: string
  setTagInput: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
  onSubmit: () => void
  submitLabel: string
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Content</label>
        <Textarea
          value={form.content}
          onChange={(e) => {
            setForm({ ...form, content: e.target.value })
          }}
          placeholder="Memory content..."
          rows={4}
        />
      </div>
      <div>
        <label className="text-sm font-medium">Importance</label>
        <Select
          value={(form.importance * 100).toString()}
          onValueChange={(value) => {
            setForm({ ...form, importance: parseInt(value) / 100 })
          }}
        >
          <SelectTrigger>
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
      </div>
      <div>
        <label className="text-sm font-medium">Tags</label>
        <div className="flex gap-2 mt-1">
          <Input
            value={tagInput}
            onChange={(e) => {
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
          <Button type="button" onClick={onAddTag} size="sm">
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {form.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
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
      <Button onClick={onSubmit} className="w-full">
        {submitLabel}
      </Button>
    </div>
  )
}
