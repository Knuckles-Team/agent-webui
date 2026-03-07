import { useState, useEffect } from 'react'
import { Save, RefreshCw, FileText, Layout, Columns, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Response } from '@/components/ai-elements/response'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export default function ConfigurationView() {
  const [configFiles, setConfigFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split')

  useEffect(() => {
    void fetchConfigFiles()
  }, [])

  useEffect(() => {
    if (selectedFile) {
      void fetchFileContent(selectedFile)
    }
  }, [selectedFile])

  const fetchConfigFiles = async () => {
    try {
      const res = await fetch('/api/enhanced/config-files')
      const data = (await res.json()) as string[]
      setConfigFiles(data)
      if (data.length > 0 && !selectedFile) {
        setSelectedFile(data[0])
      }
    } catch (_err) {
      toast.error('Failed to load configuration files')
    }
  }

  const fetchFileContent = async (filename: string) => {
    try {
      setLoading(true)
      const res = await fetch(`/api/enhanced/files/${filename}`)
      const data = (await res.json()) as { content: string }
      setContent(data.content)
    } catch (_err) {
      toast.error(`Failed to load ${filename}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const res = await fetch(`/api/enhanced/files/${selectedFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (res.ok) {
        toast.success(`${selectedFile} saved successfully`)
      }
    } catch (_err) {
      toast.error(`Failed to save ${selectedFile}`)
    } finally {
      setSaving(false)
    }
  }

  const handleReload = async () => {
    try {
      const res = await fetch('/api/enhanced/reload', { method: 'POST' })
      if (res.ok) {
        toast.success('Agent reloaded with new configuration')
      }
    } catch (_err) {
      toast.error('Reload failed')
    }
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 h-auto md:h-[calc(100vh-12rem)]">
      <div className="w-full md:w-64 flex flex-col gap-2 shrink-0">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Core Files</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-col gap-1">
          {configFiles.map((file) => (
            <Button
              key={file}
              variant={selectedFile === file ? 'secondary' : 'ghost'}
              className="justify-start gap-2 h-9 px-3"
              onClick={() => {
                setSelectedFile(file)
              }}
            >
              <FileText className="size-4 shrink-0" />
              <span className="truncate">{file}</span>
            </Button>
          ))}
        </div>

        <div className="mt-4 md:mt-auto pt-4 border-t">
          <Button
            variant="outline"
            className="w-full gap-2 text-primary border-primary/20 hover:bg-primary/5"
            onClick={() => {
              void handleReload()
            }}
          >
            <RefreshCw className="size-4" />
            Reload Agent
          </Button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden border-border/40 shadow-sm transition-all min-h-[500px] md:min-h-0">
        <CardHeader className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-3 border-b bg-muted/5">
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            <div className="text-center sm:text-left">
              <CardTitle className="text-lg">Editing {selectedFile}</CardTitle>
              <CardDescription className="hidden sm:block">Modify the agent's core identity and rules</CardDescription>
            </div>

            <Tabs
              value={viewMode}
              onValueChange={(v: string) => {
                setViewMode(v as 'edit' | 'preview' | 'split')
              }}
              className="ml-0 sm:ml-4"
            >
              <TabsList className="h-8 bg-muted/50 p-0.5">
                <TabsTrigger
                  value="edit"
                  className="h-7 gap-1 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <Layout className="size-3" /> Edit
                </TabsTrigger>
                <TabsTrigger
                  value="split"
                  className="h-7 gap-1 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm hidden md:flex"
                >
                  <Columns className="size-3" /> Split
                </TabsTrigger>
                <TabsTrigger
                  value="preview"
                  className="h-7 gap-1 px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <Eye className="size-3" /> Preview
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <Button
            onClick={() => {
              void handleSave()
            }}
            disabled={saving || loading || !selectedFile}
            className="w-full sm:w-auto gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
          >
            <Save className="size-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden bg-background">
          {loading ? (
            <div className="h-full flex items-center justify-center min-h-[300px]">
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="size-8 animate-spin text-primary/40" />
                <p className="text-muted-foreground text-sm font-medium animate-pulse">Fetching content...</p>
              </div>
            </div>
          ) : !selectedFile ? (
            <div className="h-full flex items-center justify-center text-muted-foreground min-h-[300px]">
              Select a file to start editing
            </div>
          ) : (
            <div className="flex flex-col h-full divide-y md:divide-y-0 md:flex-row md:divide-x divide-border/60">
              {(viewMode === 'edit' || viewMode === 'split') && (
                <textarea
                  className={cn(
                    'flex-1 p-6 bg-muted/10 font-mono text-sm resize-none focus:outline-none transition-colors focus:bg-background h-full min-h-[300px]',
                    viewMode === 'split' ? 'md:w-1/2' : 'w-full',
                  )}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value)
                  }}
                  spellCheck={false}
                  placeholder="Start writing markdown..."
                />
              )}
              {(viewMode === 'preview' || viewMode === 'split') && (
                <ScrollArea
                  className={cn('flex-1 min-w-0 h-full min-h-[300px]', viewMode === 'split' ? 'md:w-1/2' : 'w-full')}
                >
                  <div className="p-8 prose prose-sm dark:prose-invert max-w-none">
                    <Response>
                      {selectedFile.endsWith('.json')
                        ? `\`\`\`json\n${content}\n\`\`\``
                        : content || '*No content to preview*'}
                    </Response>
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
