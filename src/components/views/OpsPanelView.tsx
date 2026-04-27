/**
 * @file OpsPanelView.tsx
 * @description Unified operations panel for pipeline, maintenance, and resources.
 *
 * Renders three tabs backed by the /api/enhanced/pipeline/*,
 * /api/enhanced/maintenance/*, and /api/enhanced/resources/* endpoints. Each
 * tab provides status tables plus trigger buttons that surface server errors
 * via toast notifications.
 */

import { useEffect, useState } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  Server,
  Sparkles,
  Wrench,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

interface PipelinePhase {
  name?: string
  phase?: string
  state?: string
  status?: string
  last_run?: string
  progress?: number
}

interface PipelineStatus {
  status?: string
  phases?: PipelinePhase[] | Record<string, Partial<PipelinePhase>>
}

interface MaintenanceOp {
  name?: string
  operation?: string
  last_run?: string
  items_pruned?: number
  items_updated?: number
  status?: string
}

interface MaintenanceStatus {
  status?: string
  operations?: MaintenanceOp[] | Record<string, Partial<MaintenanceOp>>
}

interface CallableResource {
  id?: string
  name?: string
  type?: string
  resource_type?: string
  description?: string
}

const MAINTENANCE_OPERATIONS = ['prune', 'reindex', 'consolidate'] as const

function normalizePhases(
  phases: PipelineStatus['phases'],
): PipelinePhase[] {
  if (!phases) return []
  if (Array.isArray(phases)) return phases
  return Object.entries(phases).map(([name, info]) => ({
    name,
    ...(info ?? {}),
  }))
}

function normalizeOperations(
  operations: MaintenanceStatus['operations'],
): MaintenanceOp[] {
  if (!operations) return []
  if (Array.isArray(operations)) return operations
  return Object.entries(operations).map(([name, info]) => ({
    name,
    ...(info ?? {}),
  }))
}

function formatProgress(progress: number | undefined): string {
  if (progress === undefined || progress === null) return '-'
  if (progress <= 1) return `${(progress * 100).toFixed(0)}%`
  return String(progress)
}

function StateBadge({ state }: { state?: string }) {
  if (!state) return <Badge variant="outline">unknown</Badge>
  const lower = state.toLowerCase()
  if (['done', 'success', 'ok', 'healthy', 'idle'].includes(lower)) {
    return (
      <Badge variant="default" className="gap-1">
        <CheckCircle2 className="size-3" />
        {state}
      </Badge>
    )
  }
  if (['error', 'failure', 'failed', 'degraded'].includes(lower)) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="size-3" />
        {state}
      </Badge>
    )
  }
  return <Badge variant="secondary">{state}</Badge>
}

