import { useState, useEffect } from 'react'
import { Network, Database, Brain, FileText, Clock, RefreshCw, Search } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { GraphCanvas } from '../knowledge-graph/GraphCanvas'

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

  useEffect(() => {
    void fetchData()
  }, [selectedNodeType])

  const handleUpdateNode = (id: string, properties: any) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, properties: { ...n.properties, ...properties } } : n))
  }

  const handleDeleteNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id))
    setRelationships(prev => prev.filter(e => e.source !== id && e.target !== id))
  }

  const handleAddNode = (labels: string[], properties: any) => {
    const newNode: GraphNode = {
      id: `node_${Date.now()}`,
      labels,
      properties
    }
    setNodes(prev => [...prev, newNode])
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
          <Card className="h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Interactive Graph Visualization</CardTitle>
                  <CardDescription>Visualize and edit graph topology with intelligent clustering for 100K+ scaling</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="h-[600px] p-0 relative">
              {activeTab === 'visualization' && (
                <GraphCanvas
                  nodes={nodes}
                  relationships={relationships}
                  onUpdateNode={handleUpdateNode}
                  onDeleteNode={handleDeleteNode}
                  onAddNode={handleAddNode}
                  selectedNodeExternally={selectedNode}
                  onSelectNode={setSelectedNode}
                />
              )}
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
