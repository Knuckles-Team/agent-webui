import Graph from 'graphology'
import { nodeTypeColor, pickReadableTextColor, resolveThemeColors } from './theme-colors'

export interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

export interface GraphRelationship {
  source: string
  type: string
  target: string
}

export interface SigmaNodeAttributes {
  x: number
  y: number
  size: number
  color: string
  label: string
  nodeType: string
  mass: number
  /**
   * Per-node label text color, read by sigma's `labelColor: { attribute:
   * 'labelColor' }` setting (see GraphCanvas.tsx). Always set (never left to
   * sigma's own black-text default) — this is the fix for the reported
   * "black text hard to see on dark blue background" defect: computed to
   * meet WCAG AA (>=4.5:1) against wherever the label is actually drawn —
   * see the comment in `knowledgeGraphToGraphology` for exactly where that
   * is and why.
   */
  labelColor: string
}

export interface SigmaEdgeAttributes {
  size: number
  color: string
  type?: string
  label?: string
}

// GRAPH_NODE_TYPE_PROPERTY (models/knowledge_graph.py, backend canon): a
// node's class lives in its `node_type` property — NOT `type`, NOT `label`.
// On THIS endpoint's wire contract (`GET /api/enhanced/graph/nodes`,
// api_extensions.py's `get_graph_nodes`) the backend already lifts
// `properties.node_type` into `labels[0]` for us (and strips it back out of
// `properties`) — so `labels[0]` is, today, the same value. This helper
// checks `properties.node_type` FIRST regardless, so a node from any other
// path (a future direct engine read, a test fixture, code-graph/ontology
// mappings below) that carries the raw property still resolves correctly,
// with `labels[0]` as the fallback and 'Unknown' if neither is present —
// total, so a missing/odd node_type never crashes color resolution.
export const resolveNodeType = (node: GraphNode): string => {
  const prop = node.properties.node_type
  if (typeof prop === 'string' && prop) return prop
  return node.labels[0] || 'Unknown'
}

// Community-indexed palette for the code-graph canvas (CONCEPT:KG-2.214): color a
// node by its detected community so clusters are visually distinct.
const COMMUNITY_PALETTE = [
  '#e6194B',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#9A6324',
  '#800000',
  '#808000',
  '#000075',
  '#a9a9a9',
]

export const communityColor = (community: number | null | undefined): string => {
  if (community == null || Number.isNaN(community)) return '#64748b'
  const n = COMMUNITY_PALETTE.length
  return COMMUNITY_PALETTE[((community % n) + n) % n]
}

// Scale a node's size by its centrality (degree) so "god nodes" read as hubs.
export const degreeToSize = (degree: number, maxDegree: number): number => {
  const min = 4
  const max = 26
  if (!maxDegree || maxDegree <= 0) return min
  return min + (max - min) * Math.sqrt(Math.max(0, degree) / maxDegree)
}

// Visual attributes for a node: size=centrality + color=community when those
// properties are present (the code-graph canvas), else the node_type-based,
// theme-aware color (the general KG).
const nodeVisual = (
  node: GraphNode,
  mainLabel: string,
  fallbackSize: number,
  maxDegree: number,
  isDark: boolean,
): { size: number; color: string } => {
  const degree = node.properties.degree
  const community = node.properties.community
  return {
    size: typeof degree === 'number' ? degreeToSize(degree, maxDegree) : fallbackSize,
    color: typeof community === 'number' ? communityColor(community) : nodeTypeColor(mainLabel, isDark),
  }
}

const getNodeMass = (type: string): number => {
  switch (type) {
    case 'KnowledgeBase':
      return 50
    case 'Project':
      return 50
    case 'Folder':
      return 25
    case 'User':
      return 30
    default:
      return 2
  }
}

