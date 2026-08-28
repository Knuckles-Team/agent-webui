/**
 * @file ImportExportModal.tsx
 * @description Import/Export modal for hosted ontologies (Ontology-Playground
 * coverage row #23). Import: drag-drop a `.ttl`/RDF file or paste raw turtle
 * text, then `POST /api/ontology/load` (`api.loadOntology`). Export: pick a
 * hosted ontology (via the catalogue route) or type an IRI, then
 * `GET /api/ontology/export` (`api.exportOntology`) and download the
 * returned turtle client-side. Thin by design (transport + render), the same
 * pattern as `SparqlView.tsx`'s SPARQL/SHACL tabs — no new business logic,
 * both actions dispatch through the existing `graph_ontology` core.
 */

import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, Loader2, Upload, XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, ApiError, type OntologyCatalogueEntry, type OntologyLoadResult } from '@/lib/api'

type Mode = 'import' | 'export'

export interface ImportExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful import so a consuming view can refresh. */
  onImported?: () => void
}

function downloadTurtle(iri: string, version: string, turtle: string) {
  const blob = new Blob([turtle], { type: 'text/turtle' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeName = iri.replace(/[^a-zA-Z0-9._-]+/g, '_')
  a.href = url
  a.download = `${safeName}${version ? `-${version}` : ''}.ttl`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** All import-tab state + handlers, kept out of the modal's own render body. */
function useImportForm(onImported?: () => void) {
  const [source, setSource] = useState('')
  const [category, setCategory] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<OntologyLoadResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const readFileText = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text === 'string') setSource(text)
    }
    reader.readAsText(file)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) readFileText(e.dataTransfer.files[0])
  }

  const onBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) readFileText(files[0])
    e.target.value = ''
  }

  const runImport = async () => {
    const trimmed = source.trim()
    if (!trimmed) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const result = await api.loadOntology({
        source: trimmed,
        source_type: 'text',
        category: category.trim(),
        tags,
      })
      setImportResult(result)
      if (result.status === 'ok') onImported?.()
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  return {
    source,
    setSource,
    category,
    setCategory,
    tagsInput,
    setTagsInput,
    dragOver,
    setDragOver,
    importing,
    importError,
    importResult,
    fileInputRef,
    onDrop,
    onBrowse,
    runImport,
  }
}

type ImportFormState = ReturnType<typeof useImportForm>

/** All export-tab state + handlers, kept out of the modal's own render body. */
function useExportForm(open: boolean, mode: Mode) {
  const [catalogue, setCatalogue] = useState<OntologyCatalogueEntry[]>([])
  const [exportIri, setExportIri] = useState('')
  const [exportVersion, setExportVersion] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || mode !== 'export') return
    api
      .getOntologyCatalogue()
      .then((res) => {
        setCatalogue(res.ontologies)
      })
      .catch(() => {
        setCatalogue([])
      })
  }, [open, mode])

  const runExport = async () => {
    const iri = exportIri.trim()
    if (!iri) return
    setExporting(true)
    setExportError(null)
    try {
      const result = await api.exportOntology(iri, exportVersion.trim())
      downloadTurtle(result.ontology.iri, result.ontology.version, result.ontology.turtle)
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  return {
    catalogue,
    exportIri,
    setExportIri,
    exportVersion,
    setExportVersion,
    exporting,
    exportError,
    runExport,
  }
}

type ExportFormState = ReturnType<typeof useExportForm>

function DropZone({ form }: { form: ImportFormState }) {
  return (
    <>
      <input
        ref={form.fileInputRef}
        type="file"
        accept=".ttl,.owl,.rdf,.n3,.nt,text/turtle"
        className="hidden"
        onChange={form.onBrowse}
      />
      <div
        role="button"
        tabIndex={0}
        data-testid="drop-zone"
        onClick={() => form.fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') form.fileInputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          form.setDragOver(true)
        }}
        onDragLeave={() => {
          form.setDragOver(false)
        }}
        onDrop={form.onDrop}
        className={`flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed p-4 text-center text-xs cursor-pointer transition-colors ${
          form.dragOver ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-border'
        }`}
      >
        <Upload className="size-5 text-muted-foreground" />
        <span>Drop a .ttl/RDF file here, or click to browse</span>
      </div>
    </>
  )
}

function ImportSuccessMessage({ result }: { result: OntologyLoadResult }) {
  return (
    <p className="text-xs text-emerald-500 flex items-center gap-1">
      <CheckCircle2 className="size-3.5" />
      Loaded {result.ontology?.iri} (v{result.ontology?.version}) — {result.ontology?.n_classes ?? 0} classes,{' '}
      {result.ontology?.n_properties ?? 0} properties.
    </p>
  )
}

