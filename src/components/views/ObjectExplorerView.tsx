/**
 * @file ObjectExplorerView.tsx
 * @description Palantir-style Object Explorer over the ontology object-set API.
 *
 * Faceted/full-text search + property filters against the object-set API, a
 * results TABLE, PIVOT across a link type, SEARCH-AROUND (related objects N
 * hops), bulk Actions on a row selection, and save/share of the current
 * object set. All data is fetched live via the `api` singleton with
 * @tanstack/react-query — no local fixtures, no stubs.
 *
 * Backend contract (owned by the backend-bridge workstream), all under the
 * router prefix `/api/enhanced`:
 *   POST /ontology/object-set/search        -> ObjectSetResult
 *   POST /ontology/object-set/search-around -> ObjectSetResult
 *   POST /ontology/object-set/pivot         -> ObjectSetResult
 *   POST /ontology/object-set/aggregate     -> AggregateResult
 *   POST /ontology/object-set/action        -> ActionResult
 *   POST /ontology/object-set/save          -> SavedObjectSet
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Filter, GitFork, Network, Save, Play, Loader2, Boxes, Plus, X, Sigma } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/** A single ontology object returned by an object-set query. */
export interface OntologyObject {
  id: string
  type: string
  title?: string
  properties?: Record<string, unknown>
}

/** Result envelope shared by search / search-around / pivot routes. */
export interface ObjectSetResult {
  objects: OntologyObject[]
  total: number
  /** Property keys present across the result set, used to build table columns. */
  columns?: string[]
}

/** One aggregation bucket (group-by) returned by the aggregate route. */
export interface AggregateBucket {
  key: string
  count: number
}

/** A property filter applied to the object-set search. */
export interface PropertyFilter {
  property: string
  op: 'eq' | 'neq' | 'contains' | 'gt' | 'lt'
  value: string
}

/** Clean selection contract: clicking a row opens that object. */
export interface ObjectExplorerViewProps {
  /** Called when a row is opened. Defaults to navigating to /object/:id. */
  onOpenObject?: (id: string) => void
}

const FILTER_OPS: { value: PropertyFilter['op']; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
]

/** A registered ontology action surfaced for the bulk-action menu. */
export interface OntologyActionSummary {
  name: string
  verb: string
  description: string
  produces_effect: string
  required_capability: string
  acts_on: string[]
}

/** A saved object set row returned by the list endpoint. */
export interface SavedObjectSetSummary {
  id: string
  name: string
  count: number
  kind?: string
  shared?: boolean
}

/**
 * Only mutation/external-effect actions are offered as bulk actions — a `read`
 * action (e.g. kg.search) is not a writeback, so it would be a no-op selection.
 */
export function isBulkApplicableAction(action: OntologyActionSummary): boolean {
  return action.produces_effect === 'mutation' || action.produces_effect === 'external'
}

export function defaultOpenObject(id: string): void {
  window.history.pushState({}, '', `/object/${encodeURIComponent(id)}`)
  window.dispatchEvent(new Event('history-state-changed'))
}

/** Derive the union of property columns across a result set. */
export function deriveColumns(result: ObjectSetResult | undefined): string[] {
  if (!result) return []
  if (result.columns && result.columns.length > 0) return result.columns
  const keys = new Set<string>()
  for (const obj of result.objects) {
    for (const k of Object.keys(obj.properties ?? {})) keys.add(k)
  }
  return Array.from(keys)
}

/** Render an arbitrary property value as a table cell string. */
export function renderCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  // Objects/symbols/functions serialize to JSON.
  return JSON.stringify(value)
}

