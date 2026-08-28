/**
 * @file ObjectView.tsx
 * @description Palantir-style Object View renderer (ontology object hub).
 *
 * Renders a single ontology object instance as the central hub:
 *  - typed, value-type-aware PROPERTIES
 *  - computed DERIVED properties (visually distinguished)
 *  - in/out LINKS grouped by link type, each navigable
 *  - MARKINGS / permission badges
 *  - EDIT HISTORY timeline (from kg.ontology.edits.history)
 *  - inline EDIT affordance (property edit) + REVERT control
 *
 * Two form factors via `variant`: 'full' (comprehensive page) and 'panel'
 * (compact embeddable). Layout source via `layout`: 'standard'
 * (auto-generated from the object-type schema) or 'configured' (a stored
 * widget layout returned by the backend with the object payload).
 *
 * Data flows through the `api` singleton + @tanstack/react-query:
 *  - api.getOntologyObject(id)  -> GET  /api/enhanced/ontology/object/{id}
 *  - api.editOntologyObject     -> POST /api/enhanced/ontology/object/{id}/edit
 *  - api.revertOntologyEdit     -> POST /api/enhanced/ontology/object/{id}/revert
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Boxes,
  Calendar,
  Hash,
  History,
  Link2,
  Pencil,
  RotateCcw,
  Shield,
  Sparkles,
  Type as TypeIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/** A single typed property value on an ontology object. */
export interface OntologyPropertyValue {
  /** Property api-name (stable key). */
  name: string
  /** Human-facing title; falls back to `name`. */
  title?: string
  /** Resolved value-type (e.g. 'string', 'integer', 'boolean', 'timestamp'). */
  value_type?: string
  /** The materialized value. */
  value: unknown
}

/** A computed/derived property. */
export interface OntologyDerivedValue extends OntologyPropertyValue {
  /** Human-readable definition of how this value was derived. */
  expression?: string
}

/** A link to another object, grouped under a link type. */
export interface OntologyLink {
  /** Link type api-name (e.g. 'authored_by'). */
  link_type: string
  /** Human-facing title for the link type. */
  title?: string
  /** Direction relative to this object. */
  direction: 'out' | 'in'
  /** Target object primary key. */
  target_id: string
  /** Target object type api-name. */
  target_type?: string
  /** Target display title. */
  target_title?: string
}

/** A single recorded edit in the object's history. */
export interface OntologyEdit {
  /** Stable edit id (used for revert). */
  edit_id: string
  /** Edit kind: property set, link added/removed, etc. */
  kind: string
  /** Property/link affected. */
  target?: string
  /** Prior value (for property edits). */
  old_value?: unknown
  /** New value (for property edits). */
  new_value?: unknown
  /** Actor who made the edit. */
  actor?: string
  /** ISO-8601 timestamp. */
  timestamp: string
  /** Whether this edit has been reverted. */
  reverted?: boolean
}

/** A stored widget layout descriptor (configured view). */
export interface OntologyViewLayout {
  /** Ordered list of property api-names to surface first. */
  property_order?: string[]
  /** Ordered list of link-type api-names to surface first. */
  link_order?: string[]
  /** Title override for the object header. */
  title?: string
}

/** Full payload returned by GET /ontology/object/{id}. */
export interface OntologyObject {
  /** Primary key. */
  id: string
  /** Object-type api-name. */
  object_type: string
  /** Display title. */
  title?: string
  /** Typed properties. */
  properties: OntologyPropertyValue[]
  /** Computed/derived properties. */
  derived: OntologyDerivedValue[]
  /** In/out links. */
  links: OntologyLink[]
  /** Security markings applied to this object. */
  markings: string[]
  /** Edit history (most-recent-first or oldest-first; component sorts). */
  history: OntologyEdit[]
  /** Optional stored widget layout (present when configured). */
  layout?: OntologyViewLayout
}

/** Request body for a property edit. */
export interface OntologyEditRequest {
  /** Edit kind. */
  kind: 'set_property' | 'add_link' | 'remove_link'
  /** Property api-name or link type. */
  target: string
  /** New value (for set_property). */
  value?: unknown
}

