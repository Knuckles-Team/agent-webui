import { useCallback, useState, type DragEvent } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WorkflowNode } from '@/lib/workflow'
import { workflowNodeTypes } from './nodes'
import NodePalette, { PALETTE_DND_MIME } from './NodePalette'
import Inspector from './Inspector'
import { useWorkflowEditorController, type WorkflowEditorController } from './useWorkflowEditorController'
import { palettePayloadSchema, WORKFLOW_EFFECTS_UNAVAILABLE } from './workflow-editor-state'
import './WorkflowEditor.css'

interface Props {
  workflowId: string | null
  onSelectWorkflow: (id: string | null) => void
}
/** Contextual authoring surface, without a page header, viewport height or navigation shell. */
export function WorkflowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  )
}
function WorkflowEditorInner({ workflowId, onSelectWorkflow }: Props) {
  const editor = useWorkflowEditorController(workflowId)
  return (
    <section aria-label="Workflow plan editor" className="workflow-editor space-y-3">
      <p className="text-sm text-muted-foreground">{WORKFLOW_EFFECTS_UNAVAILABLE}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          Saved workflow
          <select
            className="min-h-11 w-full rounded border bg-background px-2"
            value={workflowId ?? ''}
            onChange={(event) => {
              onSelectWorkflow(event.target.value || null)
            }}
          >
            <option value="">New in-memory plan</option>
            {workflowId &&
              (editor.saved.state !== 'ready' || !editor.saved.data.some((entry) => entry.id === workflowId)) && (
                <option value={workflowId}>Linked workflow</option>
              )}
            {editor.saved.state === 'ready' &&
              editor.saved.data.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
          </select>
        </label>
        <Button
          variant="outline"
          onClick={() => {
            editor.reset()
            onSelectWorkflow(null)
          }}
        >
          New plan
        </Button>
        <Button className="min-h-11" variant="outline" onClick={editor.refresh}>
          Refresh workflow catalog
        </Button>
        <Button className="min-h-11" disabled aria-describedby="workflow-effect-availability">
          Save
        </Button>
        <Button className="min-h-11" disabled aria-describedby="workflow-effect-availability">
          Run
        </Button>
      </div>
      <p id="workflow-effect-availability" className="text-xs">
        Save/Run require an available backend capability. Loading a plan does not grant execution authority.
      </p>
      {editor.saved.state === 'loading' && <p role="status">Loading saved workflows…</p>}
      {editor.saved.state === 'error' && <p role="alert">{editor.saved.message}</p>}
      {editor.saved.state === 'ready' && editor.saved.data.length === 0 && <p>No saved workflows were returned.</p>}
      {editor.capabilities.state === 'error' && (
        <p role="alert">{editor.capabilities.message} Only local control-flow nodes are available.</p>
      )}
      {editor.loadError && <p role="alert">{editor.loadError}</p>}
      {editor.ready && <WorkflowDraft editor={editor} />}
    </section>
  )
}
function WorkflowDraft({ editor }: { editor: WorkflowEditorController }) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor="workflow-name" className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          Workflow name
          <Input
            id="workflow-name"
            aria-label="workflow name"
            className="min-h-11"
            value={editor.draft.name}
            onChange={(event) => {
              editor.setName(event.target.value)
            }}
          />
        </label>
        <Button className="min-h-11" variant="outline" onClick={editor.layout}>
          Arrange nodes
        </Button>
      </div>
      <p role="status" className="break-words text-sm">
        {editor.draft.id ? `Preview of ${editor.draft.id}.` : 'New in-memory plan.'}{' '}
        {editor.draft.dirty ? 'Unsaved local edits.' : 'No local edits.'} Leaving this Work admission discards the
        preview.
      </p>
      <section aria-label="Plan validation" className="rounded border p-2 text-sm">
        <p>Local capability checks only. No backend validation or execution is implied.</p>
        {editor.warnings.length ? (
          <ul>
            {editor.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p>No local capability warnings. This is not proof that the plan can run.</p>
        )}
      </section>
      <div className="workflow-editor-grid">
        <div className="workflow-editor-side">
          <NodePalette
            capabilities={editor.capabilities.state === 'ready' ? editor.capabilities.data : null}
            loading={editor.capabilities.state === 'loading'}
            onAdd={(payload) => {
              editor.add(payload)
            }}
          />
        </div>
        <WorkflowCanvas editor={editor} />
        <div className="workflow-editor-side">
          <Inspector node={editor.selectedNode} onPatch={editor.patch} onDelete={editor.remove} />
        </div>
      </div>
      <WorkflowKeyboardControls editor={editor} />
      <details className="min-w-0 rounded border p-2 text-sm">
        <summary className="min-h-11 cursor-pointer py-2">Derived plan preview</summary>
        <p className="break-words" data-testid="derived-spec">
          steps: [{editor.spec.steps.join(', ')}] · orchestrates: [{editor.spec.orchestrates.join(', ')}]
        </p>
      </details>
    </>
  )
}
function WorkflowCanvas({ editor }: { editor: WorkflowEditorController }) {
  const { screenToFlowPosition } = useReactFlow()
  const { setSelectedId } = editor
  const onSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams<WorkflowNode>) => {
      setSelectedId(nodes[0]?.id ?? null)
    },
    [setSelectedId],
  )
  function drop(event: DragEvent) {
    event.preventDefault()
    try {
      const payload = palettePayloadSchema.parse(JSON.parse(event.dataTransfer.getData(PALETTE_DND_MIME)))
      editor.add(payload, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    } catch {
      /* Ignore malformed local drag payloads without changing the draft. */
    }
  }
  return (
    <div className="workflow-editor-canvas" data-testid="workflow-canvas">
      <ReactFlow<WorkflowNode>
        nodes={editor.draft.nodes}
        edges={editor.draft.edges}
        onNodesChange={editor.changeNodes}
        onEdgesChange={editor.changeEdges}
        onConnect={editor.connect}
        nodeTypes={workflowNodeTypes}
        onDrop={drop}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onNodeClick={(_, node) => {
          editor.setSelectedId(node.id)
        }}
        onPaneClick={() => {
          editor.setSelectedId(null)
        }}
        onSelectionChange={onSelectionChange}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
function WorkflowKeyboardControls({ editor }: { editor: WorkflowEditorController }) {
  const [target, setTarget] = useState('')
  const validTarget = editor.draft.nodes.some((node) => node.id === target)
  return (
    <section aria-label="Keyboard plan controls" className="space-y-2 rounded border p-3">
      <label className="flex flex-col gap-1 text-sm">
        Inspect node
        <select
          className="min-h-11 min-w-0 rounded border bg-background px-2"
          value={editor.selectedId ?? ''}
          onChange={(event) => {
            editor.setSelectedId(event.target.value || null)
          }}
        >
          <option value="">Select a node</option>
          {editor.draft.nodes.map((node, index) => (
            <option key={node.id} value={node.id}>
              {index + 1}. {node.data.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          Connect selected node to
          <select
            className="min-h-11 rounded border bg-background px-2"
            value={validTarget ? target : ''}
            onChange={(event) => {
              setTarget(event.target.value)
            }}
          >
            <option value="">Select target</option>
            {editor.draft.nodes
              .filter((node) => node.id !== editor.selectedId)
              .map((node, index) => (
                <option key={node.id} value={node.id}>
                  {index + 1}. {node.data.label}
                </option>
              ))}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={!editor.selectedId || !validTarget || target === editor.selectedId}
          onClick={() => {
            if (editor.selectedId)
              editor.connect({ source: editor.selectedId, target, sourceHandle: null, targetHandle: null })
          }}
        >
          Connect nodes
        </Button>
      </div>
    </section>
  )
}
