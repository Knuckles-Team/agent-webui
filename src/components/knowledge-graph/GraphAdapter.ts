import Graph from 'graphology'

export interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, any>
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
  }
  return colors[type] || '#64748b' // default slate
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

  // Place structural nodes in a circle
  structuralNodes.forEach((node, idx) => {
    const angle = (idx / Math.max(structuralNodes.length, 1)) * Math.PI * 2
    const x = Math.cos(angle) * spread
    const y = Math.sin(angle) * spread

    const mainLabel = node.labels[0] || 'Unknown'
    graph.addNode(node.id, {
      x,
      y,
      size: 15,
      color: getNodeColor(mainLabel),
      label: node.properties.name || node.id.substring(0, 10),
      nodeType: mainLabel,
      mass: getNodeMass(mainLabel),
    })
  })

  // Place other nodes randomly
  otherNodes.forEach((node) => {
    const mainLabel = node.labels[0] || 'Unknown'
    graph.addNode(node.id, {
      x: (Math.random() - 0.5) * spread * 0.5,
      y: (Math.random() - 0.5) * spread * 0.5,
      size: 8,
      color: getNodeColor(mainLabel),
      label: node.properties.name || node.id.substring(0, 10),
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
