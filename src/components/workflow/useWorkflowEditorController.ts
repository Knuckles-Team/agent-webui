import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/api-validation'
import {
  toWorkflowSpec,
  validateCapabilities,
  type SavedWorkflow,
  type WorkflowCapabilities,
  type WorkflowCanvas,
  type WorkflowNode,
  type WorkflowNodeConfig,
} from '@/lib/workflow'
import { workflowCanvas } from './workflow-editor-state'
import type { PaletteDragPayload } from './NodePalette'

type Resource<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string }
function failure(error: unknown, resource: string): string {
  if (error instanceof ApiError && [401, 403].includes(error.status)) return `${resource} access was refused.`
  if (error instanceof ApiError && [404, 501].includes(error.status))
    return `${resource} are unavailable on this backend.`
  return `${resource} could not be loaded. Retry to check availability.`
}

function useWorkflowCatalog() {
  const [saved, setSaved] = useState<Resource<SavedWorkflow[]>>({ state: 'loading' })
  const [capabilities, setCapabilities] = useState<Resource<WorkflowCapabilities>>({ state: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setSaved({ state: 'loading' })
    setCapabilities({ state: 'loading' })
    void api.listWorkflows().then(
      (data) => {
        if (active) setSaved({ state: 'ready', data })
      },
      (error: unknown) => {
        if (!active) return
        const message = failure(error, 'Saved workflows')
        setSaved({ state: 'error', message })
        toast.error(`Failed to load saved workflows: ${message}`)
      },
    )
    void api.listWorkflowCapabilities().then(
      (data) => {
        if (active) setCapabilities({ state: 'ready', data })
      },
      (error: unknown) => {
        if (active) setCapabilities({ state: 'error', message: failure(error, 'Workflow capabilities') })
      },
    )
    return () => {
      active = false
    }
  }, [revision])
  const refresh = useCallback(() => {
    setRevision((current) => current + 1)
  }, [])
  return { saved, capabilities, refresh }
}

interface Draft extends WorkflowCanvas {
  id: string | null
  name: string
  dirty: boolean
}
const emptyDraft = (): Draft => ({ id: null, name: 'Untitled Workflow', nodes: [], edges: [], dirty: false })
export function useWorkflowEditorController(workflowId: string | null) {
  const catalog = useWorkflowCatalog()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loaded = useRef<string | null>(null)
  const live = useRef(false)
  useLayoutEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useLayoutEffect(() => {
    if (loaded.current === workflowId) return
    setLoadError(null)
    setSelectedId(null)
    if (workflowId === null) {
      loaded.current = null
      setDraft(emptyDraft())
      return
    }
    if (catalog.saved.state !== 'ready') return
    const workflow = catalog.saved.data.find((entry) => entry.id === workflowId)
    if (!workflow) {
      setLoadError('This workflow is not in the loaded catalog. No workflow was selected in its place.')
      return
    }
    try {
      const canvas = workflowCanvas(workflow)
      loaded.current = workflowId
      setDraft({ ...canvas, id: workflowId, name: workflow.name, dirty: false })
    } catch {
      setLoadError('This workflow has an invalid canvas. It was not loaded.')
    }
  }, [workflowId, catalog.saved])
  const ready = draft.id === workflowId
  function edit(update: (current: Draft) => Draft, markDirty = true) {
    if (!live.current || !ready) return
    setDraft((current) => ({ ...update(current), dirty: current.dirty || markDirty }))
  }
  function add(payload: PaletteDragPayload, position?: { x: number; y: number }) {
    const id = `${payload.kind}-${crypto.randomUUID()}`
    edit((current) => ({
      ...current,
      nodes: [
        ...current.nodes,
        {
          id,
          type: payload.kind,
          position: position ?? {
            x: 80 + (current.nodes.length % 3) * 240,
            y: 80 + Math.floor(current.nodes.length / 3) * 140,
          },
          data: {
            kind: payload.kind,
            refId: payload.refId,
            label: payload.label,
            config: { system_prompt: payload.system_prompt, tools: payload.tools },
          },
        },
      ],
    }))
    setSelectedId(id)
  }
  function patch(id: string, value: { label?: string; config?: Partial<WorkflowNodeConfig> }) {
    edit((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                label: value.label ?? node.data.label,
                config: { ...node.data.config, ...value.config },
              },
            }
          : node,
      ),
    }))
  }
  function remove(id: string) {
    edit((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id),
    }))
    setSelectedId((current) => (current === id ? null : current))
  }
  function connect(connection: Connection) {
    if (
      !draft.nodes.some((node) => node.id === connection.source) ||
      !draft.nodes.some((node) => node.id === connection.target)
    )
      return
    edit((current) => ({ ...current, edges: addEdge(connection, current.edges) }))
  }
  const warnings = useMemo(() => validateCapabilities(draft.nodes, draft.edges), [draft.nodes, draft.edges])
  const spec = useMemo(
    () => toWorkflowSpec(draft.nodes, draft.edges, draft.name),
    [draft.nodes, draft.edges, draft.name],
  )
  return {
    ...catalog,
    draft,
    ready,
    loadError,
    selectedId,
    setSelectedId,
    warnings,
    spec,
    add,
    patch,
    remove,
    connect,
    reset: () => {
      if (!live.current) return
      loaded.current = null
      setDraft(emptyDraft())
      setSelectedId(null)
      setLoadError(null)
    },
    selectedNode: draft.nodes.find((node) => node.id === selectedId) ?? null,
    setName: (name: string) => {
      edit((current) => ({ ...current, name }))
    },
    changeNodes: (changes: NodeChange<WorkflowNode>[]) => {
      edit(
        (current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }),
        changes.some((change) => change.type !== 'select' && change.type !== 'dimensions'),
      )
    },
    changeEdges: (changes: EdgeChange[]) => {
      edit((current) => ({ ...current, edges: applyEdgeChanges(changes, current.edges) }))
    },
    layout: () => {
      edit((current) => ({
        ...current,
        nodes: current.nodes.map((node, index) => ({
          ...node,
          position: { x: 80 + (index % 3) * 240, y: 80 + Math.floor(index / 3) * 140 },
        })),
      }))
    },
  }
}
export type WorkflowEditorController = ReturnType<typeof useWorkflowEditorController>
