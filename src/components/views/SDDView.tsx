import { useState, useEffect } from 'react'
import { FileText, Plus, Search, CheckCircle, AlertCircle, Clock, Target, ListTodo, Settings, Play, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Spec {
  id: string
  title: string
  description: string
  user_stories: string[]
  acceptance_criteria: string[]
  status: 'draft' | 'active' | 'completed'
  created_at: string
}

interface ImplementationPlan {
  id: string
  spec_id: string
  technical_approach: string
  status: 'draft' | 'in_progress' | 'completed'
  created_at: string
}

interface Task {
  id: string
  plan_id: string
  title: string
  description: string
  dependencies: string[]
  status: 'pending' | 'in_progress' | 'completed'
  parallel: boolean
}

interface Constitution {
  governance_rules: string[]
  tech_stack: Record<string, string>
  quality_gates: string[]
}

export default function SDDView() {
  const [activeTab, setActiveTab] = useState('constitution')
  const [constitution, setConstitution] = useState<Constitution | null>(null)
  const [specs, setSpecs] = useState<Spec[]>([])
  const [plans, setPlans] = useState<ImplementationPlan[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedSpec, setSelectedSpec] = useState<Spec | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<ImplementationPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [isSpecDialogOpen, setIsSpecDialogOpen] = useState(false)
  const [specForm, setSpecForm] = useState({
    title: '',
    description: '',
    user_stories: [''],
    acceptance_criteria: ['']
  })

  useEffect(() => {
    void fetchConstitution()
    void fetchSpecs()
    void fetchPlans()
  }, [])

  useEffect(() => {
    if (selectedPlan) {
      void fetchTasks(selectedPlan.id)
    }
  }, [selectedPlan])

  const fetchConstitution = async () => {
    try {
      const res = await fetch('/api/enhanced/sdd/constitution')
      const data = await res.json()
      if (data && Object.keys(data).length > 0) {
        setConstitution(data)
      }
    } catch (err) {
      console.error('Failed to fetch constitution:', err)
    }
  }

  const fetchSpecs = async () => {
    try {
      const res = await fetch('/api/enhanced/sdd/specs')
      const data = await res.json()
      setSpecs(data)
    } catch (err) {
      toast.error('Failed to fetch specifications')
    }
  }

  const fetchPlans = async () => {
    try {
      const res = await fetch('/api/enhanced/sdd/plans')
      const data = await res.json()
      setPlans(data)
    } catch (err) {
      toast.error('Failed to fetch plans')
    } finally {
      setLoading(false)
    }
  }

  const fetchTasks = async (planId: string) => {
    try {
      const res = await fetch(`/api/enhanced/sdd/tasks?plan_id=${planId}`)
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (err) {
      toast.error('Failed to fetch tasks')
    }
  }

  const handleCreateSpec = async () => {
    try {
      const res = await fetch('/api/enhanced/sdd/spec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(specForm)
      })
      if (res.ok) {
        toast.success('Specification created successfully')
        setIsSpecDialogOpen(false)
        setSpecForm({ title: '', description: '', user_stories: [''], acceptance_criteria: [''] })
        void fetchSpecs()
      } else {
        toast.error('Failed to create specification')
      }
    } catch (err) {
      toast.error('Failed to create specification')
    }
  }

  const handleSyncToMemory = async () => {
    if (!selectedPlan) return
    try {
      const res = await fetch('/api/enhanced/sdd/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: selectedPlan.id })
      })
      if (res.ok) {
        toast.success('SDD data synced to knowledge graph')
      } else {
        toast.error('Failed to sync to memory')
      }
    } catch (err) {
      toast.error('Failed to sync to memory')
    }
  }

  const addUserStory = () => {
    setSpecForm({ ...specForm, user_stories: [...specForm.user_stories, ''] })
  }

  const updateUserStory = (index: number, value: string) => {
    const updated = [...specForm.user_stories]
    updated[index] = value
    setSpecForm({ ...specForm, user_stories: updated })
  }

  const removeUserStory = (index: number) => {
    setSpecForm({ ...specForm, user_stories: specForm.user_stories.filter((_, i) => i !== index) })
  }

  const addAcceptanceCriteria = () => {
    setSpecForm({ ...specForm, acceptance_criteria: [...specForm.acceptance_criteria, ''] })
  }

  const updateAcceptanceCriteria = (index: number, value: string) => {
    const updated = [...specForm.acceptance_criteria]
    updated[index] = value
    setSpecForm({ ...specForm, acceptance_criteria: updated })
  }

  const removeAcceptanceCriteria = (index: number) => {
    setSpecForm({ ...specForm, acceptance_criteria: specForm.acceptance_criteria.filter((_, i) => i !== index) })
  }

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="size-6" />
            Spec-Driven Development
          </h1>
          <p className="text-muted-foreground text-sm">Manage specifications, plans, and tasks</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void fetchConstitution()}>
            <RefreshCw className="size-4" />
          </Button>
          <Dialog open={isSpecDialogOpen} onOpenChange={setIsSpecDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                New Specification
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Specification</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    value={specForm.title}
                    onChange={(e) => setSpecForm({ ...specForm, title: e.target.value })}
                    placeholder="Feature title"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={specForm.description}
                    onChange={(e) => setSpecForm({ ...specForm, description: e.target.value })}
                    placeholder="Feature description"
                    rows={3}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">User Stories</label>
                    <Button variant="outline" size="sm" onClick={addUserStory}>
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {specForm.user_stories.map((story, index) => (
                      <div key={index} className="flex gap-2">
                        <Textarea
                          value={story}
                          onChange={(e) => updateUserStory(index, e.target.value)}
                          placeholder="As a user, I want..."
                          rows={2}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeUserStory(index)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">Acceptance Criteria</label>
                    <Button variant="outline" size="sm" onClick={addAcceptanceCriteria}>
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {specForm.acceptance_criteria.map((criteria, index) => (
                      <div key={index} className="flex gap-2">
                        <Textarea
                          value={criteria}
                          onChange={(e) => updateAcceptanceCriteria(index, e.target.value)}
                          placeholder="Given... When... Then..."
                          rows={2}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAcceptanceCriteria(index)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <Button onClick={handleCreateSpec} className="w-full">
                  Create Specification
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="constitution">Constitution</TabsTrigger>
          <TabsTrigger value="specs">Specifications</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        {/* Constitution Tab */}
        <TabsContent value="constitution" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Project Constitution</CardTitle>
              <CardDescription>Governance rules and tech stack</CardDescription>
            </CardHeader>
            <CardContent>
              {constitution ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <Settings className="size-4" />
                      Governance Rules
                    </h4>
                    <ul className="space-y-1">
                      {constitution.governance_rules.map((rule, index) => (
                        <li key={index} className="text-sm text-muted-foreground">• {rule}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Tech Stack</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(constitution.tech_stack).map(([key, value]) => (
                        <div key={key} className="text-sm">
                          <span className="font-medium">{key}:</span> {value}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <CheckCircle className="size-4" />
                      Quality Gates
                    </h4>
                    <ul className="space-y-1">
                      {constitution.quality_gates.map((gate, index) => (
                        <li key={index} className="text-sm text-muted-foreground">• {gate}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  No constitution found. Create one to establish project governance.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Specifications Tab */}
        <TabsContent value="specs" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
              <p className="text-center text-muted-foreground col-span-2">Loading specifications...</p>
            ) : specs.length === 0 ? (
              <p className="text-center text-muted-foreground col-span-2">No specifications found</p>
            ) : (
              specs.map((spec) => (
                <Card
                  key={spec.id}
                  className={cn(
                    'cursor-pointer transition-all hover:shadow-md',
                    selectedSpec?.id === spec.id ? 'ring-2 ring-primary' : ''
                  )}
                  onClick={() => setSelectedSpec(spec)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg">{spec.title}</CardTitle>
                        <CardDescription className="text-xs">
                          {new Date(spec.created_at).toLocaleDateString()}
                        </CardDescription>
                      </div>
                      <Badge
                        variant={spec.status === 'completed' ? 'default' : 'outline'}
                      >
                        {spec.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">{spec.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">
                        {spec.user_stories.length} stories
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {spec.acceptance_criteria.length} criteria
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Plans Tab */}
        <TabsContent value="plans" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
              <p className="text-center text-muted-foreground col-span-2">Loading plans...</p>
            ) : plans.length === 0 ? (
              <p className="text-center text-muted-foreground col-span-2">No implementation plans found</p>
            ) : (
              plans.map((plan) => (
                <Card
                  key={plan.id}
                  className={cn(
                    'cursor-pointer transition-all hover:shadow-md',
                    selectedPlan?.id === plan.id ? 'ring-2 ring-primary' : ''
                  )}
                  onClick={() => setSelectedPlan(plan)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base">Plan {plan.id.substring(0, 8)}</CardTitle>
                        <CardDescription className="text-xs">
                          Spec: {plan.spec_id}
                        </CardDescription>
                      </div>
                      <Badge
                        variant={plan.status === 'completed' ? 'default' : 'outline'}
                      >
                        {plan.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">{plan.technical_approach}</p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-4">
          {!selectedPlan ? (
            <div className="text-center text-muted-foreground py-20">
              <ListTodo className="size-16 mx-auto mb-4" />
              <p>Select a plan to view tasks</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Tasks for Plan {selectedPlan.id.substring(0, 8)}</h3>
                  <p className="text-sm text-muted-foreground">{tasks.length} tasks</p>
                </div>
                <Button onClick={handleSyncToMemory}>
                  <Play className="size-4 mr-2" />
                  Sync to Memory
                </Button>
              </div>

              <div className="space-y-2">
                {tasks.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No tasks found for this plan</p>
                ) : (
                  tasks.map((task) => (
                    <Card key={task.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge
                                variant={task.status === 'completed' ? 'default' : 'outline'}
                                className="text-xs"
                              >
                                {task.status}
                              </Badge>
                              {task.parallel && (
                                <Badge variant="secondary" className="text-xs">
                                  [P] Parallel
                                </Badge>
                              )}
                            </div>
                            <h4 className="font-medium">{task.title}</h4>
                            <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                            {task.dependencies.length > 0 && (
                              <div className="flex items-center gap-2 mt-2">
                                <Target className="size-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  Depends on: {task.dependencies.join(', ')}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