export interface ObjectViewProps {
  /** Primary key of the object to render. */
  objectId: string
  /** Form factor. */
  variant?: 'full' | 'panel'
  /** Layout source. */
  layout?: 'standard' | 'configured'
  /** Optional navigation callback when a link is activated. */
  onNavigate?: (targetId: string, targetType?: string) => void
}

/** Render a boolean value as its literal text. */
function formatBoolean(value: boolean): string {
  return value ? 'true' : 'false'
}

/** Render a `'true'`/other string as a boolean-typed value's literal text. */
function formatStringAsBoolean(value: string): string {
  return value === 'true' ? 'true' : 'false'
}

/** Parse a string as a date and format it, or null if it doesn't parse. */
function formatStringAsDate(value: string): string | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
}

/** Format a string value honoring its declared value-type. */
function formatStringValue(value: string, valueType?: string): string {
  if (valueType === 'boolean') return formatStringAsBoolean(value)
  if (valueType === 'timestamp' || valueType === 'date') {
    const formatted = formatStringAsDate(value)
    if (formatted !== null) return formatted
  }
  return value
}

/** Format a typed value for display, honoring its value-type. */
export function formatValue(value: unknown, valueType?: string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return formatBoolean(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return formatStringValue(value, valueType)
  return JSON.stringify(value)
}

/** Coerce a raw text draft to a typed value for a set_property edit. */
export function coerceEditValue(draft: string, valueType?: string): unknown {
  if (valueType === 'integer') return Number.parseInt(draft, 10)
  if (valueType === 'double' || valueType === 'float') return Number.parseFloat(draft)
  if (valueType === 'boolean') return draft === 'true'
  return draft
}

/** Build the request body for a property set edit. */
export function buildPropertyEdit(prop: OntologyPropertyValue, draft: string): OntologyEditRequest {
  return { kind: 'set_property', target: prop.name, value: coerceEditValue(draft, prop.value_type) }
}

/** Apply an explicit ordering to a keyed list, appending un-ordered tail. */
export function applyOrder<T>(items: T[], order: string[] | undefined, keyOf: (item: T) => string): T[] {
  if (!order || order.length === 0) return items
  const rank = new Map(order.map((k, i) => [k, i]))
  return [...items].sort((a, b) => {
    const ra = rank.has(keyOf(a)) ? rank.get(keyOf(a))! : Number.MAX_SAFE_INTEGER
    const rb = rank.has(keyOf(b)) ? rank.get(keyOf(b))! : Number.MAX_SAFE_INTEGER
    return ra - rb
  })
}

/** Derive an initial edit-dialog draft string from a property's current value. */
function draftFromValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value !== null && value !== undefined) return JSON.stringify(value)
  return ''
}

