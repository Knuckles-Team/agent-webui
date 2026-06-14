import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import {
  FileIcon,
  FileText,
  Download,
  Eye,
  Upload,
  Plus,
  Save,
  Pencil,
  X,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Metadata about a workspace file.
 *
 * The backend `GET /api/enhanced/files` endpoint returns dict records with
 * `name`, `size`, `modified_iso`, and `is_dir`. Older deployments that only
 * return `list[str]` are still supported by the normalizer for graceful
 * upgrades.
 */
interface FileEntry {
  name: string
  size?: number
  modified?: string
  isDir?: boolean
}

/**
 * Error payload shape for `FastAPI` HTTP errors.
 */
interface ErrorResponse {
  detail?: string
}

/**
 * The backend restricts `PUT /api/enhanced/files/{filename}` to `.md` and
 * `.json` files. We enforce the same restriction client-side so the user
 * gets a useful error before round-tripping.
 */
const EDITABLE_EXTENSIONS = ['.md', '.json'] as const

function isEditable(filename: string): boolean {
  return EDITABLE_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext))
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

/**
 * Normalize the backend response into `FileEntry` objects.
 *
 * The current backend returns dicts with `name`, `size`, `modified_iso`,
 * and `is_dir`. Older deployments that return `list[str]` are still
 * accepted so the UI keeps working during partial upgrades. The legacy
 * `modified` key (without the `_iso` suffix) is also honored for
 * deployments that used the unspec'd earlier shape.
 */
function normalizeFiles(raw: unknown): FileEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): FileEntry | null => {
      if (typeof item === 'string') {
        return { name: item }
      }
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>
        const name = typeof rec.name === 'string' ? rec.name : typeof rec.filename === 'string' ? rec.filename : null
        if (!name) return null
        const modified =
          typeof rec.modified_iso === 'string'
            ? rec.modified_iso
            : typeof rec.modified === 'string'
              ? rec.modified
              : undefined
        return {
          name,
          size: typeof rec.size === 'number' ? rec.size : undefined,
          modified,
          isDir: typeof rec.is_dir === 'boolean' ? rec.is_dir : undefined,
        }
      }
      return null
    })
    .filter((f): f is FileEntry => f !== null)
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ErrorResponse
    if (typeof body.detail === 'string') return body.detail
  } catch {
    // ignore — response wasn't JSON
  }
  return fallback
}

