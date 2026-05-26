import { useState, useEffect } from 'react'
import {
  Network,
  Terminal,
  Brain,
  RefreshCw,
  Database,
  Play,
  Layers,
  Sparkles
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
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
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('visualization')

  // Cypher states
  const [cypherQuery, setCypherQuery] = useState('MATCH (n) RETURN n LIMIT 15')
  const [cypherResults, setCypherResults] = useState<any[] | null>(null)
  const [executingCypher, setExecutingCypher] = useState(false)

  // MAGMA states
  const [magmaQuery, setMagmaQuery] = useState('')
  const [magmaView, setMagmaView] = useState<'semantic' | 'structural' | 'temporal' | 'hybrid'>('semantic')
  const [magmaResults, setMagmaResults] = useState<any[] | null>(null)
  const [retrievingMagma, setRetrievingMagma] = useState(false)

  useEffect(() => {
    void fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [statsRes, nodesRes, relsRes] = await Promise.all([
        fetch('/api/enhanced/graph/stats'),
        fetch('/api/enhanced/graph/nodes'),
        fetch('/api/enhanced/graph/relationships'),
      ])

      const statsData = (await statsRes.json()) as GraphStats
      const nodesData = (await nodesRes.json()) as GraphNode[]
      const relsData = (await relsRes.json()) as GraphRelationship[]

      setStats(statsData)
      setNodes(nodesData)
      setRelationships(relsData)
    } catch (err) {
      toast.error('Failed to load graph database nodes')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

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

  const runCypherQuery = async () => {
    if (!cypherQuery.trim()) return
    setExecutingCypher(true)
    try {
      const res = await fetch('/api/enhanced/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cypherQuery })
      })
      if (!res.ok) {
        const errorText = await res.text()
        toast.error(`Cypher Execution Failed: ${errorText}`)
        return
      }
      const data = await res.json()
      setCypherResults(data)
      toast.success('Cypher query completed')
    } catch {
      toast.error('Error executing Cypher query')
    } finally {
      setExecutingCypher(false)
    }
  }

  const runMagmaRetrieve = async () => {
    if (!magmaQuery.trim()) return
    setRetrievingMagma(true)
    try {
      const res = await fetch('/api/enhanced/graph/magma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: magmaQuery,
          view_type: magmaView
        })
      })
      if (!res.ok) {
        toast.error('Failed orthogonal view MAGMA retrieval')
        return
      }
      const data = await res.json()
      setMagmaResults(data)
      toast.success('MAGMA orthogonal context retrieved')
    } catch {
      toast.error('Error during MAGMA contextual scan')
    } finally {
      setRetrievingMagma(false)
    }
  }

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)] flex flex-col">
      {/* Dynamic Summary Cards */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-500 flex items-center gap-2">
            <Network className="size-6 text-emerald-400" />
            Unified Graph Workspace
          </h2>
          <p className="text-sm text-muted-foreground">
            Execute cypher commands, traverse MAGMA orthogonal contexts, and view live active clusters.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Nodes: {stats.total_nodes}
          </Badge>
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Edges: {stats.total_relationships}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Structured Graph Tab List */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="grid w-full grid-cols-3 max-w-lg bg-muted/30 p-1 shrink-0 border border-border/40 rounded-xl">
          <TabsTrigger value="visualization" className="gap-1.5 text-xs">
            <Network className="size-3.5" />
            Visual Canvas
          </TabsTrigger>
          <TabsTrigger value="cypher" className="gap-1.5 text-xs">
            <Terminal className="size-3.5" />
            Cypher Console
          </TabsTrigger>
          <TabsTrigger value="magma" className="gap-1.5 text-xs">
            <Brain className="size-3.5" />
            MAGMA Context
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Network Visualization */}
        <TabsContent value="visualization" className="flex-1 overflow-hidden mt-4">
          <Card className="h-full border-border/40 bg-card/60 backdrop-blur-md flex flex-col">
            <CardContent className="flex-1 p-0 relative overflow-hidden h-full min-h-[450px]">
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

        {/* Tab 2: Cypher Console Terminal */}
        <TabsContent value="cypher" className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden mt-4">
          <Card className="lg:col-span-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Terminal className="size-4 text-emerald-400" />
                Query Editor
              </CardTitle>
              <CardDescription>Enter Cypher graph query syntax.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 gap-4">
              <Textarea
                value={cypherQuery}
                onChange={(e) => setCypherQuery(e.target.value)}
                className="flex-1 font-mono text-xs bg-muted/10 border-border/40 p-3 resize-none h-[250px] lg:h-auto"
                placeholder="MATCH (n) RETURN n LIMIT 10"
              />
              <Button onClick={() => void runCypherQuery()} disabled={executingCypher} className="bg-emerald-600 hover:bg-emerald-700 w-full">
                <Play className="size-4 mr-2" />
                {executingCypher ? 'Executing...' : 'Run Query'}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/30 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold">Execution Output</CardTitle>
                <CardDescription>Formatted tabular cypher nodes return.</CardDescription>
              </div>
              {cypherResults && (
                <Badge variant="secondary" className="text-[10px]">
                  {cypherResults.length} records returned
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0 bg-muted/5">
              <ScrollArea className="h-full">
                {cypherResults ? (
                  <pre className="p-4 font-mono text-xs text-muted-foreground whitespace-pre overflow-auto">
                    {JSON.stringify(cypherResults, null, 2)}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                    <Database className="size-10 text-muted-foreground/30 mb-2" />
                    <p className="text-xs">No active execution dataset found. Submit a query to inspect live nodes.</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: MAGMA Orthogonal views retriever */}
        <TabsContent value="magma" className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden mt-4">
          <Card className="lg:col-span-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Brain className="size-4 text-emerald-400" />
                Orthogonal Scanning
              </CardTitle>
              <CardDescription>Leverage multi-perspective contextual slices.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Orthogonal Perspective View</label>
                <select
                  value={magmaView}
                  onChange={(e) => setMagmaView(e.target.value as any)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="semantic" className="bg-background text-foreground">Semantic View (NL concepts)</option>
                  <option value="structural" className="bg-background text-foreground">Structural View (Code inheritance)</option>
                  <option value="temporal" className="bg-background text-foreground">Temporal View (Execution logs/crons)</option>
                  <option value="hybrid" className="bg-background text-foreground">Hybrid Synthesized View</option>
                </select>
              </div>
              <div className="space-y-1.5 flex-1 flex flex-col">
                <label className="text-xs font-semibold text-muted-foreground">Target Prompt Context / Seed</label>
                <Textarea
                  value={magmaQuery}
                  onChange={(e) => setMagmaQuery(e.target.value)}
                  className="flex-1 font-mono text-xs bg-muted/10 border-border/40 p-3 resize-none h-[180px] lg:h-auto"
                  placeholder="Enter retrieval keywords or context snippet..."
                />
              </div>
              <Button onClick={() => void runMagmaRetrieve()} disabled={retrievingMagma} className="bg-emerald-600 hover:bg-emerald-700 w-full shrink-0">
                <Sparkles className="size-4 mr-2" />
                {retrievingMagma ? 'Scanning...' : 'Retrieve MAGMA Context'}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/30 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold">Retrieved Perspectives Context</CardTitle>
                <CardDescription>Nodes grouped by perspective weights.</CardDescription>
              </div>
              {magmaResults && (
                <Badge variant="secondary" className="text-[10px]">
                  {magmaResults.length} vectors returned
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0 bg-muted/5">
              <ScrollArea className="h-full">
                {magmaResults ? (
                  <pre className="p-4 font-mono text-xs text-muted-foreground whitespace-pre overflow-auto">
                    {JSON.stringify(magmaResults, null, 2)}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                    <Layers className="size-10 text-muted-foreground/30 mb-2" />
                    <p className="text-xs">No active MAGMA orthogonal context slices retrieved. Submit keywords above.</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