function ObjectMarkings({ markings }: { markings: string[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1" data-testid="object-markings">
      {markings.length === 0 ? (
        <Badge variant="secondary" className="gap-1 text-xs">
          <Shield className="size-3" />
          unrestricted
        </Badge>
      ) : (
        markings.map((m) => (
          <Badge key={m} variant="destructive" className="gap-1 text-xs">
            <Shield className="size-3" />
            {m}
          </Badge>
        ))
      )}
    </div>
  )
}

/** Header: object identity + markings */
function ObjectHeaderCard({ data, isPanel }: { data: OntologyObject; isPanel: boolean }) {
  const headerTitle = data.layout?.title ?? data.title ?? data.id
  return (
    <Card className="border-border/40">
      <CardHeader className={cn(isPanel && 'p-4')}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className={cn('flex items-center gap-2', isPanel ? 'text-base' : 'text-xl')}>
              <Boxes className={cn(isPanel ? 'size-4' : 'size-5', 'text-primary shrink-0')} />
              <span className="truncate">{headerTitle}</span>
            </CardTitle>
            <CardDescription className="flex items-center gap-2 font-mono text-xs mt-1">
              <Hash className="size-3" />
              <span className="truncate">{data.id}</span>
              <Badge variant="outline" className="ml-1">
                {data.object_type}
              </Badge>
            </CardDescription>
          </div>
          <ObjectMarkings markings={data.markings} />
        </div>
      </CardHeader>
    </Card>
  )
}

function PropertyRow({
  prop,
  onEdit,
}: {
  prop: OntologyPropertyValue
  onEdit: (prop: OntologyPropertyValue) => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded border border-border/30 px-3 py-2"
      data-testid={`property-${prop.name}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate">{prop.title ?? prop.name}</span>
          {prop.value_type && (
            <Badge variant="outline" className="text-[10px] py-0">
              {prop.value_type}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground break-all">{formatValue(prop.value, prop.value_type)}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Edit ${prop.name}`}
        onClick={() => {
          onEdit(prop)
        }}
      >
        <Pencil className="size-3" />
      </Button>
    </div>
  )
}

function PropertiesCard({
  properties,
  isPanel,
  onEdit,
}: {
  properties: OntologyPropertyValue[]
  isPanel: boolean
  onEdit: (prop: OntologyPropertyValue) => void
}) {
  return (
    <Card>
      <CardHeader className={cn(isPanel && 'p-4 pb-2')}>
        <CardTitle className="text-sm flex items-center gap-2">
          <TypeIcon className="size-4" />
          Properties
        </CardTitle>
      </CardHeader>
      <CardContent className={cn('space-y-2', isPanel && 'p-4 pt-0')}>
        {properties.length === 0 ? (
          <p className="text-xs text-muted-foreground">No properties.</p>
        ) : (
          properties.map((prop) => <PropertyRow key={prop.name} prop={prop} onEdit={onEdit} />)
        )}
      </CardContent>
    </Card>
  )
}

/** DERIVED — visually distinguished (sparkle + dashed accent) */
function DerivedPropertyRow({ derived }: { derived: OntologyDerivedValue }) {
  return (
    <div
      className="rounded border border-primary/20 bg-background/40 px-3 py-2"
      data-testid={`derived-${derived.name}`}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-3 text-primary/70" />
        <span className="text-xs font-medium truncate">{derived.title ?? derived.name}</span>
        {derived.value_type && (
          <Badge variant="outline" className="text-[10px] py-0">
            {derived.value_type}
          </Badge>
        )}
      </div>
      <span className="text-xs text-muted-foreground break-all">{formatValue(derived.value, derived.value_type)}</span>
      {derived.expression && (
        <code className="mt-1 block text-[10px] text-primary/60 font-mono break-all">{derived.expression}</code>
      )}
    </div>
  )
}

function DerivedPropertiesCard({ derived, isPanel }: { derived: OntologyDerivedValue[]; isPanel: boolean }) {
  return (
    <Card className="border-dashed border-primary/40 bg-primary/[0.02]">
      <CardHeader className={cn(isPanel && 'p-4 pb-2')}>
        <CardTitle className="text-sm flex items-center gap-2 text-primary">
          <Sparkles className="size-4" />
          Derived Properties
        </CardTitle>
        <CardDescription className="text-xs">Computed from the ontology, read-only.</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-2', isPanel && 'p-4 pt-0')}>
        {derived.length === 0 ? (
          <p className="text-xs text-muted-foreground">No derived properties.</p>
        ) : (
          derived.map((d) => <DerivedPropertyRow key={d.name} derived={d} />)
        )}
      </CardContent>
    </Card>
  )
}

/** PROPERTIES + DERIVED tab */
function PropertiesTab({
  properties,
  derived,
  isPanel,
  onEdit,
}: {
  properties: OntologyPropertyValue[]
  derived: OntologyDerivedValue[]
  isPanel: boolean
  onEdit: (prop: OntologyPropertyValue) => void
}) {
  return (
    <TabsContent value="properties" className="space-y-4">
      <PropertiesCard properties={properties} isPanel={isPanel} onEdit={onEdit} />
      <DerivedPropertiesCard derived={derived} isPanel={isPanel} />
    </TabsContent>
  )
}

function LinkRow({
  link,
  onNavigate,
}: {
  link: OntologyLink
  onNavigate?: (targetId: string, targetType?: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate?.(link.target_id, link.target_type)}
      className="flex w-full items-center justify-between gap-2 rounded border border-border/30 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      data-testid={`link-${link.target_id}`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Badge variant="outline" className="text-[10px] py-0">
          {link.direction === 'out' ? '→' : '←'}
        </Badge>
        <span className="text-xs truncate">{link.target_title ?? link.target_id}</span>
      </span>
      {link.target_type && (
        <Badge variant="secondary" className="text-[10px] py-0 shrink-0">
          {link.target_type}
        </Badge>
      )}
    </button>
  )
}

function LinkGroupSection({
  linkType,
  links,
  onNavigate,
}: {
  linkType: string
  links: OntologyLink[]
  onNavigate?: (targetId: string, targetType?: string) => void
}) {
  return (
    <div data-testid={`link-group-${linkType}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {links[0]?.title ?? linkType}
        </span>
        <Badge variant="secondary" className="text-[10px] py-0">
          {links.length}
        </Badge>
      </div>
      <Separator className="mb-2" />
      <div className="space-y-1">
        {links.map((link) => (
          <LinkRow key={`${link.direction}:${link.target_id}`} link={link} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}

/** LINKS tab — grouped by type, each navigable */
function LinksTab({
  linkGroups,
  isPanel,
  onNavigate,
}: {
  linkGroups: { linkType: string; links: OntologyLink[] }[]
  isPanel: boolean
  onNavigate?: (targetId: string, targetType?: string) => void
}) {
  return (
    <TabsContent value="links" className="space-y-4">
      <Card>
        <CardHeader className={cn(isPanel && 'p-4 pb-2')}>
          <CardTitle className="text-sm flex items-center gap-2">
            <Link2 className="size-4" />
            Links
          </CardTitle>
        </CardHeader>
        <CardContent className={cn('space-y-4', isPanel && 'p-4 pt-0')}>
          {linkGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground">No links.</p>
          ) : (
            linkGroups.map(({ linkType, links }) => (
              <LinkGroupSection key={linkType} linkType={linkType} links={links} onNavigate={onNavigate} />
            ))
          )}
        </CardContent>
      </Card>
    </TabsContent>
  )
}

function HistoryEntry({
  edit,
  onRevert,
  revertPending,
}: {
  edit: OntologyEdit
  onRevert: (editId: string) => void
  revertPending: boolean
}) {
  return (
    <div className="relative pl-6" data-testid={`history-${edit.edit_id}`}>
      <span className="absolute -left-[9px] top-1 size-4 rounded-full border-2 border-primary/60 bg-background" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] py-0">
              {edit.kind}
            </Badge>
            {edit.target && <span className="text-xs font-medium truncate">{edit.target}</span>}
            {edit.reverted && (
              <Badge variant="secondary" className="text-[10px] py-0">
                reverted
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5 font-mono">
            <Calendar className="size-3" />
            {new Date(edit.timestamp).toLocaleString()}
            {edit.actor && <span>· {edit.actor}</span>}
          </div>
          {(edit.old_value !== undefined || edit.new_value !== undefined) && (
            <p className="text-[11px] text-muted-foreground mt-1 break-all">
              {formatValue(edit.old_value)} → {formatValue(edit.new_value)}
            </p>
          )}
        </div>
        {!edit.reverted && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Revert ${edit.edit_id}`}
            disabled={revertPending}
            onClick={() => {
              onRevert(edit.edit_id)
            }}
          >
            <RotateCcw className="size-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

/** EDIT HISTORY timeline + revert (full only; panel hides the tab) */
function HistoryTab({
  history,
  onRevert,
  revertPending,
}: {
  history: OntologyEdit[]
  onRevert: (editId: string) => void
  revertPending: boolean
}) {
  return (
    <TabsContent value="history" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="size-4" />
            Edit History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recorded edits.</p>
          ) : (
            <div className="relative border-l-2 border-border/30 ml-3 space-y-4">
              {history.map((edit) => (
                <HistoryEntry key={edit.edit_id} edit={edit} onRevert={onRevert} revertPending={revertPending} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  )
}

/** Inline property-edit dialog */
function EditPropertyDialog({
  editProp,
  editDraft,
  onDraftChange,
  onOpenChange,
  onSubmit,
  submitPending,
}: {
  editProp: OntologyPropertyValue | null
  editDraft: string
  onDraftChange: (v: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  submitPending: boolean
}) {
  return (
    <Dialog open={Boolean(editProp)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit property</DialogTitle>
          <DialogDescription>
            {editProp ? (editProp.title ?? editProp.name) : ''}
            {editProp?.value_type ? ` (${editProp.value_type})` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            aria-label="Property value"
            value={editDraft}
            onChange={(e) => {
              onDraftChange(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSubmit()
              }
            }}
          />
          <Button className="w-full" onClick={onSubmit} disabled={submitPending}>
            Save edit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Object View — renders a single ontology object as the central hub.
 */
export default function ObjectView({ objectId, variant = 'full', layout = 'standard', onNavigate }: ObjectViewProps) {
  const queryClient = useQueryClient()
  const isPanel = variant === 'panel'

  const [editProp, setEditProp] = useState<OntologyPropertyValue | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const queryKey = useMemo(() => ['ontology-object', objectId, layout], [objectId, layout])

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => api.getOntologyObject(objectId, layout),
    enabled: Boolean(objectId),
  })

  const editMutation = useMutation({
    mutationFn: (req: OntologyEditRequest) => api.editOntologyObject(objectId, req),
    onMutate: async (req) => {
      // Optimistic update: apply the property edit to the cached object.
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<OntologyObject>(queryKey)
      if (previous && req.kind === 'set_property') {
        queryClient.setQueryData<OntologyObject>(queryKey, {
          ...previous,
          properties: previous.properties.map((p) => (p.name === req.target ? { ...p, value: req.value } : p)),
        })
      }
      return { previous }
    },
    onError: (_err, _req, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous)
      toast.error('Failed to apply object edit')
    },
    onSuccess: () => {
      toast.success('Object edit recorded')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const revertMutation = useMutation({
    mutationFn: (editId: string) => api.revertOntologyEdit(objectId, editId),
    onError: () => toast.error('Failed to revert edit'),
    onSuccess: () => toast.success('Edit reverted'),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const orderedProperties = useMemo(
    () => applyOrder(data?.properties ?? [], data?.layout?.property_order, (p) => p.name),
    [data],
  )

  const linkGroups = useMemo(() => {
    const groups = new Map<string, OntologyLink[]>()
    for (const link of data?.links ?? []) {
      const list = groups.get(link.link_type) ?? []
      list.push(link)
      groups.set(link.link_type, list)
    }
    const keys = applyOrder(Array.from(groups.keys()), data?.layout?.link_order, (k) => k)
    return keys.map((key) => ({ linkType: key, links: groups.get(key)! }))
  }, [data])

  const sortedHistory = useMemo(
    () => [...(data?.history ?? [])].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [data],
  )

  const openEdit = (prop: OntologyPropertyValue) => {
    setEditProp(prop)
    setEditDraft(draftFromValue(prop.value))
  }

  const submitEdit = () => {
    if (!editProp) return
    editMutation.mutate(buildPropertyEdit(editProp, editDraft))
    setEditProp(null)
  }

  if (isLoading) {
    return <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">Loading object…</div>
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-destructive">
        Failed to load object{error instanceof Error ? `: ${error.message}` : ''}
      </div>
    )
  }

  return (
    <div
      className={cn('space-y-6', isPanel ? 'p-3 max-w-md text-sm' : 'p-0')}
      data-testid="object-view"
      data-variant={variant}
    >
      <ObjectHeaderCard data={data} isPanel={isPanel} />

      <Tabs defaultValue="properties" className="w-full">
        <TabsList className={cn('grid w-full', isPanel ? 'grid-cols-2' : 'grid-cols-3')}>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
          {!isPanel && <TabsTrigger value="history">History</TabsTrigger>}
        </TabsList>

        <PropertiesTab properties={orderedProperties} derived={data.derived} isPanel={isPanel} onEdit={openEdit} />

        <LinksTab linkGroups={linkGroups} isPanel={isPanel} onNavigate={onNavigate} />

        {!isPanel && (
          <HistoryTab
            history={sortedHistory}
            onRevert={(editId) => {
              revertMutation.mutate(editId)
            }}
            revertPending={revertMutation.isPending}
          />
        )}
      </Tabs>

      <EditPropertyDialog
        editProp={editProp}
        editDraft={editDraft}
        onDraftChange={setEditDraft}
        onOpenChange={(open) => {
          if (!open) setEditProp(null)
        }}
        onSubmit={submitEdit}
        submitPending={editMutation.isPending}
      />
    </div>
  )
}