function renderSavedSetsSelect({
  savedSets,
  onLoad,
}: {
  savedSets: SavedObjectSetSummary[]
  onLoad: (set: SavedObjectSetSummary) => void
}) {
  if (savedSets.length === 0) return null
  return (
    <Select
      value=""
      onValueChange={(id) => {
        const set = savedSets.find((s) => s.id === id)
        if (set) onLoad(set)
      }}
    >
      <SelectTrigger className="w-56" aria-label="Saved sets">
        <SelectValue placeholder={`Load saved set (${savedSets.length})`} />
      </SelectTrigger>
      <SelectContent>
        {savedSets.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
            {s.kind ? ` · ${s.kind}` : ''} ({s.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function renderExplorerHeader({
  savedSets,
  onLoadSavedSet,
  isSaving,
  onSave,
}: {
  savedSets: SavedObjectSetSummary[]
  onLoadSavedSet: (set: SavedObjectSetSummary) => void
  isSaving: boolean
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Boxes className="size-6" />
          Object Explorer
        </h1>
        <p className="text-muted-foreground text-sm">
          Faceted search, pivot and bulk actions across the ontology object set
        </p>
      </div>
      <div className="flex gap-2">
        {renderSavedSetsSelect({ savedSets, onLoad: onLoadSavedSet })}
        <Button variant="outline" disabled={isSaving} onClick={onSave}>
          {isSaving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
          Save Set
        </Button>
      </div>
    </div>
  )
}

interface SearchFacetsCardProps {
  query: string
  onQueryChange: (v: string) => void
  objectType: string
  onObjectTypeChange: (v: string) => void
  draftFilter: PropertyFilter
  onDraftFilterChange: (f: PropertyFilter) => void
  onAddFilter: () => void
  filters: PropertyFilter[]
  onRemoveFilter: (idx: number) => void
}

function renderActiveFilters({
  filters,
  onRemoveFilter,
}: {
  filters: PropertyFilter[]
  onRemoveFilter: (idx: number) => void
}) {
  if (filters.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((f, i) => (
        <Badge key={`${f.property}-${i}`} variant="secondary" className="gap-1">
          {f.property} {FILTER_OPS.find((o) => o.value === f.op)?.label} {f.value}
          <button
            type="button"
            aria-label={`Remove filter ${f.property}`}
            onClick={() => {
              onRemoveFilter(i)
            }}
            className="hover:text-destructive"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  )
}

function renderSearchFacetsCard(props: SearchFacetsCardProps) {
  const { query, onQueryChange, objectType, onObjectTypeChange, draftFilter, onDraftFilterChange, onAddFilter } =
    props
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="size-4" />
          Search
        </CardTitle>
        <CardDescription>Full-text query plus type facet and property filters</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              aria-label="Search objects"
              placeholder="Search objects..."
              className="pl-9"
              value={query}
              onChange={(e) => {
                onQueryChange(e.target.value)
              }}
            />
          </div>
          <Select value={objectType} onValueChange={onObjectTypeChange}>
            <SelectTrigger className="w-44" aria-label="Object type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="Document">Document</SelectItem>
              <SelectItem value="Concept">Concept</SelectItem>
              <SelectItem value="Repository">Repository</SelectItem>
              <SelectItem value="Function">Function</SelectItem>
              <SelectItem value="Person">Person</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Property filter builder */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <Input
            aria-label="Filter property"
            placeholder="property"
            className="w-40"
            value={draftFilter.property}
            onChange={(e) => {
              onDraftFilterChange({ ...draftFilter, property: e.target.value })
            }}
          />
          <Select
            value={draftFilter.op}
            onValueChange={(v) => {
              onDraftFilterChange({ ...draftFilter, op: v as PropertyFilter['op'] })
            }}
          >
            <SelectTrigger className="w-28" aria-label="Filter operator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPS.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Filter value"
            placeholder="value"
            className="w-40"
            value={draftFilter.value}
            onChange={(e) => {
              onDraftFilterChange({ ...draftFilter, value: e.target.value })
            }}
          />
          <Button variant="secondary" size="sm" onClick={onAddFilter}>
            <Plus className="size-4 mr-1" />
            Add filter
          </Button>
        </div>

        {renderActiveFilters({ filters: props.filters, onRemoveFilter: props.onRemoveFilter })}
      </CardContent>
    </Card>
  )
}

interface ResultsToolbarProps {
  linkType: string
  onLinkTypeChange: (v: string) => void
  hops: number
  onHopsChange: (n: number) => void
  hasSelection: boolean
  searchAroundPending: boolean
  onSearchAround: () => void
  bulkActions: OntologyActionSummary[]
  activeBulkAction: string
  onBulkActionChange: (v: string) => void
  runBulkActionPending: boolean
  selectedCount: number
  onRunBulkAction: () => void
}

function renderResultsToolbar(props: ResultsToolbarProps) {
  const {
    linkType,
    onLinkTypeChange,
    hops,
    onHopsChange,
    hasSelection,
    searchAroundPending,
    onSearchAround,
    bulkActions,
    activeBulkAction,
    onBulkActionChange,
    runBulkActionPending,
    selectedCount,
    onRunBulkAction,
  } = props
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={linkType} onValueChange={onLinkTypeChange}>
        <SelectTrigger className="w-44" aria-label="Link type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="relates_to">relates_to</SelectItem>
          <SelectItem value="implements">implements</SelectItem>
          <SelectItem value="references">references</SelectItem>
          <SelectItem value="depends_on">depends_on</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={String(hops)}
        onValueChange={(v) => {
          onHopsChange(Number(v))
        }}
      >
        <SelectTrigger className="w-28" aria-label="Hops">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">1 hop</SelectItem>
          <SelectItem value="2">2 hops</SelectItem>
          <SelectItem value="3">3 hops</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={!hasSelection || searchAroundPending} onClick={onSearchAround}>
        {searchAroundPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Network className="size-4 mr-1" />}
        Search around
      </Button>

      <div className="mx-2 h-6 w-px bg-border" />

      {bulkActions.length === 0 ? (
        <span className="text-xs text-muted-foreground" data-testid="no-actions">
          No actions available
        </span>
      ) : (
        <Select value={activeBulkAction} onValueChange={onBulkActionChange}>
          <SelectTrigger className="w-48" aria-label="Bulk action">
            <SelectValue placeholder="Select action" />
          </SelectTrigger>
          <SelectContent>
            {bulkActions.map((a) => (
              <SelectItem key={a.name} value={a.name}>
                {a.verb} — {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        size="sm"
        disabled={!hasSelection || !activeBulkAction || runBulkActionPending}
        onClick={onRunBulkAction}
      >
        {runBulkActionPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Play className="size-4 mr-1" />}
        Apply action{hasSelection ? ` (${selectedCount})` : ''}
      </Button>
    </div>
  )
}

function renderResultsTableBody({
  searchLoading,
  searchError,
  rows,
  columns,
  selected,
  onToggleRow,
  onOpenObject,
}: {
  searchLoading: boolean
  searchError: boolean
  rows: OntologyObject[]
  columns: string[]
  selected: Set<string>
  onToggleRow: (id: string) => void
  onOpenObject: (id: string) => void
}) {
  const colSpan = columns.length + 4
  if (searchLoading) {
    return (
      <tr>
        <td colSpan={colSpan} className="p-6 text-center text-muted-foreground">
          <Loader2 className="size-4 mr-2 inline animate-spin" />
          Loading objects...
        </td>
      </tr>
    )
  }
  if (searchError) {
    return (
      <tr>
        <td colSpan={colSpan} className="p-6 text-center text-destructive">
          Failed to load objects
        </td>
      </tr>
    )
  }
  if (rows.length === 0) {
    return (
      <tr>
        <td colSpan={colSpan} className="p-6 text-center text-muted-foreground">
          No objects found
        </td>
      </tr>
    )
  }
  return (
    <>
      {rows.map((obj) => (
        <tr
          key={obj.id}
          data-testid="object-row"
          className={cn(
            'border-b transition-colors hover:bg-muted/50 cursor-pointer',
            selected.has(obj.id) ? 'bg-muted/40' : '',
          )}
          onClick={() => {
            onOpenObject(obj.id)
          }}
        >
          <td
            className="px-3 py-2 align-middle"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <Checkbox
              aria-label={`Select ${obj.id}`}
              checked={selected.has(obj.id)}
              onCheckedChange={() => {
                onToggleRow(obj.id)
              }}
            />
          </td>
          <td className="px-3 py-2 align-middle font-mono text-xs">{obj.id}</td>
          <td className="px-3 py-2 align-middle">
            <Badge variant="outline">{obj.type}</Badge>
          </td>
          <td className="px-3 py-2 align-middle">{obj.title ?? '—'}</td>
          {columns.map((c) => (
            <td key={c} className="px-3 py-2 align-middle text-muted-foreground">
              {renderCell(obj.properties?.[c])}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function renderResultsTable(props: {
  columns: string[]
  allSelected: boolean
  onToggleAll: () => void
  searchLoading: boolean
  searchError: boolean
  rows: OntologyObject[]
  selected: Set<string>
  onToggleRow: (id: string) => void
  onOpenObject: (id: string) => void
}) {
  const { columns, allSelected, onToggleAll } = props
  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b">
          <tr className="border-b transition-colors">
            <th className="h-10 px-3 text-left align-middle w-10">
              <Checkbox aria-label="Select all" checked={allSelected} onCheckedChange={onToggleAll} />
            </th>
            <th className="h-10 px-3 text-left align-middle font-medium">ID</th>
            <th className="h-10 px-3 text-left align-middle font-medium">Type</th>
            <th className="h-10 px-3 text-left align-middle font-medium">Title</th>
            {columns.map((c) => (
              <th key={c} className="h-10 px-3 text-left align-middle font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">{renderResultsTableBody(props)}</tbody>
      </table>
    </div>
  )
}

function renderSearchAroundResults({
  data,
  onOpenObject,
}: {
  data: ObjectSetResult | undefined
  onOpenObject: (id: string) => void
}) {
  if (!data) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="size-4" />
          Related objects ({data.total})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.objects.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              onOpenObject(o.id)
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted/50"
          >
            <Badge variant="outline">{o.type}</Badge>
            <span className="font-mono text-xs">{o.id}</span>
            <span className="truncate">{o.title}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

function renderPivotTableBody({
  pivotLoading,
  pivotResult,
  onOpenObject,
}: {
  pivotLoading: boolean
  pivotResult: ObjectSetResult | undefined
  onOpenObject: (id: string) => void
}) {
  if (pivotLoading) {
    return (
      <tr>
        <td colSpan={3} className="p-6 text-center text-muted-foreground">
          <Loader2 className="size-4 mr-2 inline animate-spin" />
          Pivoting...
        </td>
      </tr>
    )
  }
  if (!pivotResult || pivotResult.objects.length === 0) {
    return (
      <tr>
        <td colSpan={3} className="p-6 text-center text-muted-foreground">
          No pivot results yet
        </td>
      </tr>
    )
  }
  return (
    <>
      {pivotResult.objects.map((o) => (
        <tr
          key={o.id}
          data-testid="pivot-row"
          className="border-b hover:bg-muted/50 cursor-pointer"
          onClick={() => {
            onOpenObject(o.id)
          }}
        >
          <td className="px-3 py-2 align-middle font-mono text-xs">{o.id}</td>
          <td className="px-3 py-2 align-middle">
            <Badge variant="outline">{o.type}</Badge>
          </td>
          <td className="px-3 py-2 align-middle">{o.title ?? '—'}</td>
        </tr>
      ))}
    </>
  )
}

function renderPivotTab(props: {
  linkType: string
  onRunPivot: () => void
  pivotLoading: boolean
  pivotResult: ObjectSetResult | undefined
  onOpenObject: (id: string) => void
}) {
  const { linkType, onRunPivot } = props
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <GitFork className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Pivoting current set across <code>{linkType}</code>
        </span>
        <Button variant="outline" size="sm" onClick={onRunPivot}>
          Refresh pivot
        </Button>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b">
              <th className="h-10 px-3 text-left align-middle font-medium">ID</th>
              <th className="h-10 px-3 text-left align-middle font-medium">Type</th>
              <th className="h-10 px-3 text-left align-middle font-medium">Title</th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">{renderPivotTableBody(props)}</tbody>
        </table>
      </div>
    </div>
  )
}

function renderAggregateTab({
  draftFilter,
  onDraftFilterChange,
  aggregatePending,
  onRunAggregate,
  buckets,
}: {
  draftFilter: PropertyFilter
  onDraftFilterChange: (f: PropertyFilter) => void
  aggregatePending: boolean
  onRunAggregate: () => void
  buckets: AggregateBucket[]
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sigma className="size-4 text-muted-foreground" />
        <Input
          aria-label="Group by property"
          placeholder="group by property (e.g. type)"
          className="w-64"
          value={draftFilter.property}
          onChange={(e) => {
            onDraftFilterChange({ ...draftFilter, property: e.target.value })
          }}
        />
        <Button size="sm" disabled={aggregatePending || !draftFilter.property.trim()} onClick={onRunAggregate}>
          {aggregatePending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Sigma className="size-4 mr-1" />}
          Aggregate
        </Button>
      </div>
      <div className="space-y-2">
        {buckets.map((bucket) => (
          <div key={bucket.key} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <span className="font-medium">{bucket.key}</span>
            <Badge variant="secondary">{bucket.count}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

function resolveObjectTypeFilter(objectType: string): string | undefined {
  return objectType === 'all' ? undefined : objectType
}

function resolveActiveBulkAction(bulkActions: OntologyActionSummary[], bulkAction: string): string {
  if (bulkActions.some((a) => a.name === bulkAction)) return bulkAction
  return bulkActions[0]?.name ?? ''
}

export default function ObjectExplorerView({ onOpenObject = defaultOpenObject }: ObjectExplorerViewProps = {}) {
  const queryClient = useQueryClient()

  // --- Search / facet state -------------------------------------------------
  const [query, setQuery] = useState('')
  const [objectType, setObjectType] = useState<string>('all')
  const [filters, setFilters] = useState<PropertyFilter[]>([])
  const [draftFilter, setDraftFilter] = useState<PropertyFilter>({
    property: '',
    op: 'eq',
    value: '',
  })

  // --- Selection / pivot state ----------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [linkType, setLinkType] = useState('relates_to')
  const [hops, setHops] = useState(1)
  const [bulkAction, setBulkAction] = useState<string>('')

  const searchPayload = useMemo(
    () => ({
      query,
      object_type: resolveObjectTypeFilter(objectType),
      filters,
    }),
    [query, objectType, filters],
  )

  // --- Primary object-set search (re-runs whenever facets/filters change) ---
  const {
    data: searchResult,
    isLoading: searchLoading,
    isError: searchError,
  } = useQuery<ObjectSetResult>({
    queryKey: ['ontology-object-set', searchPayload],
    queryFn: () => api.ontologySearch(searchPayload),
  })

  const columns = useMemo(() => deriveColumns(searchResult), [searchResult])
  const rows = searchResult?.objects ?? []

  // --- Registered actions (dynamic bulk-action menu) ------------------------
  // Scope to the selected type facet so only actions that apply are offered;
  // filter to mutation/external-effect actions (a read action is not a
  // writeback). Every entry is a REAL registered, executor-routed action.
  const actionType = resolveObjectTypeFilter(objectType)
  const { data: registeredActions } = useQuery<OntologyActionSummary[]>({
    queryKey: ['ontology-actions', actionType],
    queryFn: () => api.listOntologyActions(actionType),
  })
  const bulkActions = useMemo(() => (registeredActions ?? []).filter(isBulkApplicableAction), [registeredActions])

  // Keep the selected bulk action valid as the available set changes.
  const activeBulkAction = resolveActiveBulkAction(bulkActions, bulkAction)

  // --- Saved object sets (save + list + load loop) --------------------------
  const { data: savedSets } = useQuery<SavedObjectSetSummary[]>({
    queryKey: ['ontology-saved-sets'],
    queryFn: () => api.listSavedObjectSets(),
  })

  // --- Search-around (related objects N hops from the selection) ------------
  const searchAround = useMutation<ObjectSetResult>({
    mutationFn: () =>
      api.ontologySearchAround({
        ids: Array.from(selected),
        link_type: linkType,
        hops,
      }),
    onSuccess: (res) => {
      toast.success(`Found ${res.total} related object${res.total === 1 ? '' : 's'}`)
    },
    onError: () => toast.error('Search-around failed'),
  })

  // --- Pivot across a link type --------------------------------------------
  const {
    data: pivotResult,
    isLoading: pivotLoading,
    refetch: refetchPivot,
  } = useQuery<ObjectSetResult>({
    queryKey: ['ontology-pivot', searchPayload, linkType],
    queryFn: () => api.ontologyPivot({ ...searchPayload, link_type: linkType }),
    enabled: false,
  })

  // --- Aggregate (group-by over the result set) ----------------------------
  const aggregate = useMutation<AggregateBucket[], Error, string>({
    mutationFn: (property: string) => api.ontologyAggregate({ ...searchPayload, group_by: property }),
  })

  // --- Bulk action on the current selection ---------------------------------
  const runBulkAction = useMutation({
    mutationFn: () =>
      api.ontologyObjectSetAction({
        ids: Array.from(selected),
        action_name: activeBulkAction,
      }),
    onSuccess: (res) => {
      toast.success(`Applied "${activeBulkAction}" to ${res.applied} object(s)`)
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['ontology-object-set'] })
    },
    onError: () => toast.error('Bulk action failed'),
  })

  // --- Save / share the current object set ----------------------------------
  const saveSet = useMutation({
    mutationFn: (name: string) => api.ontologySaveObjectSet({ name, ...searchPayload }),
    onSuccess: (res: { id: string }) => {
      toast.success(`Saved object set ${res.id}`)
      void queryClient.invalidateQueries({ queryKey: ['ontology-saved-sets'] })
    },
    onError: () => toast.error('Failed to save object set'),
  })

  /** Load a saved set by re-running its members (narrow the facet to its kind). */
  const loadSavedSet = (set: SavedObjectSetSummary) => {
    setQuery('')
    setFilters([])
    setSelected(new Set())
    setObjectType(set.kind?.trim() ? set.kind : 'all')
    toast.success(`Loaded saved set "${set.name}"`)
  }

  const runPivot = () => {
    void refetchPivot()
  }

  const addFilter = () => {
    if (!draftFilter.property.trim()) return
    setFilters((f) => [...f, draftFilter])
    setDraftFilter({ property: '', op: 'eq', value: '' })
  }

  const removeFilter = (idx: number) => {
    setFilters((f) => f.filter((_, i) => i !== idx))
  }

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === rows.length && rows.length > 0) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }

  const hasSelection = selected.size > 0
  const allSelected = rows.length > 0 && selected.size === rows.length

  return (
    <div className="space-y-6">
      {renderExplorerHeader({
        savedSets: savedSets ?? [],
        onLoadSavedSet: loadSavedSet,
        isSaving: saveSet.isPending,
        onSave: () => {
          const name = window.prompt('Name this object set')
          if (name) saveSet.mutate(name)
        },
      })}

      {renderSearchFacetsCard({
        query,
        onQueryChange: setQuery,
        objectType,
        onObjectTypeChange: setObjectType,
        draftFilter,
        onDraftFilterChange: setDraftFilter,
        onAddFilter: addFilter,
        filters,
        onRemoveFilter: removeFilter,
      })}

      <Tabs defaultValue="results">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="pivot" onClick={runPivot}>
            Pivot
          </TabsTrigger>
          <TabsTrigger value="aggregate">Aggregate</TabsTrigger>
        </TabsList>

        {/* Results table + selection-driven actions */}
        <TabsContent value="results" className="space-y-4">
          {renderResultsToolbar({
            linkType,
            onLinkTypeChange: setLinkType,
            hops,
            onHopsChange: setHops,
            hasSelection,
            searchAroundPending: searchAround.isPending,
            onSearchAround: () => {
              searchAround.mutate()
            },
            bulkActions,
            activeBulkAction,
            onBulkActionChange: setBulkAction,
            runBulkActionPending: runBulkAction.isPending,
            selectedCount: selected.size,
            onRunBulkAction: () => {
              runBulkAction.mutate()
            },
          })}

          {renderResultsTable({
            columns,
            allSelected,
            onToggleAll: toggleAll,
            searchLoading,
            searchError,
            rows,
            selected,
            onToggleRow: toggleRow,
            onOpenObject,
          })}

          <p className="text-xs text-muted-foreground">
            {searchResult ? `${searchResult.total} object(s)` : ''}
            {hasSelection ? ` · ${selected.size} selected` : ''}
          </p>

          {renderSearchAroundResults({ data: searchAround.data, onOpenObject })}
        </TabsContent>

        {/* Pivot */}
        <TabsContent value="pivot" className="space-y-4">
          {renderPivotTab({ linkType, onRunPivot: runPivot, pivotLoading, pivotResult, onOpenObject })}
        </TabsContent>

        {/* Aggregate */}
        <TabsContent value="aggregate" className="space-y-4">
          {renderAggregateTab({
            draftFilter,
            onDraftFilterChange: setDraftFilter,
            aggregatePending: aggregate.isPending,
            onRunAggregate: () => {
              aggregate.mutate(draftFilter.property)
            },
            buckets: aggregate.data ?? [],
          })}
        </TabsContent>
      </Tabs>
    </div>
  )
}