export default function OpsPanelView() {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'maintenance' | 'resources'>(
    'pipeline',
  )
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>({})
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus>({})
  const [resources, setResources] = useState<CallableResource[]>([])
  const [loadingPipeline, setLoadingPipeline] = useState(true)
  const [loadingMaintenance, setLoadingMaintenance] = useState(true)
  const [loadingResources, setLoadingResources] = useState(true)
  const [pendingTrigger, setPendingTrigger] = useState<string | null>(null)
  const [isSpawnOpen, setIsSpawnOpen] = useState(false)
  const [spawnForm, setSpawnForm] = useState({
    name: '',
    agent_type: 'specialist',
    task: '',
  })
  const [spawnSubmitting, setSpawnSubmitting] = useState(false)

  useEffect(() => {
    void fetchPipeline()
    void fetchMaintenance()
    void fetchResources()
  }, [])

  const fetchPipeline = async () => {
    setLoadingPipeline(true)
    try {
      const res = await fetch('/api/enhanced/pipeline/status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as PipelineStatus
      setPipelineStatus(data)
    } catch (err) {
      toast.error(`Failed to load pipeline status: ${String(err)}`)
    } finally {
      setLoadingPipeline(false)
    }
  }

  const fetchMaintenance = async () => {
    setLoadingMaintenance(true)
    try {
      const res = await fetch('/api/enhanced/maintenance/status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as MaintenanceStatus
      setMaintenanceStatus(data)
    } catch (err) {
      toast.error(`Failed to load maintenance status: ${String(err)}`)
    } finally {
      setLoadingMaintenance(false)
    }
  }

  const fetchResources = async () => {
    setLoadingResources(true)
    try {
      const res = await fetch('/api/enhanced/resources')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as CallableResource[]
      setResources(Array.isArray(data) ? data : [])
    } catch (err) {
      toast.error(`Failed to load resources: ${String(err)}`)
    } finally {
      setLoadingResources(false)
    }
  }

  const triggerPipelinePhase = async (phase?: string) => {
    const label = phase || 'full pipeline'
    setPendingTrigger(`pipeline:${phase ?? '__all__'}`)
    try {
      const res = await fetch('/api/enhanced/pipeline/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(phase ? { phase } : {}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(`Triggered pipeline: ${label}`)
      void fetchPipeline()
    } catch (err) {
      toast.error(`Failed to trigger pipeline: ${String(err)}`)
    } finally {
      setPendingTrigger(null)
    }
  }

  const triggerMaintenance = async (operation?: string) => {
    const label = operation || 'full maintenance'
    setPendingTrigger(`maintenance:${operation ?? '__all__'}`)
    try {
      const res = await fetch('/api/enhanced/maintenance/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation ? { operation } : {}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(`Triggered maintenance: ${label}`)
      void fetchMaintenance()
    } catch (err) {
      toast.error(`Failed to trigger maintenance: ${String(err)}`)
    } finally {
      setPendingTrigger(null)
    }
  }

  const spawnAgent = async () => {
    setSpawnSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        agent_type: spawnForm.agent_type,
        task: spawnForm.task,
      }
      if (spawnForm.name.trim()) {
        payload.name = spawnForm.name.trim()
      }
      const res = await fetch('/api/enhanced/resources/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const spawned = (await res.json()) as CallableResource
      const label = spawned.name || spawned.id || 'new agent'
      toast.success(`Spawned: ${label}`)
      setIsSpawnOpen(false)
      setSpawnForm({ name: '', agent_type: 'specialist', task: '' })
      void fetchResources()
    } catch (err) {
      toast.error(`Failed to spawn: ${String(err)}`)
    } finally {
      setSpawnSubmitting(false)
    }
  }

  const phases = normalizePhases(pipelineStatus.phases)
  const operations = normalizeOperations(maintenanceStatus.operations)

  return (
    <div className="space-y-6" data-testid="ops-panel">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wrench className="size-6" />
            Operations
          </h1>
          <p className="text-muted-foreground text-sm">
            Pipeline, maintenance, and callable resources
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pipeline" className="gap-2">
            <Activity className="size-4" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="size-4" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="resources" className="gap-2">
            <Sparkles className="size-4" />
            Resources
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Pipeline Phases</CardTitle>
                <CardDescription>
                  Status:{' '}
                  <StateBadge state={pipelineStatus.status} />
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchPipeline()}
                  disabled={loadingPipeline}
                >
                  <RefreshCw className={loadingPipeline ? 'size-4 animate-spin' : 'size-4'} />
                  <span className="ml-2">Refresh</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => void triggerPipelinePhase()}
                  disabled={pendingTrigger !== null}
                >
                  <Play className="size-4 mr-2" />
                  Run All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingPipeline ? (
                <p className="text-muted-foreground text-sm">Loading pipeline status...</p>
              ) : phases.length === 0 ? (
                <p className="text-muted-foreground text-sm">No phases reported.</p>
              ) : (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Phase</th>
                        <th className="text-left p-2 font-medium">State</th>
                        <th className="text-left p-2 font-medium">Last Run</th>
                        <th className="text-left p-2 font-medium">Progress</th>
                        <th className="text-left p-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phases.map((phase, idx) => {
                        const phaseName = phase.name || phase.phase || `phase-${idx}`
                        const phaseKey = `pipeline:${phaseName}`
                        return (
                          <tr key={phaseKey} className="border-t">
                            <td className="p-2 font-medium">{phaseName}</td>
                            <td className="p-2">
                              <StateBadge state={phase.state || phase.status} />
                            </td>
                            <td className="p-2 text-muted-foreground">
                              {phase.last_run ? (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="size-3" />
                                  {phase.last_run}
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="p-2">{formatProgress(phase.progress)}</td>
                            <td className="p-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void triggerPipelinePhase(phaseName)}
                                disabled={pendingTrigger === phaseKey}
                              >
                                <Play className="size-3 mr-1" />
                                Trigger
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maintenance" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Maintenance Operations</CardTitle>
                <CardDescription>
                  Status: <StateBadge state={maintenanceStatus.status} />
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchMaintenance()}
                disabled={loadingMaintenance}
              >
                <RefreshCw className={loadingMaintenance ? 'size-4 animate-spin' : 'size-4'} />
                <span className="ml-2">Refresh</span>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {MAINTENANCE_OPERATIONS.map((op) => {
                  const key = `maintenance:${op}`
                  return (
                    <Button
                      key={op}
                      variant="outline"
                      size="sm"
                      onClick={() => void triggerMaintenance(op)}
                      disabled={pendingTrigger === key}
                    >
                      <Play className="size-3 mr-1" />
                      {op}
                    </Button>
                  )
                })}
              </div>
              {loadingMaintenance ? (
                <p className="text-muted-foreground text-sm">Loading maintenance status...</p>
              ) : operations.length === 0 ? (
                <p className="text-muted-foreground text-sm">No operations reported.</p>
              ) : (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Operation</th>
                        <th className="text-left p-2 font-medium">Last Run</th>
                        <th className="text-left p-2 font-medium">Pruned</th>
                        <th className="text-left p-2 font-medium">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operations.map((op, idx) => {
                        const opName = op.name || op.operation || `op-${idx}`
                        return (
                          <tr key={`row-${opName}`} className="border-t">
                            <td className="p-2 font-medium">{opName}</td>
                            <td className="p-2 text-muted-foreground">
                              {op.last_run || '-'}
                            </td>
                            <td className="p-2">{op.items_pruned ?? '-'}</td>
                            <td className="p-2">{op.items_updated ?? '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resources" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Callable Resources</CardTitle>
                <CardDescription>
                  MCP tools, A2A agents, skills, and spawned specialists
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchResources()}
                  disabled={loadingResources}
                >
                  <RefreshCw className={loadingResources ? 'size-4 animate-spin' : 'size-4'} />
                  <span className="ml-2">Refresh</span>
                </Button>
                <Button size="sm" onClick={() => setIsSpawnOpen(true)}>
                  <Sparkles className="size-4 mr-2" />
                  Spawn
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingResources ? (
                <p className="text-muted-foreground text-sm">Loading resources...</p>
              ) : resources.length === 0 ? (
                <p className="text-muted-foreground text-sm">No resources available.</p>
              ) : (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-left p-2 font-medium">Name</th>
                        <th className="text-left p-2 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resources.map((resource, idx) => {
                        const resourceKey = resource.id || resource.name || `resource-${idx}`
                        return (
                          <tr key={resourceKey} className="border-t">
                            <td className="p-2">
                              <Badge variant="secondary" className="gap-1">
                                <Server className="size-3" />
                                {resource.type || resource.resource_type || 'unknown'}
                              </Badge>
                            </td>
                            <td className="p-2 font-medium">
                              {resource.name || resource.id || '-'}
                            </td>
                            <td className="p-2 text-muted-foreground">
                              {resource.description || '-'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog open={isSpawnOpen} onOpenChange={setIsSpawnOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Spawn Specialized Agent</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Name (optional)</label>
                  <Input
                    value={spawnForm.name}
                    onChange={(e) =>
                      setSpawnForm({ ...spawnForm, name: e.target.value })
                    }
                    placeholder="research-specialist"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Agent Type</label>
                  <Input
                    value={spawnForm.agent_type}
                    onChange={(e) =>
                      setSpawnForm({ ...spawnForm, agent_type: e.target.value })
                    }
                    placeholder="specialist"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Task</label>
                  <Textarea
                    value={spawnForm.task}
                    onChange={(e) =>
                      setSpawnForm({ ...spawnForm, task: e.target.value })
                    }
                    placeholder="Describe the task this agent should handle"
                    rows={4}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsSpawnOpen(false)}
                    disabled={spawnSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void spawnAgent()}
                    disabled={spawnSubmitting || !spawnForm.task.trim()}
                  >
                    <Sparkles className="size-4 mr-2" />
                    Spawn
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  )
}
