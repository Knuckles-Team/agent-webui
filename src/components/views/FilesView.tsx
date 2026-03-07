import { useState, useEffect } from 'react'
import { FileIcon, FileText, Download, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

export default function FilesView() {
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [previewFile, setPreviewFile] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<string>('')

  useEffect(() => {
    void fetchFiles()
  }, [])

  const fetchFiles = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/enhanced/files')
      const data = (await res.json()) as string[]
      setFiles(data)
    } catch (_err) {
      toast.error('Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  const handlePreview = async (filename: string) => {
    try {
      const res = await fetch(`/api/enhanced/files/${filename}`)
      const data = (await res.json()) as { content: string }
      setPreviewFile(filename)
      setPreviewContent(data.content)
    } catch (_err) {
      toast.error('Failed to load file preview')
    }
  }

  const handleDownload = (filename: string) => {
    window.open(`/api/enhanced/download/${filename}`, '_blank')
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[calc(100vh-12rem)]">
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle>Workspace Files</CardTitle>
          <CardDescription>Managed files in your agent workspace</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          <ScrollArea className="h-full pr-4">
            {loading ? (
              <p>Loading files...</p>
            ) : files.length === 0 ? (
              <p className="text-muted-foreground">No files found.</p>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div key={file} className="flex items-center justify-between p-2 rounded-md hover:bg-accent group">
                    <div
                      className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1 py-1"
                      onClick={() => {
                        void handlePreview(file)
                      }}
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium hover:text-primary transition-colors">{file}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          void handlePreview(file)
                        }}
                      >
                        <Eye className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          handleDownload(file)
                        }}
                      >
                        <Download className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>{previewFile ? `Viewing ${previewFile}` : 'Select a file to preview'}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          {previewFile ? (
            <ScrollArea className="h-full bg-muted/30 rounded-md p-4">
              <pre className="text-xs whitespace-pre-wrap font-mono">{previewContent}</pre>
            </ScrollArea>
          ) : (
            <div className="h-full flex items-center justify-center border-2 border-dashed rounded-md border-muted">
              <div className="text-center">
                <FileIcon className="size-10 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No file selected</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
