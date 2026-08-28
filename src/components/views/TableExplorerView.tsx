/**
 * @file TableExplorerView.tsx
 * @description The four-pane SQL/catalog explorer
 * (`plans/semantic-indexing/DESIGN-embedding-bindings.md` §4): a schema tree
 * (pane 1) drives a selected relation, which feeds column detail (pane 2),
 * vectorization control (pane 3), and a "try it" vector-vs-BM25-vs-RRF query box
 * (pane 4) via tabs.
 *
 * Wired to real backend routes where they exist:
 *  - Pane 1/structural pane 2 -> `POST /graph/sql-schema` (no caller SQL; see
 *    `table-explorer/catalog-api.ts`'s module doc).
 *  - Statistical pane 2 + pane 4 -> `POST /graph/table {action:'query'}` (the
 *    engine's read-only SQL surface; see the lane report for the authz caveat
 *    on that route, which is why this whole view is nav-gated at `minRole:
 *    'admin'` in `nav-registry.ts`, matching `knowledge.cypher`'s precedent for
 *    a comparably raw execution surface).
 *  - Pane 3 -> a plausible-but-not-yet-existing `POST /graph/embedding-binding`
 *    route; degrades honestly to "capability not yet activated" (see
 *    `table-explorer/VectorizationPanel.tsx`'s module doc for why that route
 *    does not exist yet).
 *
 * Split into `src/components/table-explorer/` so each pane stays independently
 * testable and under the cyclomatic/cognitive caps — see the lane report for the
 * per-file complexity numbers.
 */
import { useState } from 'react'
import { Database, Table2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import SchemaTree from '@/components/table-explorer/SchemaTree'
import ColumnDetailPanel from '@/components/table-explorer/ColumnDetailPanel'
import VectorizationPanel from '@/components/table-explorer/VectorizationPanel'
import TryItPanel from '@/components/table-explorer/TryItPanel'
import type { CatalogRelation, RelationRef } from '@/components/table-explorer/types'

type DetailTab = 'columns' | 'vectorization' | 'try-it'

function relationRef(relation: CatalogRelation): RelationRef {
  return { schema: relation.schema, table: relation.name }
}

function DetailPanes({ relation }: { relation: CatalogRelation }) {
  const [tab, setTab] = useState<DetailTab>('columns')
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null)

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value as DetailTab)
      }}
    >
      <TabsList>
        <TabsTrigger value="columns">Columns</TabsTrigger>
        <TabsTrigger value="vectorization">Vectorization</TabsTrigger>
        <TabsTrigger value="try-it" disabled={!selectedColumn}>
          Try it
        </TabsTrigger>
      </TabsList>
      <TabsContent value="columns" className="h-[32rem]">
        <ColumnDetailPanel relation={relation} selectedColumn={selectedColumn} onSelectColumn={setSelectedColumn} />
      </TabsContent>
      <TabsContent value="vectorization" className="h-[32rem]">
        <VectorizationPanel relation={relation} />
      </TabsContent>
      <TabsContent value="try-it" className="h-[32rem]">
        {selectedColumn ? (
          <TryItPanel relation={relation} column={selectedColumn} />
        ) : (
          <p className="text-sm text-muted-foreground p-4">Select a column under "Columns" first.</p>
        )}
      </TabsContent>
    </Tabs>
  )
}

export default function TableExplorerView() {
  const [selected, setSelected] = useState<CatalogRelation | null>(null)

  return (
    <div className="space-y-6" data-testid="table-explorer">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="size-6" />
          Table Explorer
        </h1>
        <p className="text-muted-foreground text-sm">
          Browse the SQL catalog, inspect column statistics, manage per-column vectorization, and compare vector vs.
          BM25 search — over the engine's read-only SQL surface.
        </p>
      </div>
      <div className="grid grid-cols-[20rem_1fr] gap-4 items-start">
        <div className="h-[40rem]">
          <SchemaTree selected={selected ? relationRef(selected) : null} onSelectRelation={setSelected} />
        </div>
        {selected ? (
          <DetailPanes relation={selected} />
        ) : (
          <div className="h-[32rem] flex items-center justify-center text-sm text-muted-foreground border rounded-md">
            <span className="flex items-center gap-2">
              <Table2 className="size-4" />
              Select a table or view from the catalog to see its columns.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
