/**
 * @file WorkflowEditorView.tsx
 * @description Node-based visual workflow editor (D9).
 *
 * Compose, edit, save and run agent workflows visually, round-tripping the
 * backend canonical `WorkflowSpec`. Left palette (capabilities-driven), centre
 * React Flow canvas, right inspector, and a top toolbar (New / Load / Save /
 * Run / auto-layout) with live per-node run feedback.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Workflow as WorkflowIcon, Plus, Save, Play, FolderOpen, LayoutGrid, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import {
  fromWorkflowSpec,
  toWorkflowSpec,
  validateCapabilities,
  type SavedWorkflow,
  type WorkflowCapabilities,
  type WorkflowNode,
  type WorkflowNodeConfig,
  type WorkflowNodeData,
  type WorkflowNodeStatus,
} from '@/lib/workflow'
import { workflowNodeTypes } from '@/components/workflow/nodes'
import NodePalette, { PALETTE_DND_MIME, type PaletteDragPayload } from '@/components/workflow/NodePalette'
import Inspector from '@/components/workflow/Inspector'

let nodeSeq = 0
function nextNodeId(kind: string): string {
  nodeSeq += 1
  return `${kind}-${Date.now()}-${nodeSeq}`
}

/** Simple grid auto-layout used by the toolbar button. */
function autoLayout(nodes: WorkflowNode[]): WorkflowNode[] {
  const perRow = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  return nodes.map((n, i) => ({
    ...n,
    position: { x: 80 + (i % perRow) * 240, y: 80 + Math.floor(i / perRow) * 140 },
  }))
}

function WorkflowEditorInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([])
  const initialEdges: Edge[] = []
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('Untitled Workflow')
  const [capabilities, setCapabilities] = useState<WorkflowCapabilities | null>(null)
  const [capsLoading, setCapsLoading] = useState(true)
  const [saved, setSaved] = useState<SavedWorkflow[]>([])
  const [running, setRunning] = useState(false)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const rfInstanceRef = useRef<ReactFlowInstance<WorkflowNode> | null>(null)
  const { screenToFlowPosition } = useReactFlow()

  // Derived spec — recomputed from canvas; the single source of truth on save.
  const spec = useMemo(() => toWorkflowSpec(nodes, edges, name), [nodes, edges, name])
  const warnings = useMemo(() => validateCapabilities(nodes, edges), [nodes, edges])
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId])

  const loadCapabilities = useCallback(async () => {
    setCapsLoading(true)
    try {
      const caps = await api.listWorkflowCapabilities()
      setCapabilities(caps)
    } catch (err) {
      console.error('Failed to load capabilities', err)
      setCapabilities({ agents: [], tools: [], skills: [] })
    } finally {
      setCapsLoading(false)
    }
  }, [])

  const loadWorkflowList = useCallback(async () => {
    try {
      setSaved(await api.listWorkflows())
    } catch (err) {
      // D-W5WR-4: the backend now raises on a real failure (placement
      // denial, timeout, malformed data) instead of degrading to `[]`, so an
      // empty saved-workflow list here is trustworthy -- but this branch only
      // runs on that real failure, and must say so instead of silently
      // rendering the same empty state a genuinely-workflow-free graph would
      // show (same class of fix GraphView.tsx already applies).
      console.error('Failed to list workflows', err)
      toast.error(`Failed to load saved workflows: ${err instanceof Error ? err.message : String(err)}`)
      setSaved([])
    }
  }, [])

  useEffect(() => {
    void loadCapabilities()
    void loadWorkflowList()
  }, [loadCapabilities, loadWorkflowList])

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds))
    },
    [setEdges],
  )

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData(PALETTE_DND_MIME)
      if (!raw) return
      let payload: PaletteDragPayload
      try {
        payload = JSON.parse(raw) as PaletteDragPayload
      } catch {
        return
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const data: WorkflowNodeData = {
        kind: payload.kind,
        refId: payload.refId,
        label: payload.label,
        config: {
          system_prompt: payload.system_prompt,
          tools: payload.tools,
        },
      }
      const newNode: WorkflowNode = {
        id: nextNodeId(payload.kind),
        type: payload.kind,
        position,
        data,
      }
      setNodes((nds) => [...nds, newNode])
    },
    [screenToFlowPosition, setNodes],
  )

  const handlePatch = useCallback(
    (id: string, patch: { label?: string; config?: Partial<WorkflowNodeConfig> }) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  label: patch.label ?? n.data.label,
                  config: { ...n.data.config, ...patch.config },
                },
              }
            : n,
        ),
      )
    },
    [setNodes],
  )

  const handleDelete = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id))
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
      setSelectedId((cur) => (cur === id ? null : cur))
    },
    [setNodes, setEdges],
  )

  const setNodeStatuses = useCallback(
    (statusFor: (node: WorkflowNode) => WorkflowNodeStatus) => {
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: statusFor(n) } })))
    },
    [setNodes],
  )

  const handleNew = useCallback(() => {
    setNodes([])
    setEdges([])
    setName('Untitled Workflow')
    setSelectedId(null)
  }, [setNodes, setEdges])

  const handleAutoLayout = useCallback(() => {
    setNodes((nds) => autoLayout(nds))
  }, [setNodes])

  const handleLoad = useCallback(
    (wf: SavedWorkflow) => {
      const canvas = fromWorkflowSpec({ name: wf.name, steps: wf.steps, orchestrates: wf.orchestrates }, wf.canvas)
      setNodes(canvas.nodes)
      setEdges(canvas.edges)
      setName(wf.name)
      setSelectedId(null)
      toast.success(`Loaded "${wf.name}"`)
    },
    [setNodes, setEdges],
  )

  const handleSave = useCallback(async () => {
    try {
      const persistedSpec = toWorkflowSpec(nodes, edges, name)
      const res = await api.saveWorkflow({
        name: persistedSpec.name,
        steps: persistedSpec.steps,
        orchestrates: persistedSpec.orchestrates,
        canvas: {
          nodes: nodes.map((n) => ({ ...n, data: { ...n.data, status: undefined } })),
          edges,
        },
      })
      toast.success(`Saved workflow (${res.id})`)
      await loadWorkflowList()
    } catch (err) {
      console.error('Save failed', err)
      toast.error('Failed to save workflow')
    }
  }, [nodes, edges, name, loadWorkflowList])

  const handleRun = useCallback(async () => {
    if (nodes.length === 0) {
      toast.error('Add nodes before running')
      return
    }
    setRunning(true)
    setNodeStatuses(() => 'running')
    try {
      // Persist first so the backend has a workflow id to dispatch.
      const persistedSpec = toWorkflowSpec(nodes, edges, name)
      const saveRes = await api.saveWorkflow({
        name: persistedSpec.name,
        steps: persistedSpec.steps,
        orchestrates: persistedSpec.orchestrates,
        canvas: {
          nodes: nodes.map((n) => ({ ...n, data: { ...n.data, status: undefined } })),
          edges,
        },
      })
      const result = await api.runWorkflow(saveRes.id)
      const ok = result.status !== 'error'
      const perNode = result.node_status
      setNodeStatuses((n) => perNode?.[n.id] ?? (ok ? 'done' : 'error'))
      if (ok) {
        toast.success(`Run ${result.run_id ?? ''} ${result.status}`)
      } else {
        toast.error(`Run failed: ${result.error ?? 'unknown error'}`)
      }
    } catch (err) {
      console.error('Run failed', err)
      setNodeStatuses(() => 'error')
      toast.error('Failed to run workflow')
    } finally {
      setRunning(false)
    }
  }, [nodes, edges, name, setNodeStatuses])

  return (
    <div className="flex h-[calc(100vh-1rem)] flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <WorkflowIcon className="size-5 text-emerald-400" />
          <Input
            aria-label="workflow name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
            }}
            className="h-8 w-48 text-sm font-semibold"
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={handleNew}>
            <Plus className="mr-1 size-4" /> New
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <FolderOpen className="mr-1 size-4" /> Load
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
              <DropdownMenuLabel>Saved Workflows</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {saved.length === 0 ? (
                <DropdownMenuItem disabled>No saved workflows</DropdownMenuItem>
              ) : (
                saved.map((wf) => (
                  <DropdownMenuItem
                    key={wf.id}
                    onSelect={() => {
                      handleLoad(wf)
                    }}
                  >
                    {wf.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={handleAutoLayout}>
            <LayoutGrid className="mr-1 size-4" /> Layout
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              handleSave().catch(() => undefined)
            }}
          >
            <Save className="mr-1 size-4" /> Save
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={running}
            onClick={() => {
              handleRun().catch(() => undefined)
            }}
          >
            <Play className="mr-1 size-4" /> {running ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {/* Capability warnings */}
      {warnings.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <ul className="space-y-0.5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Body: palette / canvas / inspector */}
      <div className="flex min-h-0 flex-1">
        <NodePalette capabilities={capabilities} loading={capsLoading} />
        <div ref={wrapperRef} className="relative min-w-0 flex-1" data-testid="workflow-canvas">
          <ReactFlow<WorkflowNode>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => {
              rfInstanceRef.current = inst
            }}
            nodeTypes={workflowNodeTypes}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={(_, node) => {
              setSelectedId(node.id)
            }}
            onPaneClick={() => {
              setSelectedId(null)
            }}
            onSelectionChange={({ nodes: sel }: { nodes: Node[] }) => {
              setSelectedId(sel[0]?.id ?? null)
            }}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <Inspector node={selectedNode} onPatch={handlePatch} onDelete={handleDelete} />
      </div>

      {/* Spec preview (derived) */}
      <div
        className="shrink-0 truncate border-t border-border/40 bg-muted/10 px-3 py-1 text-[10px] text-muted-foreground"
        data-testid="derived-spec"
      >
        steps: [{spec.steps.join(', ')}] · orchestrates: [{spec.orchestrates.join(', ')}]
      </div>
    </div>
  )
}

/**
 * Public entry point — wraps the editor in a `ReactFlowProvider`.
 */
export default function WorkflowEditorView() {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  )
}
