/**
 * @file workflow.ts
 * @description Types and (de)serializers for the visual workflow editor.
 *
 * Bridges the React Flow canvas (nodes + edges) and the backend canonical
 * `WorkflowSpec` ({name, steps, orchestrates}). The mapping is designed to be
 * stable so that `toWorkflowSpec(fromWorkflowSpec(spec))` round-trips.
 */

import type { Edge, Node } from '@xyflow/react'

/**
 * The discrete kinds of nodes the editor supports. Agent/Tool/Skill nodes
 * reference catalog entries (prefixed refIds) and contribute to `orchestrates`.
 * Step/Team/Router nodes describe control-flow and contribute to `steps`.
 */
export type WorkflowNodeKind = 'agent' | 'tool' | 'skill' | 'step' | 'team' | 'router'

/** Live execution status used to animate nodes during a run. */
export type WorkflowNodeStatus = 'idle' | 'running' | 'done' | 'error'

/**
 * Payload carried on every React Flow node's `data` field.
 */
export interface WorkflowNodeData extends Record<string, unknown> {
  /** The node kind, drives styling + serialization. */
  kind: WorkflowNodeKind
  /** Catalog reference id (e.g. `agent:researcher`), undefined for free steps. */
  refId?: string
  /** Human-readable label rendered in the node header. */
  label: string
  /** Free-form, kind-specific configuration (model, system_prompt, tags, …). */
  config?: WorkflowNodeConfig
  /** Transient live-run status (not serialized into the spec). */
  status?: WorkflowNodeStatus
}

/**
 * Editable configuration surfaced in the Inspector panel. All fields optional.
 */
export interface WorkflowNodeConfig {
  /** Model identifier for agent nodes (e.g. `anthropic:claude-...`). */
  model?: string
  /** System prompt for agent nodes. */
  system_prompt?: string
  /** Tool tags / capabilities granted to the node. */
  tools?: string[]
  /** A capability this step requires of a downstream/connected agent. */
  requiredCapability?: string
}

/** Strongly typed React Flow node for the editor. */
export type WorkflowNode = Node<WorkflowNodeData>
/** React Flow edge alias for clarity. */
export type WorkflowEdge = Edge

/**
 * The canonical backend workflow specification.
 */
export interface WorkflowSpec {
  /** Display name (also derives the workflow id on the backend). */
  name: string
  /** Ordered list of step identifiers / labels. */
  steps: string[]
  /** Agent/tool/skill refIds the workflow orchestrates. */
  orchestrates: string[]
}

/**
 * Serialized canvas snapshot persisted alongside the spec so the editor can
 * restore the exact visual layout on reload.
 */
export interface WorkflowCanvas {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** A saved workflow as returned by `GET /workflows`. */
export interface SavedWorkflow {
  id: string
  name: string
  steps: string[]
  orchestrates: string[]
  canvas?: WorkflowCanvas | null
}

/** Catalog entry for a draggable palette item. */
export interface CapabilityItem {
  id: string
  name: string
  kind: WorkflowNodeKind
  system_prompt?: string
  tools?: string[]
  description?: string
}

/** Palette catalog returned by `GET /workflows/capabilities`. */
export interface WorkflowCapabilities {
  agents: CapabilityItem[]
  tools: CapabilityItem[]
  skills: CapabilityItem[]
}

/** Result returned by `POST /workflows/{id}/run`. */
export interface WorkflowRunResult {
  run_id?: string
  status: string
  result?: unknown
  summary?: string
  error?: string
  /** Optional per-node statuses keyed by node id (best-effort). */
  node_status?: Record<string, WorkflowNodeStatus>
}

/** Maps a node kind to its `refId` prefix (agent/tool/skill only). */
const KIND_PREFIX: Partial<Record<WorkflowNodeKind, string>> = {
  agent: 'agent',
  tool: 'tool',
  skill: 'skill',
}

/** True for kinds that contribute a `refId` to `orchestrates`. */
function isOrchestratable(kind: WorkflowNodeKind): boolean {
  return kind === 'agent' || kind === 'tool' || kind === 'skill'
}

/**
 * Builds a stable refId for a catalog item (e.g. `agent:researcher`).
 */
export function makeRefId(kind: WorkflowNodeKind, id: string): string {
  const prefix = KIND_PREFIX[kind]
  if (!prefix) return id
  return id.startsWith(`${prefix}:`) ? id : `${prefix}:${id}`
}

interface TopoGraph {
  indexById: Map<string, number>
  indegree: Map<string, number>
  adjacency: Map<string, string[]>
}

/** The id→index map, in-degree counts, and adjacency list for Kahn's algorithm, ignoring edges to/from unknown nodes. */
function buildTopoGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): TopoGraph {
  const indexById = new Map(nodes.map((n, i) => [n.id, i]))
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.id, []]))

  for (const edge of edges) {
    if (!indexById.has(edge.source) || !indexById.has(edge.target)) continue
    adjacency.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  return { indexById, indegree, adjacency }
}

