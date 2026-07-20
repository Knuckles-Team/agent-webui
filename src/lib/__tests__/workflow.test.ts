import { describe, it, expect } from 'vitest'
import {
  fromWorkflowSpec,
  toWorkflowSpec,
  makeRefId,
  validateCapabilities,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowSpec,
} from '@/lib/workflow'

function agentNode(id: string, label: string, x = 0): WorkflowNode {
  return {
    id,
    type: 'agent',
    position: { x, y: 0 },
    data: { kind: 'agent', refId: id, label },
  }
}

function stepNode(id: string, label: string, x = 0): WorkflowNode {
  return { id, type: 'step', position: { x, y: 200 }, data: { kind: 'step', label } }
}

describe('workflow serializer', () => {
  it('makeRefId prefixes by kind and is idempotent', () => {
    expect(makeRefId('agent', 'researcher')).toBe('agent:researcher')
    expect(makeRefId('agent', 'agent:researcher')).toBe('agent:researcher')
    expect(makeRefId('step', 'plan')).toBe('plan')
  })

  it('derives orchestrates from agent/tool/skill refIds, deduped', () => {
    const nodes: WorkflowNode[] = [
      agentNode('agent:a', 'Agent A'),
      agentNode('agent:a', 'Dup'), // duplicate refId
      {
        id: 'tool:t',
        type: 'tool',
        position: { x: 0, y: 0 },
        data: { kind: 'tool', refId: 'tool:t', label: 'Tool T' },
      },
    ]
    const spec = toWorkflowSpec(nodes, [], 'Flow')
    expect(spec.orchestrates).toEqual(['agent:a', 'tool:t'])
  })

  it('derives steps in topological order following edges', () => {
    const nodes = [stepNode('s2', 'second', 100), stepNode('s1', 'first', 0)]
    const edges: WorkflowEdge[] = [{ id: 'e1', source: 's1', target: 's2' }]
    const spec = toWorkflowSpec(nodes, edges, 'Ordered')
    expect(spec.steps).toEqual(['first', 'second'])
  })

  it('round-trips toWorkflowSpec(fromWorkflowSpec(spec)) stably via persisted canvas', () => {
    const spec: WorkflowSpec = {
      name: 'My Flow',
      steps: ['plan', 'execute', 'review'],
      orchestrates: ['agent:planner', 'tool:search', 'skill:summarize'],
    }
    const canvas = fromWorkflowSpec(spec)
    const back = toWorkflowSpec(canvas.nodes, canvas.edges, spec.name)
    expect(back.name).toBe(spec.name)
    expect(back.orchestrates).toEqual(spec.orchestrates)
    expect(back.steps).toEqual(spec.steps)
  })

  it('returns persisted canvas verbatim when provided', () => {
    const persisted = {
      nodes: [agentNode('agent:x', 'X', 999)],
      edges: [],
    }
    const out = fromWorkflowSpec({ name: 'n', steps: [], orchestrates: ['agent:x'] }, persisted)
    expect(out.nodes[0].position.x).toBe(999)
  })

  it('validateCapabilities warns when a step requires a capability the agent lacks', () => {
    const nodes: WorkflowNode[] = [
      {
        id: 's',
        type: 'step',
        position: { x: 0, y: 0 },
        data: { kind: 'step', label: 'fetch', config: { requiredCapability: 'web-search' } },
      },
      {
        id: 'a',
        type: 'agent',
        position: { x: 200, y: 0 },
        data: { kind: 'agent', refId: 'agent:a', label: 'Agent', config: { tools: ['files'] } },
      },
    ]
    const edges: WorkflowEdge[] = [{ id: 'e', source: 's', target: 'a' }]
    const warnings = validateCapabilities(nodes, edges)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('web-search')
  })

  it('validateCapabilities is silent when capability data is absent', () => {
    const nodes: WorkflowNode[] = [
      {
        id: 's',
        type: 'step',
        position: { x: 0, y: 0 },
        data: { kind: 'step', label: 'fetch', config: { requiredCapability: 'web-search' } },
      },
      {
        id: 'a',
        type: 'agent',
        position: { x: 200, y: 0 },
        data: { kind: 'agent', refId: 'agent:a', label: 'Agent' },
      },
    ]
    const edges: WorkflowEdge[] = [{ id: 'e', source: 's', target: 'a' }]
    expect(validateCapabilities(nodes, edges)).toEqual([])
  })
})