function ImportRejectedList({ errors }: { errors: string[] }) {
  return (
    <div className="text-xs text-destructive space-y-0.5">
      <p className="flex items-center gap-1">
        <XCircle className="size-3.5" /> Rejected:
      </p>
      <ul className="list-disc list-inside">
        {errors.map((e, i) => (
          <li key={`err-${String(i)}`}>{e}</li>
        ))}
      </ul>
    </div>
  )
}

function ImportFeedback({ error, result }: { error: string | null; result: OntologyLoadResult | null }) {
  return (
    <>
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <XCircle className="size-3.5" /> {error}
        </p>
      )}
      {result?.status === 'ok' && <ImportSuccessMessage result={result} />}
      {result && result.status !== 'ok' && <ImportRejectedList errors={result.errors ?? []} />}
    </>
  )
}

function ImportPanel({ form }: { form: ImportFormState }) {
  return (
    <div className="space-y-3" data-testid="import-panel">
      <DropZone form={form} />
      <Textarea
        aria-label="Ontology turtle/RDF text"
        value={form.source}
        onChange={(e) => {
          form.setSource(e.target.value)
        }}
        placeholder="...or paste raw turtle/RDF text directly"
        rows={6}
        className="font-mono text-xs"
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Category"
          placeholder="Category (optional)"
          value={form.category}
          onChange={(e) => {
            form.setCategory(e.target.value)
          }}
        />
        <Input
          aria-label="Tags"
          placeholder="Tags, comma-separated (optional)"
          value={form.tagsInput}
          onChange={(e) => {
            form.setTagsInput(e.target.value)
          }}
        />
      </div>
      <ImportFeedback error={form.importError} result={form.importResult} />
      <DialogFooter>
        <Button
          onClick={() => {
            void form.runImport()
          }}
          disabled={form.importing || !form.source.trim()}
        >
          {form.importing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />}
          Load
        </Button>
      </DialogFooter>
    </div>
  )
}

function ExportPanel({ form }: { form: ExportFormState }) {
  return (
    <div className="space-y-3" data-testid="export-panel">
      {form.catalogue.length > 0 ? (
        <Select
          value={form.exportIri}
          onValueChange={(v) => {
            form.setExportIri(v)
            const entry = form.catalogue.find((c) => c.iri === v)
            if (entry) form.setExportVersion(entry.version)
          }}
        >
          <SelectTrigger className="w-full text-xs" aria-label="Hosted ontology">
            <SelectValue placeholder="Pick a hosted ontology..." />
          </SelectTrigger>
          <SelectContent>
            {form.catalogue.map((c) => (
              <SelectItem key={`${c.iri}@${c.version}`} value={c.iri}>
                {c.iri} (v{c.version})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">No hosted ontologies found — enter an IRI directly.</p>
      )}
      <Input
        aria-label="Ontology IRI"
        placeholder="Ontology IRI"
        value={form.exportIri}
        onChange={(e) => {
          form.setExportIri(e.target.value)
        }}
      />
      <Input
        aria-label="Version (optional)"
        placeholder="Version (optional — newest if omitted)"
        value={form.exportVersion}
        onChange={(e) => {
          form.setExportVersion(e.target.value)
        }}
      />
      {form.exportError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <XCircle className="size-3.5" /> {form.exportError}
        </p>
      )}
      <DialogFooter>
        <Button
          onClick={() => {
            void form.runExport()
          }}
          disabled={form.exporting || !form.exportIri.trim()}
        >
          {form.exporting ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Download className="size-4 mr-2" />}
          Export
        </Button>
      </DialogFooter>
    </div>
  )
}

export function ImportExportModal({ open, onOpenChange, onImported }: ImportExportModalProps) {
  const [mode, setMode] = useState<Mode>('import')
  const importForm = useImportForm(onImported)
  const exportForm = useExportForm(open, mode)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import / Export Ontology</DialogTitle>
          <DialogDescription>
            Load a .ttl/RDF ontology into the running KG, or export a hosted one back out as turtle.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode)
          }}
        >
          <TabsList>
            <TabsTrigger value="import" className="gap-1">
              <Upload className="size-3" />
              Import
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-1">
              <Download className="size-3" />
              Export
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === 'import' ? <ImportPanel form={importForm} /> : <ExportPanel form={exportForm} />}
      </DialogContent>
    </Dialog>
  )
}
