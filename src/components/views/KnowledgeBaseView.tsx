import { useState, useEffect } from 'react'
import { Book, Search, Plus, FileText, Brain, CheckCircle, AlertCircle, RefreshCw, Settings } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface KnowledgeBase {
  id: string
  name: string
  article_count: number
  topics: string[]
  health_status: 'healthy' | 'warning' | 'error'
  last_updated: string
}

interface KbHealthResult {
  health_status?: string
  issues?: string[]
  recommendations?: string[]
}

interface Article {
  id: string
  title: string
  content: string
  kb_id: string
  concepts: string[]
  created_at: string
}

export default function KnowledgeBaseView() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('browse')
  const [isIngestDialogOpen, setIsIngestDialogOpen] = useState(false)
  const [ingestForm, setIngestForm] = useState({ kb_id: '', source: '', name: '' })
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  const [healthResults, setHealthResults] = useState<KbHealthResult | null>(null)

  useEffect(() => {
    void fetchKnowledgeBases()
  }, [])

  useEffect(() => {
    if (selectedKB) {
      void fetchArticles(selectedKB.id)
    }
  }, [selectedKB])

  const fetchKnowledgeBases = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/enhanced/kb/list')
      const data = (await res.json()) as KnowledgeBase[]
      setKnowledgeBases(data)
      if (data.length > 0 && !selectedKB) {
        setSelectedKB(data[0])
      }
    } catch {
      toast.error('Failed to load knowledge bases')
    } finally {
      setLoading(false)
    }
  }

  const fetchArticles = async (kbId: string) => {
    try {
      const res = await fetch(`/api/enhanced/kb/search?query=&kb_id=${kbId}`)
      const data = (await res.json()) as Article[]
      setArticles(data)
    } catch {
      toast.error('Failed to load articles')
    }
  }

  const handleIngest = async () => {
    try {
      const res = await fetch('/api/enhanced/kb/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ingestForm),
      })
      if (res.ok) {
        toast.success('Knowledge base ingestion started')
        setIsIngestDialogOpen(false)
        setIngestForm({ kb_id: '', source: '', name: '' })
        void fetchKnowledgeBases()
      } else {
        toast.error('Failed to start ingestion')
      }
    } catch {
      toast.error('Failed to ingest knowledge base')
    }
  }

  const handleHealthCheck = async (kbId: string) => {
    try {
      const res = await fetch('/api/enhanced/kb/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kb_id: kbId }),
      })
      const data = (await res.json()) as KbHealthResult
      setHealthResults(data)
      setActiveTab('health')
    } catch {
      toast.error('Failed to run health check')
    }
  }

  const filteredKBs = knowledgeBases.filter(
    (kb) =>
      kb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kb.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kb.topics.some((topic) => topic.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  const filteredArticles = articles.filter(
    (article) =>
      article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.content.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Book className="size-6" />
            Knowledge Base
          </h1>
          <p className="text-muted-foreground text-sm">Manage knowledge bases and articles</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void fetchKnowledgeBases()
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Dialog open={isIngestDialogOpen} onOpenChange={setIsIngestDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                Ingest Knowledge Base
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ingest Knowledge Base</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Knowledge Base ID</label>
                  <Input
                    value={ingestForm.kb_id}
                    onChange={(e) => {
                      setIngestForm({ ...ingestForm, kb_id: e.target.value })
                    }}
                    placeholder="e.g., pydantic-ai-docs"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={ingestForm.name}
                    onChange={(e) => {
                      setIngestForm({ ...ingestForm, name: e.target.value })
                    }}
                    placeholder="Knowledge Base Name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Source Path</label>
                  <Input
                    value={ingestForm.source}
                    onChange={(e) => {
                      setIngestForm({ ...ingestForm, source: e.target.value })
                    }}
                    placeholder="/path/to/docs"
                  />
                </div>
                <Button
                  onClick={() => {
                    void handleIngest()
                  }}
                  className="w-full"
                >
                  Start Ingestion
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="articles">Articles</TabsTrigger>
          <TabsTrigger value="concepts">Concepts</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        {/* Browse Tab */}
        <TabsContent value="browse" className="space-y-4">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search knowledge bases..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              <p className="text-center text-muted-foreground col-span-3">Loading...</p>
            ) : filteredKBs.length === 0 ? (
              <p className="text-center text-muted-foreground col-span-3">No knowledge bases found</p>
            ) : (
              filteredKBs.map((kb) => (
                <Card
                  key={kb.id}
                  className={cn(
                    'cursor-pointer transition-all hover:shadow-md',
                    selectedKB?.id === kb.id ? 'ring-2 ring-primary' : '',
                  )}
                  onClick={() => {
                    setSelectedKB(kb)
                  }}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            'p-2 rounded-lg',
                            kb.health_status === 'healthy'
                              ? 'bg-green-500/10 text-green-500'
                              : kb.health_status === 'warning'
                                ? 'bg-yellow-500/10 text-yellow-500'
                                : 'bg-red-500/10 text-red-500',
                          )}
                        >
                          {kb.health_status === 'healthy' ? (
                            <CheckCircle className="size-4" />
                          ) : kb.health_status === 'warning' ? (
                            <AlertCircle className="size-4" />
                          ) : (
                            <AlertCircle className="size-4" />
                          )}
                        </div>
                        <div>
                          <CardTitle className="text-lg">{kb.name}</CardTitle>
                          <CardDescription>{kb.id}</CardDescription>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleHealthCheck(kb.id)
                        }}
                      >
                        <Settings className="size-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Articles</span>
                        <span className="font-medium">{kb.article_count}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {kb.topics.slice(0, 3).map((topic) => (
                          <Badge key={topic} variant="secondary" className="text-xs">
                            {topic}
                          </Badge>
                        ))}
                        {kb.topics.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{kb.topics.length - 3}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last updated: {new Date(kb.last_updated).toLocaleDateString()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Articles Tab */}
        <TabsContent value="articles" className="space-y-4">
          {!selectedKB ? (
            <div className="text-center text-muted-foreground py-20">
              <Book className="size-16 mx-auto mb-4" />
              <p>Select a knowledge base to view articles</p>
            </div>
          ) : (
            <>
              <div className="flex gap-4 items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search articles..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                    }}
                  />
                </div>
                <Badge variant="outline">{selectedKB.name}</Badge>
              </div>

              <div className="space-y-2">
                {loading ? (
                  <p className="text-center text-muted-foreground py-8">Loading articles...</p>
                ) : filteredArticles.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No articles found</p>
                ) : (
                  filteredArticles.map((article) => (
                    <Card
                      key={article.id}
                      className="cursor-pointer hover:shadow-md transition-all"
                      onClick={() => {
                        setSelectedArticle(article)
                      }}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="size-5 text-muted-foreground" />
                            <div>
                              <CardTitle className="text-base">{article.title}</CardTitle>
                              <CardDescription className="text-xs">
                                {new Date(article.created_at).toLocaleDateString()}
                              </CardDescription>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {article.concepts.length} concepts
                          </Badge>
                        </div>
                      </CardHeader>
                    </Card>
                  ))
                )}
              </div>
            </>
          )}
        </TabsContent>

        {/* Concepts Tab */}
        <TabsContent value="concepts" className="space-y-4">
          {!selectedKB ? (
            <div className="text-center text-muted-foreground py-20">
              <Brain className="size-16 mx-auto mb-4" />
              <p>Select a knowledge base to view concepts</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from(new Set(articles.flatMap((a) => a.concepts))).map((concept) => (
                <Card key={concept} className="p-4 hover:shadow-md transition-all cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Brain className="size-4 text-primary" />
                    <span className="font-medium text-sm">{concept}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Health Tab */}
        <TabsContent value="health" className="space-y-4">
          {!selectedKB ? (
            <div className="text-center text-muted-foreground py-20">
              <CheckCircle className="size-16 mx-auto mb-4" />
              <p>Select a knowledge base to view health status</p>
            </div>
          ) : healthResults ? (
            <Card>
              <CardHeader>
                <CardTitle>Health Check Results</CardTitle>
                <CardDescription>{selectedKB.name}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge variant={healthResults.health_status === 'healthy' ? 'default' : 'destructive'}>
                      {healthResults.health_status}
                    </Badge>
                  </div>
                  {healthResults.issues && healthResults.issues.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Issues Found</h4>
                      <ul className="space-y-1">
                        {healthResults.issues.map((issue: string, index: number) => (
                          <li key={index} className="text-sm text-muted-foreground">
                            • {issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {healthResults.recommendations && healthResults.recommendations.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Recommendations</h4>
                      <ul className="space-y-1">
                        {healthResults.recommendations.map((rec: string, index: number) => (
                          <li key={index} className="text-sm text-muted-foreground">
                            • {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center">
              <Button
                onClick={() => {
                  void handleHealthCheck(selectedKB.id)
                }}
              >
                Run Health Check
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Article Detail Dialog */}
      {selectedArticle && (
        <Dialog
          open={!!selectedArticle}
          onOpenChange={() => {
            setSelectedArticle(null)
          }}
        >
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>{selectedArticle.title}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-full max-h-[60vh]">
              <div className="prose prose-sm dark:prose-invert p-4">{selectedArticle.content}</div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
