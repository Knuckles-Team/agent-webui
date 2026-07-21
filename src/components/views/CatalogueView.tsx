/**
 * @file CatalogueView.tsx
 * @description Thin catalogue/gallery list view over the hosted-ontology
 * registry (Ontology-Playground coverage row #4 — the optional frontend
 * half; the backend `GET /api/ontology/catalogue` route is the required
 * half). Fetches `api.getOntologyCatalogue()` with search/category/source/tag
 * filters and renders each hosted ontology as a card (iri/version/counts/
 * category/tags). Thin by design, the same fetch-on-mount + refetch-on-filter
 * pattern as `SchemaView.tsx`/`SparqlView.tsx` — no new business logic, the
 * filtering happens server-side via the existing `graph_ontology(action='list')`
 * core.
 */

import { useEffect, useState } from 'react'
import { LibraryBig, Loader2, RefreshCw, Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { api, type OntologyCatalogueEntry } from '@/lib/api'
import { ImportExportModal } from '@/components/ontology/ImportExportModal'

export default function CatalogueView() {
  const [entries, setEntries] = useState<OntologyCatalogueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.getOntologyCatalogue({ search, category, tag })
      setEntries(res.ontologies)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Intentionally run once on mount only — `load()` reads the filter state
    // directly at call time, and re-running on every filter keystroke would
    // fight the explicit "Apply filters" button / Enter-to-search UX below.
    void load()
  }, [])

  return (
    <div className="space-y-6" data-testid="catalogue-view">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LibraryBig className="size-6 text-emerald-400" />
            Ontology Catalogue
          </h1>
          <p className="text-sm text-muted-foreground">
            Every ontology hosted in the running KG — browse, search, and filter by category/tag, then import a new one
            or export an existing one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setModalOpen(true)
            }}
          >
            <Upload className="size-4 mr-1" />
            Import / Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void load()
            }}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Input
          aria-label="Search"
          placeholder="Search iri/version/source..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load()
          }}
        />
        <Input
          aria-label="Category"
          placeholder="Category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load()
          }}
        />
        <Input
          aria-label="Tag"
          placeholder="Tag"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load()
          }}
        />
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void load()
        }}
      >
        Apply filters
      </Button>

      {loading && entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-8 animate-spin mb-3" />
          <p className="text-sm">Loading catalogue...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <LibraryBig className="size-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm">No hosted ontologies match these filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <Card key={`${entry.iri}@${entry.version}`} className="border-border/40 bg-card/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold truncate" title={entry.iri}>
                  {entry.iri}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    v{entry.version}
                  </Badge>
                  {entry.active !== undefined && (
                    <Badge variant={entry.active ? 'secondary' : 'outline'} className="text-[10px]">
                      {entry.active ? 'active' : 'inactive'}
                    </Badge>
                  )}
                  {entry.category && (
                    <Badge variant="outline" className="text-[10px]">
                      {entry.category}
                    </Badge>
                  )}
                  {(entry.tags ?? []).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      #{t}
                    </Badge>
                  ))}
                </div>
                <p className="text-muted-foreground">
                  {entry.n_classes ?? 0} classes · {entry.n_properties ?? 0} properties · {entry.n_axioms ?? 0} axioms
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ImportExportModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onImported={() => {
          void load()
        }}
      />
    </div>
  )
}