/** Kahn's algorithm proper: drain `ready` in deterministic (original-index) order, mutating `graph.indegree`. */
function runKahn(ready: string[], graph: TopoGraph): string[] {
  const { indexById, indegree, adjacency } = graph
  const ordered: string[] = []
  const seen = new Set<string>()
  while (ready.length > 0) {
    const id = ready.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    ordered.push(id)
    const next = [...(adjacency.get(id) ?? [])].sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0))
    for (const target of next) {
      const remaining = (indegree.get(target) ?? 0) - 1
      indegree.set(target, remaining)
      if (remaining <= 0 && !seen.has(target)) ready.push(target)
    }
  }
  return ordered
}

/**
 * Topologically orders nodes following edge direction (source → target). Falls
 * back to insertion order for nodes in cycles or disconnected components so the
 * result is always a total order over the input nodes.
 */
function topologicalOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const graph = buildTopoGraph(nodes, edges)
  const { indexById, indegree } = graph

  // Seed the queue with roots, preserving original ordering for determinism.
  const ready = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  ready.sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0))

  const ordered = runKahn(ready, graph)
  const seen = new Set(ordered)

  // Append any nodes left out by cycles, in insertion order.
  for (const node of nodes) {
    if (!seen.has(node.id)) ordered.push(node.id)
  }

  return ordered.map((id) => nodes[indexById.get(id)!])
}

/**
 * Derives a `WorkflowSpec` from the current canvas.
 *
 * - `orchestrates`: de-duplicated refIds of agent/tool/skill nodes, in
 *   topological order.
 * - `steps`: labels of `step` nodes (plus team/router) in topological order;
 *   if there are no explicit step nodes, falls back to the ordered labels of
 *   every node so the spec is never empty for a non-trivial canvas.
 */
export function toWorkflowSpec(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  name = 'Untitled Workflow',
): WorkflowSpec {
  const ordered = topologicalOrder(nodes, edges)

  const orchestrates: string[] = []
  const seenRefs = new Set<string>()
  for (const node of ordered) {
    const { kind, refId } = node.data
    if (isOrchestratable(kind) && refId && !seenRefs.has(refId)) {
      seenRefs.add(refId)
      orchestrates.push(refId)
    }
  }

  const stepNodes = ordered.filter((n) => n.data.kind === 'step' || n.data.kind === 'team' || n.data.kind === 'router')
  const steps = stepNodes.length > 0 ? stepNodes.map((n) => n.data.label) : ordered.map((n) => n.data.label)

  return { name, steps, orchestrates }
}

/**
 * Splits a refId back into its kind and bare id (`agent:x` → agent, x).
 */
function parseRefId(refId: string): { kind: WorkflowNodeKind; id: string } {
  const [maybePrefix, ...rest] = refId.split(':')
  if (rest.length > 0 && (maybePrefix === 'agent' || maybePrefix === 'tool' || maybePrefix === 'skill')) {
    return { kind: maybePrefix, id: rest.join(':') }
  }
  return { kind: 'step', id: refId }
}

/**
 * Reconstructs a canvas from a `WorkflowSpec`. When a persisted `canvas`
 * snapshot is supplied it is returned verbatim (exact round-trip). Otherwise a
 * deterministic auto-layout is synthesized: orchestrated refs become a row of
 * agent/tool/skill nodes, with `step` nodes laid out beneath them.
 */
export function fromWorkflowSpec(spec: WorkflowSpec, canvas?: WorkflowCanvas | null): WorkflowCanvas {
  if (canvas && canvas.nodes.length > 0) {
    return canvas
  }

  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []

  spec.orchestrates.forEach((refId, idx) => {
    const { kind, id } = parseRefId(refId)
    nodes.push({
      id: refId,
      type: kind,
      position: { x: 80 + idx * 240, y: 80 },
      data: { kind, refId, label: id },
    })
  })

  spec.steps.forEach((step, idx) => {
    const id = `step:${idx}:${step}`
    nodes.push({
      id,
      type: 'step',
      position: { x: 80 + idx * 240, y: 280 },
      data: { kind: 'step', label: step },
    })
    if (idx > 0) {
      const prev = `step:${idx - 1}:${spec.steps[idx - 1]}`
      edges.push({ id: `e:${prev}->${id}`, source: prev, target: id })
    }
  })

  return { nodes, edges }
}

/**
 * Best-effort capability validation. Returns warnings for edges where a `step`
 * node declares a `requiredCapability` that the connected agent's `tools` /
 * config do not satisfy. If capability data is absent, no warning is produced.
 */
/** The capability warning for one edge, or `null` when it isn't a step→agent pair needing one. */
function capabilityWarningForEdge(source: WorkflowNode, target: WorkflowNode): string | null {
  // Step → Agent where the step requires a capability.
  const step = [source, target].find((n) => n.data.kind === 'step')
  const agent = [source, target].find((n) => n.data.kind === 'agent')
  if (!step || !agent) return null

  const required = step.data.config?.requiredCapability
  if (!required) return null

  const caps = agent.data.config?.tools ?? []
  if (caps.length === 0) return null // No capability data — skip gracefully.

  if (caps.some((c) => c.toLowerCase().includes(required.toLowerCase()))) return null
  return `"${agent.data.label}" lacks required capability "${required}" for step "${step.data.label}"`
}

export function validateCapabilities(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const warnings: string[] = []

  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue
    const warning = capabilityWarningForEdge(source, target)
    if (warning) warnings.push(warning)
  }

  return warnings
}
