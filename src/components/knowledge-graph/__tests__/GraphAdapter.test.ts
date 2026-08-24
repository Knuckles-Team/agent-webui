import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  knowledgeGraphToGraphology,
  type GraphNode,
  type GraphRelationship,
} from '@/components/knowledge-graph/GraphAdapter'

// Defect B (see GraphView.tsx FIX LANE 3 notes): graphology's `addNode`
// throws synchronously on a duplicate key. The live cause is a backend
// privacy redactor collapsing distinct uuids into the literal
// `[REDACTED_IBAN]` — a parallel lane owns that root fix. This suite covers
// the defense-in-depth here: the adapter must never let a duplicate id (of
// ANY origin) crash the whole canvas, must keep the first occurrence, and
// must make the skip observable rather than silently absorbing it.
describe('knowledgeGraphToGraphology — duplicate node id resilience', () => {
  const node = (id: string, name: string): GraphNode => ({
    id,
    labels: ['Memory'],
    properties: { name },
  })

  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('does not throw when the node list contains a duplicate id', () => {
    const nodes: GraphNode[] = [node('dup', 'First'), node('dup', 'Second'), node('unique', 'Third')]

    expect(() => knowledgeGraphToGraphology(nodes, [])).not.toThrow()
  })

  it('keeps the first occurrence and renders the remaining distinct nodes', () => {
    const nodes: GraphNode[] = [node('dup', 'First'), node('dup', 'Second'), node('unique', 'Third')]

    const graph = knowledgeGraphToGraphology(nodes, [])

    // Only two distinct ids ever reach the graph: the duplicate is collapsed
    // to its first occurrence, not dropped along with its id entirely.
    expect(graph.order).toBe(2)
    expect(graph.hasNode('dup')).toBe(true)
    expect(graph.hasNode('unique')).toBe(true)
    expect(graph.getNodeAttribute('dup', 'label')).toBe('First')
  })

  it('reports the duplicate count and skipped ids as graph attributes, and logs a warning', () => {
    const nodes: GraphNode[] = [
      node('dup', 'First'),
      node('dup', 'Second'),
      node('dup', 'Third'),
      node('unique', 'Fourth'),
    ]

    const graph = knowledgeGraphToGraphology(nodes, [])

    // Two duplicates skipped (the 2nd and 3rd occurrences of "dup").
    expect(graph.getAttribute('duplicateNodeCount')).toBe(2)
    expect(graph.getAttribute('skippedDuplicateNodeIds')).toEqual(['dup', 'dup'])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('duplicate node id')
  })

  it('does not warn or report duplicates when every id is unique', () => {
    const nodes: GraphNode[] = [node('a', 'A'), node('b', 'B')]

    const graph = knowledgeGraphToGraphology(nodes, [])

    expect(graph.getAttribute('duplicateNodeCount')).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('edges referencing a skipped duplicate id degrade sanely instead of crashing', () => {
    // "unique" -> "dup" is a normal edge; "dup" -> "unique" would be a
    // duplicate direction under graphology's default (undirected-key) guard
    // this adapter already applies via hasEdge, so use a third node to prove
    // an edge touching the SURVIVING duplicate node still wires up fine, and
    // that no edge referencing a fully-absent id can crash graph.addEdge.
    const nodes: GraphNode[] = [node('dup', 'First'), node('dup', 'Second'), node('other', 'Other')]
    const relationships: GraphRelationship[] = [
      { source: 'dup', type: 'RELATED_TO', target: 'other' },
      // References an id that was never in the node list at all — must not
      // throw, same as the pre-existing hasNode guard already handles.
      { source: 'ghost', type: 'RELATED_TO', target: 'other' },
    ]

    let graph: ReturnType<typeof knowledgeGraphToGraphology> | undefined
    expect(() => {
      graph = knowledgeGraphToGraphology(nodes, relationships)
    }).not.toThrow()

    expect(graph!.order).toBe(2)
    expect(graph!.size).toBe(1)
    expect(graph!.hasEdge('dup', 'other')).toBe(true)
  })
})
