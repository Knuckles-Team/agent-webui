import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  knowledgeGraphToGraphology,
  resolveNodeType,
  type GraphNode,
  type GraphRelationship,
} from '@/components/knowledge-graph/GraphAdapter'
import { contrastRatio, nodeTypeColor, resolveThemeColors } from '@/components/knowledge-graph/theme-colors'

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

// GRAPH_NODE_TYPE_PROPERTY (models/knowledge_graph.py canon): node kind lives
// in the `node_type` property, not `type`/`label`. `get_graph_nodes` (the
// live wire contract) already lifts it into `labels[0]`, but this adapter
// must resolve it from `properties.node_type` FIRST regardless, with
// `labels[0]` as fallback and 'Unknown' as the total default.
describe('resolveNodeType', () => {
  it('prefers properties.node_type over labels', () => {
    const n: GraphNode = { id: '1', labels: ['SomethingElse'], properties: { node_type: 'RuntimeSignal' } }
    expect(resolveNodeType(n)).toBe('RuntimeSignal')
  })

  it('falls back to labels[0] when node_type is absent', () => {
    const n: GraphNode = { id: '1', labels: ['WorkItem'], properties: {} }
    expect(resolveNodeType(n)).toBe('WorkItem')
  })

  it('falls back to "Unknown" when neither is present', () => {
    const n: GraphNode = { id: '1', labels: [], properties: {} }
    expect(resolveNodeType(n)).toBe('Unknown')
  })

  it('ignores a non-string or empty node_type property', () => {
    const n1: GraphNode = { id: '1', labels: ['WorkItem'], properties: { node_type: 42 } }
    expect(resolveNodeType(n1)).toBe('WorkItem')
    const n2: GraphNode = { id: '2', labels: ['Concept'], properties: { node_type: '' } }
    expect(resolveNodeType(n2)).toBe('Concept')
  })
})

// Colour-coordination + contrast wiring: knowledgeGraphToGraphology must
// stamp every node with a theme-appropriate, WCAG-AA labelColor and a
// node_type-derived fill, and must not crash or render an invisible label
// for a node whose type isn't in the explicit palette.
describe('knowledgeGraphToGraphology — node_type colour-coding + label contrast', () => {
  const typedNode = (id: string, nodeType: string): GraphNode => ({
    id,
    labels: [],
    properties: { node_type: nodeType, name: id },
  })

  it('colors nodes deterministically by node_type, using properties.node_type', () => {
    const nodes: GraphNode[] = [typedNode('a', 'RuntimeSignal'), typedNode('b', 'WorkItem')]
    const graph = knowledgeGraphToGraphology(nodes, [], true)
    expect(graph.getNodeAttribute('a', 'color')).toBe(nodeTypeColor('RuntimeSignal', true))
    expect(graph.getNodeAttribute('b', 'color')).toBe(nodeTypeColor('WorkItem', true))
    expect(graph.getNodeAttribute('a', 'nodeType')).toBe('RuntimeSignal')
  })

  it('does not crash and still assigns a legible color for an unknown node_type', () => {
    const nodes: GraphNode[] = [typedNode('a', 'SomeBrandNewType')]
    expect(() => knowledgeGraphToGraphology(nodes, [], false)).not.toThrow()
    const graph = knowledgeGraphToGraphology(nodes, [], false)
    const color = graph.getNodeAttribute('a', 'color') as string
    expect(color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it.each([
    ['dark', true],
    ['light', false],
  ] as const)(
    'every node gets a labelColor meeting WCAG AA (>=4.5:1) against the canvas background in %s mode',
    (_name, isDark) => {
      const nodes: GraphNode[] = [typedNode('a', 'RuntimeSignal'), typedNode('b', 'AnotherUnknownType')]
      const graph = knowledgeGraphToGraphology(nodes, [], isDark)
      const canvasBackground = resolveThemeColors(isDark).card
      graph.forEachNode((_node, attrs) => {
        expect(attrs.labelColor).toBeTruthy()
        expect(contrastRatio(attrs.labelColor, canvasBackground)).toBeGreaterThanOrEqual(4.5)
      })
    },
  )

  it('recolors for the theme actually passed in (dark vs. light differ)', () => {
    const nodes: GraphNode[] = [typedNode('a', 'RuntimeSignal')]
    const darkGraph = knowledgeGraphToGraphology(nodes, [], true)
    const lightGraph = knowledgeGraphToGraphology(nodes, [], false)
    expect(darkGraph.getNodeAttribute('a', 'labelColor')).not.toBe(lightGraph.getNodeAttribute('a', 'labelColor'))
  })

  it('defaults isDark to true when omitted (back-compat with existing callers)', () => {
    const nodes: GraphNode[] = [typedNode('a', 'RuntimeSignal')]
    const withDefault = knowledgeGraphToGraphology(nodes, [])
    const explicitDark = knowledgeGraphToGraphology(nodes, [], true)
    expect(withDefault.getNodeAttribute('a', 'color')).toBe(explicitDark.getNodeAttribute('a', 'color'))
  })
})
