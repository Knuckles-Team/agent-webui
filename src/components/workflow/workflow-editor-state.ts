import { z } from 'zod'
import { fromWorkflowSpec, type SavedWorkflow, type WorkflowCanvas } from '@/lib/workflow'

const config = z.object({
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  requiredCapability: z.string().optional(),
})
export const palettePayloadSchema = z.object({
  kind: z.enum(['agent', 'tool', 'skill', 'step', 'team', 'router']),
  refId: z.string().optional(),
  label: z.string(),
  system_prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
})
const canvasSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: z.enum(['agent', 'tool', 'skill', 'step', 'team', 'router']).optional(),
      position: z.object({ x: z.number(), y: z.number() }),
      data: z.object({
        kind: z.enum(['agent', 'tool', 'skill', 'step', 'team', 'router']),
        refId: z.string().optional(),
        label: z.string(),
        config: config.optional(),
      }),
    }),
  ),
  edges: z.array(z.object({ id: z.string().min(1), source: z.string(), target: z.string() })),
})

/** The legacy client deliberately treats canvas as unknown. Validate before mounting it. */
export function workflowCanvas(workflow: SavedWorkflow): WorkflowCanvas {
  const snapshot = workflow.canvas == null ? undefined : canvasSchema.parse(workflow.canvas)
  const canvas = fromWorkflowSpec(workflow, snapshot)
  const ids = new Set(canvas.nodes.map((node) => node.id))
  if (ids.size !== canvas.nodes.length) throw new Error('Workflow contains duplicate node identifiers')
  if (canvas.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target)))
    throw new Error('Workflow contains an edge outside its nodes')
  // This preview is not a live execution. Never restore transient success statuses.
  return {
    nodes: canvas.nodes.map((node) => ({ ...node, type: node.data.kind, data: { ...node.data, status: undefined } })),
    edges: canvas.edges,
  }
}

/** Current served host explicitly returns unavailable for both mutation routes. */
export const WORKFLOW_EFFECTS_UNAVAILABLE =
  'Save and Run are unavailable on this backend. Edits are in-memory previews, not persisted workflows or executions.'