export default function FilesView() {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [previewFile, setPreviewFile] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<string>('')
  const [isEditing, setIsEditing] = useState(false)
  const [editBuffer, setEditBuffer] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isNewFileOpen, setIsNewFileOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFileContent, setNewFileContent] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void fetchFiles()
  }, [])

  const fetchFiles = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/enhanced/files')
      if (!res.ok) {
        toast.error(await extractErrorMessage(res, 'Failed to load files'))
        return
      }
      const data = (await res.json()) as unknown
      setFiles(normalizeFiles(data))
    } catch (_err) {
      toast.error('Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  const handlePreview = async (filename: string) => {
    try {
      const res = await fetch(`/api/enhanced/files/${filename}`)
      if (!res.ok) {
        toast.error(await extractErrorMessage(res, 'Failed to load file preview'))
        return
      }
      const data = (await res.json()) as { content?: string }
      setPreviewFile(filename)
      setPreviewContent(data.content ?? '')
      setEditBuffer(data.content ?? '')
      setIsEditing(false)
    } catch (_err) {
      toast.error('Failed to load file preview')
    }
  }

  const handleDownload = (filename: string) => {
    window.open(`/api/enhanced/download/${encodeURIComponent(filename)}`, '_blank')
  }

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const formData = new FormData()
    formData.append('file', files[0])

    try {
      setUploading(true)
      const res = await fetch('/api/enhanced/upload', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        toast.error(await extractErrorMessage(res, 'Failed to upload file'))
        return
      }
      const data = (await res.json()) as { filename?: string }
      toast.success(`Uploaded ${data.filename ?? files[0].name}`)
      void fetchFiles()
    } catch (_err) {
      toast.error('Failed to upload file')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const saveFileContent = async (filename: string, content: string): Promise<boolean> => {
    if (!isEditable(filename)) {
      toast.error('Only .md and .json files can be saved via the editor')
      return false
    }
    try {
      setSaving(true)
      const res = await fetch(`/api/enhanced/files/${filename}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        toast.error(await extractErrorMessage(res, 'Failed to save file'))
        return false
      }
      toast.success(`Saved ${filename}`)
      return true
    } catch (_err) {
      toast.error('Failed to save file')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!previewFile) return
    const ok = await saveFileContent(previewFile, editBuffer)
    if (ok) {
      setPreviewContent(editBuffer)
      setIsEditing(false)
      void fetchFiles()
    }
  }

  const handleCreateFile = async () => {
    const trimmedName = newFileName.trim()
    if (!trimmedName) {
      toast.error('Filename is required')
      return
    }
    if (!isEditable(trimmedName)) {
      toast.error('New files must end in .md or .json')
      return
    }
    const ok = await saveFileContent(trimmedName, newFileContent)
    if (ok) {
      setIsNewFileOpen(false)
      setNewFileName('')
      setNewFileContent('')
      void fetchFiles()
      void handlePreview(trimmedName)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteCandidate) return
    const filename = deleteCandidate
    try {
      setDeleting(true)
      const res = await fetch(`/api/enhanced/files/${filename}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error(await extractErrorMessage(res, 'Failed to delete file'))
        return
      }
      const body = (await res.json()) as { status?: string; detail?: string }
      if (body.status !== 'ok') {
        toast.error(body.detail ?? 'Failed to delete file')
        return
      }
      setFiles((prev) => prev.filter((f) => f.name !== filename))
      if (previewFile === filename) {
        setPreviewFile(null)
        setPreviewContent('')
        setEditBuffer('')
        setIsEditing(false)
      }
      toast.success(`Deleted ${filename}`)
      setDeleteCandidate(null)
    } catch (_err) {
      toast.error('Failed to delete file')
    } finally {
      setDeleting(false)
    }
  }

  const filteredFiles = files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[calc(100vh-12rem)]">
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          void handleUpload(e)
        }}
      />

      {/* File list */}
      <Card className="flex flex-col">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>Workspace Files</CardTitle>
              <CardDescription>Managed files in your agent workspace</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void fetchFiles()
                }}
                disabled={loading}
                title="Refresh"
              >
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              </Button>
              <Button variant="outline" size="sm" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
                <Upload className="size-4 mr-1" />
                {uploading ? 'Uploading…' : 'Upload'}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setIsNewFileOpen(true)
                }}
              >
                <Plus className="size-4 mr-1" />
                New File
              </Button>
            </div>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          <ScrollArea className="h-full pr-4">
            {loading ? (
              <p className="text-muted-foreground text-sm">Loading files...</p>
            ) : filteredFiles.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {searchQuery ? 'No files match your search.' : 'No files found.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left font-medium py-2 pr-2">Name</th>
                    <th className="text-left font-medium py-2 pr-2 hidden sm:table-cell">Size</th>
                    <th className="text-left font-medium py-2 pr-2 hidden md:table-cell">Modified</th>
                    <th className="text-right font-medium py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFiles.map((file) => (
                    <tr
                      key={file.name}
                      className={cn(
                        'border-b border-border/50 hover:bg-accent/50 transition-colors group',
                        previewFile === file.name && 'bg-accent',
                      )}
                    >
                      <td className="py-2 pr-2">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left hover:text-primary transition-colors w-full"
                          onClick={() => {
                            void handlePreview(file.name)
                          }}
                        >
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{file.name}</span>
                        </button>
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground text-xs hidden sm:table-cell">
                        {formatBytes(file.size)}
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground text-xs hidden md:table-cell">
                        {formatDate(file.modified)}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => {
                              void handlePreview(file.name)
                            }}
                            title="Preview"
                          >
                            <Eye className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => {
                              handleDownload(file.name)
                            }}
                            title="Download"
                          >
                            <Download className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              setDeleteCandidate(file.name)
                            }}
                            disabled={file.isDir}
                            title={file.isDir ? 'Cannot delete directories' : 'Delete'}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Preview / editor panel */}
      <Card className="flex flex-col">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate">{previewFile ?? 'Preview'}</CardTitle>
              <CardDescription>
                {previewFile
                  ? isEditing
                    ? 'Editing file contents'
                    : 'Read-only preview'
                  : 'Select a file to preview'}
              </CardDescription>
            </div>
            {previewFile && (
              <div className="flex gap-2 shrink-0">
                {isEditing ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditing(false)
                        setEditBuffer(previewContent)
                      }}
                      disabled={saving}
                    >
                      <X className="size-4 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        void handleSaveEdit()
                      }}
                      disabled={saving}
                    >
                      <Save className="size-4 mr-1" />
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                  </>
                ) : (
                  <>
                    {isEditable(previewFile) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsEditing(true)
                        }}
                      >
                        <Pencil className="size-4 mr-1" />
                        Edit
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        handleDownload(previewFile)
                      }}
                    >
                      <Download className="size-4 mr-1" />
                      Download
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          {previewFile ? (
            isEditing ? (
              <Textarea
                value={editBuffer}
                onChange={(e) => {
                  setEditBuffer(e.target.value)
                }}
                className="h-full min-h-0 font-mono text-xs resize-none"
                placeholder="File contents..."
              />
            ) : (
              <ScrollArea className="h-full bg-muted/30 rounded-md p-4">
                <pre className="text-xs whitespace-pre-wrap font-mono">{previewContent}</pre>
              </ScrollArea>
            )
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

      {/* New file dialog */}
      <Dialog open={isNewFileOpen} onOpenChange={setIsNewFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
            <DialogDescription>
              Create a new workspace file. Only <code>.md</code> and <code>.json</code> files are supported by the
              backend writer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="new-file-name" className="text-sm font-medium">
                Filename
              </label>
              <Input
                id="new-file-name"
                value={newFileName}
                onChange={(e) => {
                  setNewFileName(e.target.value)
                }}
                placeholder="notes.md"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="new-file-content" className="text-sm font-medium">
                Content
              </label>
              <Textarea
                id="new-file-content"
                value={newFileContent}
                onChange={(e) => {
                  setNewFileContent(e.target.value)
                }}
                placeholder="File contents..."
                className="mt-1 font-mono text-xs"
                rows={10}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsNewFileOpen(false)
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleCreateFile()
              }}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-confirmation dialog */}
      <Dialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteCandidate(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
            <DialogDescription>
              This will permanently remove <code className="font-mono">{deleteCandidate}</code> from the workspace.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteCandidate(null)
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmDelete()
              }}
              disabled={deleting}
            >
              <Trash2 className="size-4 mr-1" />
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