export const knowledgeGraphToGraphology = (
  nodes: GraphNode[],
  relationships: GraphRelationship[],
  // Defaults to dark — matches this canvas's original always-dark
  // `bg-slate-900` background, so any caller that hasn't been updated to
  // pass the live theme (e.g. an existing test) keeps its prior behavior.
  isDark = true,
): Graph<SigmaNodeAttributes, SigmaEdgeAttributes> => {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>()

  // Labels are drawn by sigma's default node-label renderer BESIDE the node
  // (`data.x + data.size + 3, ...` — `drawDiscNodeLabel` in
  // sigma/dist/index-*.esm.js), i.e. directly on the canvas background, not
  // over the node's own fill. So the one color that needs to meet WCAG AA
  // against "whatever it's actually drawn on" is the label color against
  // the CANVAS background — computed once per theme here and stamped onto
  // every node as its own `labelColor` attribute (rather than a single
  // sigma-level setting) so a future custom label renderer that DOES draw
  // over the fill can switch this to `pickReadableTextColor(color)` per
  // node without any call site changes.
  const theme = resolveThemeColors(isDark)
  const labelColor = pickReadableTextColor(theme.card)
  const edgeColor = theme.mutedForeground

  const structuralNodes = nodes.filter((n) =>
    n.labels.some((l) => ['KnowledgeBase', 'Project', 'Folder', 'User'].includes(l)),
  )
  const otherNodes = nodes.filter(
    (n) => !n.labels.some((l) => ['KnowledgeBase', 'Project', 'Folder', 'User'].includes(l)),
  )

  const spread = Math.sqrt(nodes.length) * 50

  // Max degree across nodes that carry one (drives centrality sizing on the
  // code-graph canvas; 0 for general-KG nodes so they keep constant sizes).
  const maxDegree = nodes.reduce(
    (m, n) => (typeof n.properties.degree === 'number' ? Math.max(m, n.properties.degree) : m),
    0,
  )

  // Defect B (canvas crash on a duplicate node id): graphology's `addNode`
  // throws SYNCHRONOUSLY on a duplicate key ("... node already exist in the
  // graph"), uncaught, which trips the view's error boundary and destroys
  // the whole canvas over ONE bad id. The known live cause is a backend
  // privacy redactor collapsing distinct uuids into the literal
  // `[REDACTED_IBAN]` (a parallel lane owns that root fix in
  // agent-utilities); this adapter's job is to degrade gracefully for ANY
  // duplicate, not just that one. Mirrors the `hasNode`/`hasEdge` guard the
  // edge loop below already uses. Duplicates are counted and logged — never
  // silently absorbed — because silently de-duping would hide exactly the
  // upstream corruption the other lane is trying to surface and fix.
  let duplicateNodeCount = 0
  const skippedDuplicateIds: string[] = []
  const addNodeSafely = (id: string, attrs: SigmaNodeAttributes): void => {
    if (graph.hasNode(id)) {
      duplicateNodeCount += 1
      skippedDuplicateIds.push(id)
      return
    }
    graph.addNode(id, attrs)
  }

  // Place structural nodes in a circle
  structuralNodes.forEach((node, idx) => {
    const angle = (idx / Math.max(structuralNodes.length, 1)) * Math.PI * 2
    const x = Math.cos(angle) * spread
    const y = Math.sin(angle) * spread

    const mainLabel = resolveNodeType(node)
    const { size, color } = nodeVisual(node, mainLabel, 15, maxDegree, isDark)
    addNodeSafely(node.id, {
      x,
      y,
      size,
      color,
      label: typeof node.properties.name === 'string' ? node.properties.name : node.id.substring(0, 10),
      nodeType: mainLabel,
      mass: getNodeMass(mainLabel),
      labelColor,
    })
  })

  // Place other nodes randomly
  otherNodes.forEach((node) => {
    const mainLabel = resolveNodeType(node)
    const { size, color } = nodeVisual(node, mainLabel, 8, maxDegree, isDark)
    addNodeSafely(node.id, {
      x: (Math.random() - 0.5) * spread * 0.5,
      y: (Math.random() - 0.5) * spread * 0.5,
      size,
      color,
      label: typeof node.properties.name === 'string' ? node.properties.name : node.id.substring(0, 10),
      nodeType: mainLabel,
      mass: getNodeMass(mainLabel),
      labelColor,
    })
  })

  if (duplicateNodeCount > 0) {
    console.warn(
      `knowledgeGraphToGraphology: skipped ${duplicateNodeCount} duplicate node id(s) ` +
        `(kept the first occurrence of each): ${skippedDuplicateIds.join(', ')}`,
    )
  }
  // Exposed as a graph-level attribute (rather than widening this function's
  // return type) so callers that want it — the future UI surfacing this to
  // the user, or a test — can read `graph.getAttribute('duplicateNodeCount')`
  // without every existing call site needing to change shape.
  graph.setAttribute('duplicateNodeCount', duplicateNodeCount)
  graph.setAttribute('skippedDuplicateNodeIds', skippedDuplicateIds)

  relationships.forEach((edge) => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      if (!graph.hasEdge(edge.source, edge.target)) {
        graph.addEdge(edge.source, edge.target, {
          size: 1,
          // Theme's own `--muted-foreground` token — chosen for exactly this
          // (secondary-content-on-background contrast), and sigma's default
          // `edgeLabelColor: { attribute: 'color' }` setting means the edge's
          // own label text reuses this same value automatically.
          color: edgeColor,
          type: 'line',
          label: edge.type,
        })
      }
    }
  })

  return graph
}

