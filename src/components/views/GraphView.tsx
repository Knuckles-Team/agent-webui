import { useState, useEffect, useRef } from 'react'
import { Network, Database, Brain, FileText, Clock, RefreshCw, Search, ZoomIn, ZoomOut, Maximize2, Download } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, any>
}

interface GraphRelationship {
  source: string
  type: string
  target: string
}

interface GraphStats {
  total_nodes: number
  total_relationships: number
  by_type: Record<string, number>
}

export default function GraphView() {
  const [stats, setStats] = useState<GraphStats>({ total_nodes: 0, total_relationships: 0, by_type: {} })
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [relationships, setRelationships] = useState<GraphRelationship[]>([])
  const [selectedNodeType, setSelectedNodeType] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [graphLayout, setGraphLayout] = useState<'force' | 'hierarchical' | 'circular'>('force')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    void fetchData()
  }, [selectedNodeType])

  // Canvas rendering effect
  useEffect(() => {
    if (activeTab === 'visualization' && canvasRef.current) {
      renderGraph()
    }
  }, [activeTab, nodes, relationships, graphLayout, zoomLevel, panOffset, selectedNode])

  const renderGraph = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(panOffset.x, panOffset.y)
    ctx.scale(zoomLevel, zoomLevel)

    // Calculate node positions based on layout
    const nodePositions = calculateNodePositions()

    // Draw relationships
    relationships.forEach(rel => {
      const source = nodePositions.get(rel.source)
      const target = nodePositions.get(rel.target)
      if (source && target) {
        ctx.beginPath()
        ctx.moveTo(source.x, source.y)
        ctx.lineTo(target.x, target.y)
        ctx.strokeStyle = '#64748b'
        ctx.lineWidth = 1
        ctx.stroke()

        // Draw arrow
        const angle = Math.atan2(target.y - source.y, target.x - source.x)
        const arrowLength = 10
        ctx.beginPath()
        ctx.moveTo(target.x, target.y)
        ctx.lineTo(
          target.x - arrowLength * Math.cos(angle - Math.PI / 6),
          target.y - arrowLength * Math.sin(angle - Math.PI / 6)
        )
        ctx.lineTo(
          target.x - arrowLength * Math.cos(angle + Math.PI / 6),
          target.y - arrowLength * Math.sin(angle + Math.PI / 6)
        )
        ctx.closePath()
        ctx.fillStyle = '#64748b'
        ctx.fill()
      }
    })

    // Draw nodes
    nodes.forEach(node => {
      const pos = nodePositions.get(node.id)
      if (!pos) return

      const mainType = node.labels.find(l => nodeTypeColors[l]) || node.labels[0]
      const color = nodeTypeColors[mainType] || 'bg-muted'

      // Extract color classes (simplified)
      const bgColor = color.includes('blue') ? '#3b82f6' :
                     color.includes('green') ? '#22c55e' :
                     color.includes('purple') ? '#a855f7' :
                     color.includes('orange') ? '#f97316' :
                     color.includes('red') ? '#ef4444' : '#64748b'

      // Draw node circle
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, 20, 0, 2 * Math.PI)
      ctx.fillStyle = bgColor
      ctx.fill()
      ctx.strokeStyle = selectedNode?.id === node.id ? '#ffffff' : '#1e293b'
      ctx.lineWidth = selectedNode?.id === node.id ? 3 : 1
      ctx.stroke()

      // Draw node label
      ctx.fillStyle = '#ffffff'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(node.id.substring(0, 10), pos.x, pos.y + 35)
    })

    ctx.restore()
  }

  const calculateNodePositions = () => {
    const positions = new Map<string, { x: number; y: number }>()
    const canvas = canvasRef.current
    if (!canvas) return positions

    const centerX = canvas.width / 2 / zoomLevel - panOffset.x / zoomLevel
    const centerY = canvas.height / 2 / zoomLevel - panOffset.y / zoomLevel

    if (graphLayout === 'circular') {
      const radius = Math.min(canvas.width, canvas.height) / 3
      nodes.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / nodes.length
        positions.set(node.id, {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle)
        })
      })
    } else if (graphLayout === 'hierarchical') {
      const levels = groupNodesByLevel()
      let y = 50
      Object.entries(levels).forEach(([level, levelNodes]) => {
        const xStep = canvas.width / (levelNodes.length + 1)
        levelNodes.forEach((node, i) => {
          positions.set(node.id, {
            x: xStep * (i + 1),
            y: y
          })
        })
        y += 100
      })
    } else {
      // Force layout (simplified)
      nodes.forEach((node, i) => {
        const angle = Math.random() * 2 * Math.PI
        const radius = 100 + Math.random() * 200
        positions.set(node.id, {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle)
        })
      })
    }

    return positions
  }

  const groupNodesByLevel = () => {
    const levels: Record<string, GraphNode[]> = {}
    nodes.forEach((node, i) => {
      const level = Math.floor(i / 5).toString()
      if (!levels[level]) levels[level] = []
      levels[level].push(node)
    })
    return levels
  }

  const exportGraph = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const link = document.createElement('a')
    link.download = 'graph-visualization.png'
    link.href = canvas.toDataURL()
    link.click()
    toast.success('Graph exported as PNG')
  }

  const fetchData = async () => {
    try {
      setLoading(true)
      const [statsRes, nodesRes, relsRes] = await Promise.all([
        fetch('/api/enhanced/graph/stats'),
        fetch(selectedNodeType ? `/api/enhanced/graph/nodes?node_type=${selectedNodeType}` : '/api/enhanced/graph/nodes'),
        fetch('/api/enhanced/graph/relationships'),
      ])

      const statsData = (await statsRes.json()) as GraphStats
      const nodesData = (await nodesRes.json()) as GraphNode[]
      const relsData = (await relsRes.json()) as GraphRelationship[]

      setStats(statsData)
      setNodes(nodesData)
      setRelationships(relsData)
    } catch (err) {
      toast.error('Failed to load graph data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const filteredNodes = nodes.filter(
    (node) =>
      node.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      Object.values(node.properties).some(
        (val) => String(val).toLowerCase().includes(searchQuery.toLowerCase())
      )
  )

  const nodeTypeColors: Record<string, string> = {
    Job: 'bg-blue-500/10 border-blue-500/20 text-blue-500',
    Log: 'bg-green-500/10 border-green-500/20 text-green-500',
    Memory: 'bg-purple-500/10 border-purple-500/20 text-purple-500',
    KnowledgeBase: 'bg-orange-500/10 border-orange-500/20 text-orange-500',
    Article: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500',
    KBConcept: 'bg-pink-500/10 border-pink-500/20 text-pink-500',
    KBFact: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-500',
    Prompt: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-500',
    Tool: 'bg-red-500/10 border-red-500/20 text-red-500',
    User: 'bg-teal-500/10 border-teal-500/20 text-teal-500',
    Client: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500',
    Heartbeat: 'bg-rose-500/10 border-rose-500/20 text-rose-500',
    Message: 'bg-violet-500/10 border-violet-500/20 text-violet-500',
  }

  const nodeTypeIcons: Record<string, any> = {
    Job: Clock,
    Log: FileText,
    Memory: Brain,
    KnowledgeBase: Database,
    Article: FileText,
    KBConcept: Brain,
    KBFact: FileText,
    Prompt: Brain,
    Tool: Network,
    User: Brain,
    Client: Network,
    Heartbeat: Clock,
    Message: FileText,
  }

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="size-6" />
            Knowledge Graph
          </h1>
          <p className="text-muted-foreground text-sm">Full visibility into graph components</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchData()} className="gap-2">
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="nodes">Nodes</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="visualization">Visualization</TabsTrigger>
          <TabsTrigger value="explorer">Explorer</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Total Nodes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.total_nodes}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Total Relationships</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.total_relationships}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Node Types</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Object.keys(stats.by_type).length}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Nodes by Type</CardTitle>
              <CardDescription>Distribution of node types in the graph</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(stats.by_type).map(([type, count]) => {
                  const Icon = nodeTypeIcons[type] || Database
                  return (
                    <div key={type} className="flex items-center justify-between p-3 rounded-lg border border-border/40 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={cn('p-2 rounded-lg', nodeTypeColors[type] || 'bg-muted')}>
                          <Icon className="size-4" />
                        </div>
                        <span className="font-medium">{type}</span>
                      </div>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  )
                })}
                {Object.keys(stats.by_type).length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No nodes found</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Nodes Tab */}
        <TabsContent value="nodes" className="space-y-4">
          <div className="flex gap-4 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search nodes..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={selectedNodeType === null ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedNodeType(null)}
              >
                All
              </Button>
              {Object.keys(stats.by_type).map((type) => (
                <Button
                  key={type}
                  variant={selectedNodeType === type ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedNodeType(type)}
                >
                  {type}
                </Button>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Graph Nodes</CardTitle>
              <CardDescription>
                {selectedNodeType ? `${selectedNodeType} nodes` : 'All nodes'} ({filteredNodes.length})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {loading ? (
                    <p className="text-center text-muted-foreground py-8">Loading...</p>
                  ) : filteredNodes.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No nodes found</p>
                  ) : (
                    filteredNodes.map((node) => {
                      const mainType = node.labels.find((l) => nodeTypeColors[l]) || node.labels[0]
                      const Icon = nodeTypeIcons[mainType] || Database
                      return (
                        <div
                          key={node.id}
                          className="p-4 rounded-lg border border-border/40 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3 flex-1">
                              <div className={cn('p-2 rounded-lg mt-1', nodeTypeColors[mainType] || 'bg-muted')}>
                                <Icon className="size-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-mono text-sm font-medium mb-1 truncate">{node.id}</div>
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {node.labels.map((label) => (
                                    <Badge key={label} variant="outline" className="text-[10px]">
                                      {label}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                  {Object.entries(node.properties).slice(0, 5).map(([key, value]) => (
                                    <div key={key} className="flex gap-2">
                                      <span className="font-medium">{key}:</span>
                                      <span className="truncate">{String(value)}</span>
                                    </div>
                                  ))}
                                  {Object.keys(node.properties).length > 5 && (
                                    <div className="text-muted-foreground italic">
                                      +{Object.keys(node.properties).length - 5} more properties
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Relationships Tab */}
        <TabsContent value="relationships" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Graph Relationships</CardTitle>
              <CardDescription>Connections between nodes ({relationships.length})</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {loading ? (
                    <p className="text-center text-muted-foreground py-8">Loading...</p>
                  ) : relationships.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No relationships found</p>
                  ) : (
                    relationships.map((rel, index) => (
                      <div
                        key={index}
                        className="p-3 rounded-lg border border-border/40 hover:bg-muted/50 transition-colors flex items-center gap-3"
                      >
                        <code className="text-sm font-mono bg-muted px-2 py-1 rounded">{rel.source}</code>
                        <Badge variant="outline" className="shrink-0">{rel.type}</Badge>
                        <code className="text-sm font-mono bg-muted px-2 py-1 rounded">{rel.target}</code>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Visualization Tab */}
        <TabsContent value="visualization" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Interactive Graph Visualization</CardTitle>
                  <CardDescription>Visualize graph topology with interactive controls</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={graphLayout === 'force' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setGraphLayout('force')}
                  >
                    Force
                  </Button>
                  <Button
                    variant={graphLayout === 'hierarchical' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setGraphLayout('hierarchical')}
                  >
                    Hierarchical
                  </Button>
                  <Button
                    variant={graphLayout === 'circular' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setGraphLayout('circular')}
                  >
                    Circular
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Button variant="outline" size="sm" onClick={() => setZoomLevel(Math.min(zoomLevel + 0.2, 3))}>
                  <ZoomIn className="size-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setZoomLevel(Math.max(zoomLevel - 0.2, 0.2))}>
                  <ZoomOut className="size-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }) }}>
                  <Maximize2 className="size-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => void fetchData()}>
                  <RefreshCw className="size-4" />
                </Button>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => exportGraph()}>
                  <Download className="size-4" />
                </Button>
              </div>
              <div className="relative border rounded-lg overflow-hidden" style={{ height: '600px' }}>
                <canvas
                  ref={canvasRef}
                  className="w-full h-full bg-background"
                  style={{ cursor: 'grab' }}
                  onMouseDown={(e) => { e.currentTarget.style.cursor = 'grabbing' }}
                  onMouseUp={(e) => { e.currentTarget.style.cursor = 'grab' }}
                />
                {selectedNode && (
                  <div className="absolute top-4 right-4 w-80 bg-background border rounded-lg p-4 shadow-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">Node Details</h4>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)}>
                        ×
                      </Button>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div><span className="font-medium">ID:</span> {selectedNode.id}</div>
                      <div><span className="font-medium">Labels:</span> {selectedNode.labels.join(', ')}</div>
                      {Object.entries(selectedNode.properties).slice(0, 5).map(([key, value]) => (
                        <div key={key}><span className="font-medium">{key}:</span> {String(value)}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Explorer Tab */}
        <TabsContent value="explorer" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Access</CardTitle>
              <CardDescription>Navigate to specific graph components</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.keys(stats.by_type).map((type) => {
                  const Icon = nodeTypeIcons[type] || Database
                  const count = stats.by_type[type]
                  return (
                    <Button
                      key={type}
                      variant="outline"
                      className="h-24 flex-col gap-2 hover:bg-muted/50"
                      onClick={() => {
                        setSelectedNodeType(type)
                        setActiveTab('nodes')
                      }}
                    >
                      <Icon className={cn('size-6', nodeTypeColors[type]?.split(' ')[2])} />
                      <div className="text-center">
                        <div className="font-medium">{type}</div>
                        <div className="text-xs text-muted-foreground">{count} nodes</div>
                      </div>
                    </Button>
                  )
                })}
                {Object.keys(stats.by_type).length === 0 && (
                  <p className="text-center text-muted-foreground col-span-3 py-8">No node types found</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
