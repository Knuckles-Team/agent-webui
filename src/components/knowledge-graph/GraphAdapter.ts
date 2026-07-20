import Graph from 'graphology'

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
}

export interface SigmaEdgeAttributes {
  size: number
  color: string
  type?: string
  label?: string
}

const getNodeColor = (type: string): string => {
  const colors: Record<string, string> = {
    Job: '#3b82f6', // blue
    Log: '#22c55e', // green
    Memory: '#a855f7', // purple
    KnowledgeBase: '#f97316', // orange
    Article: '#eab308', // yellow
    KBConcept: '#ec4899', // pink
    KBFact: '#06b6d4', // cyan
    Prompt: '#6366f1', // indigo
    Tool: '#ef4444', // red
    User: '#14b8a6', // teal
    Client: '#10b981', // emerald
    Heartbeat: '#f43f5e', // rose
    Message: '#8b5cf6', // violet
    Code: '#60a5fa', // light blue
    DatabaseTable: '#f59e0b', // amber
    DatabaseColumn: '#fbbf24', // amber-light
    DatabaseView: '#fb923c', // orange-light
    // Ontology schema graph (SchemaView, CONCEPT:AU-KG.ontology.schema-graph-visualization):
    // abstract interfaces vs. concrete object types.
    interface: '#0078d4', // blue (matches the backend's own palette anchor color)
    object_type: '#107c10', // green
  }
  return colors[type] || '#64748b' // default slate
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
// properties are present (the code-graph canvas), else the type-based defaults
// (the general KG). Keeps the general KG path byte-for-byte unchanged.
const nodeVisual = (
  node: GraphNode,
  mainLabel: string,
  fallbackSize: number,
  maxDegree: number,
): { size: number; color: string } => {
  const degree = node.properties.degree
  const community = node.properties.community
  return {
    size: typeof degree === 'number' ? degreeToSize(degree, maxDegree) : fallbackSize,
    color: typeof community === 'number' ? communityColor(community) : getNodeColor(mainLabel),
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
): Graph<SigmaNodeAttributes, SigmaEdgeAttributes> => {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>()

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

  // Place structural nodes in a circle
  structuralNodes.forEach((node, idx) => {
    const angle = (idx / Math.max(structuralNodes.length, 1)) * Math.PI * 2
    const x = Math.cos(angle) * spread
    const y = Math.sin(angle) * spread

    const mainLabel = node.labels[0] || 'Unknown'
    const { size, color } = nodeVisual(node, mainLabel, 15, maxDegree)
    graph.addNode(node.id, {
      x,
      y,
      size,
      color,
      label: typeof node.properties.name === 'string' ? node.properties.name : node.id.substring(0, 10),
      nodeType: mainLabel,
      mass: getNodeMass(mainLabel),
    })
  })

  // Place other nodes randomly
  otherNodes.forEach((node) => {
    const mainLabel = node.labels[0] || 'Unknown'
    const { size, color } = nodeVisual(node, mainLabel, 8, maxDegree)
    graph.addNode(node.id, {
      x: (Math.random() - 0.5) * spread * 0.5,
      y: (Math.random() - 0.5) * spread * 0.5,
      size,
      color,
      label: typeof node.properties.name === 'string' ? node.properties.name : node.id.substring(0, 10),
      nodeType: mainLabel,
      mass: getNodeMass(mainLabel),
    })
  })

  relationships.forEach((edge) => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      if (!graph.hasEdge(edge.source, edge.target)) {
        graph.addEdge(edge.source, edge.target, {
          size: 1,
          color: '#4b5563',
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