// ── Code-graph canvas mapping (CONCEPT:KG-2.214) ────────────────────────────
// The /graph/analyze code_metrics action returns a render payload of :Code nodes
// (each with degree + community) and the edges among them. Map it into the same
// GraphNode/GraphRelationship shape GraphCanvas already consumes, stashing degree
// and community under `properties` so the adapter sizes by centrality and colors
// by community — no GraphCanvas change needed.
export interface CodeMetricsNode {
  id: string
  label?: string | null
  file_path?: string | null
  degree: number
  community: number | null
}
export interface CodeMetricsEdge {
  source: string
  target: string
  rel?: string | null
}
export interface CodeMetricsGraph {
  nodes: CodeMetricsNode[]
  edges: CodeMetricsEdge[]
  truncated?: boolean
}

export const codeMetricsToGraphNodes = (
  g: CodeMetricsGraph,
): { nodes: GraphNode[]; relationships: GraphRelationship[] } => ({
  nodes: g.nodes.map((n) => ({
    id: n.id,
    labels: ['Code'],
    properties: {
      name: n.label ?? n.id,
      degree: n.degree,
      community: n.community,
      file_path: n.file_path ?? '',
    },
  })),
  relationships: g.edges.map((e) => ({
    source: e.source,
    type: e.rel ?? 'calls',
    target: e.target,
  })),
})

// ── Ontology schema-graph mapping (SchemaView, CONCEPT:AU-KG.ontology.schema-graph-visualization) ──
// GET /api/ontology/schema-graph returns the interface + link-type registries as
// a Cytoscape.js elements payload ({nodes: [{data}], edges: [{data}]}) — the
// ontology TYPE schema (TBox), not instance data. Map it into the same
// GraphNode/GraphRelationship shape GraphCanvas already consumes (kind stashed
// as the node's sole `labels` entry so `getNodeColor` distinguishes interface
// vs. object_type; the rest of the payload rides along under `properties` for
// the inspector panel) — no GraphCanvas change needed.
export interface OntologySchemaProperty {
  name: string
  type: string
  required: boolean
  description?: string
}
export interface OntologySchemaNodeData {
  id: string
  label: string
  kind: 'interface' | 'object_type'
  description?: string
  color?: string
  properties?: OntologySchemaProperty[]
}
export interface OntologySchemaEdgeData {
  id: string
  source: string
  target: string
  kind: 'implements' | 'extends' | 'relationship'
  label: string
  cardinality?: string
  edge_type?: string
}
export interface OntologySchemaGraph {
  nodes: { data: OntologySchemaNodeData }[]
  edges: { data: OntologySchemaEdgeData }[]
  counts: { interfaces: number; object_types: number; edges: number }
}

export const ontologySchemaGraphToGraphNodes = (
  g: OntologySchemaGraph,
): { nodes: GraphNode[]; relationships: GraphRelationship[] } => ({
  nodes: g.nodes.map((n) => ({
    id: n.data.id,
    labels: [n.data.kind],
    properties: {
      name: n.data.label,
      kind: n.data.kind,
      description: n.data.description ?? '',
      properties: n.data.properties ?? [],
    },
  })),
  relationships: g.edges.map((e) => ({
    source: e.data.source,
    type: e.data.label,
    target: e.data.target,
  })),
})
