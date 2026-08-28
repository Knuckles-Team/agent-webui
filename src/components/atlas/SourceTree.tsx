/**
 * @file SourceTree.tsx
 * @description The left region: whatever `adapter.introspect()` found, searchable.
 *
 * `unavailable` is rendered as a STATED ABSENCE with the backend's own reason, never
 * as an empty list — "the backend cannot enumerate this yet" and "there is nothing
 * here" are different facts and a reader must be able to tell them apart.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Circle, Database, Search, Tag } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { countSchemaNodes, searchSchema } from '@/lib/atlas/schema'
import type { SchemaNode, SchemaNodeKind, SchemaTree } from '@/lib/atlas/types'

export interface SourceTreeProps {
  schema: SchemaTree
  loading: boolean
  /** A node carrying `seedQuery` was clicked — put its query in the console. */
  onSeed: (query: string) => void
}

const KIND_ICON: Readonly<Record<SchemaNodeKind, typeof Circle>> = {
  source: Database,
  collection: Tag,
  field: Circle,
  value: Circle,
}

function SchemaRow({ node, depth, onSeed }: { node: SchemaNode; depth: number; onSeed: (query: string) => void }) {
  const [open, setOpen] = useState(depth === 0)
  const children = node.children ?? []
  const Icon = KIND_ICON[node.kind]
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div>
      <button
        type="button"
        className="hover:bg-muted/60 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm"
        style={{ paddingLeft: `${String(depth * 12 + 8)}px` }}
        onClick={() => {
          if (children.length > 0) setOpen((value) => !value)
          if (node.seedQuery) onSeed(node.seedQuery)
        }}
        aria-expanded={children.length > 0 ? open : undefined}
      >
        {children.length > 0 ? (
          <Chevron className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="truncate">{node.label}</span>
        {typeof node.count === 'number' && (
          <span className="text-muted-foreground ml-auto shrink-0 font-mono text-xs">
            {node.count.toLocaleString()}
          </span>
        )}
      </button>
      {open && children.map((child) => <SchemaRow key={child.id} node={child} depth={depth + 1} onSeed={onSeed} />)}
    </div>
  )
}

function SchemaBody({ schema, loading, onSeed, query }: SourceTreeProps & { query: string }) {
  const roots = useMemo(() => searchSchema(schema.roots, query), [schema.roots, query])
  if (loading) return <Skeleton className="m-2 h-40" />
  if (schema.unavailable) {
    return (
      <p className="text-muted-foreground p-3 text-sm" data-testid="atlas-schema-unavailable">
        This modality cannot enumerate its sources here yet.
        {schema.note ? ` ${schema.note}` : ''}
      </p>
    )
  }
  if (roots.length === 0) return <p className="text-muted-foreground p-3 text-sm">Nothing matches that.</p>
  return (
    <div data-testid="atlas-schema-tree">
      {roots.map((node) => (
        <SchemaRow key={node.id} node={node} depth={0} onSeed={onSeed} />
      ))}
    </div>
  )
}

export function SourceTree(props: SourceTreeProps) {
  const [query, setQuery] = useState('')
  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b p-2">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2" />
        <Input
          aria-label="Search sources"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Search sources"
          className="h-8 pl-7 text-sm"
        />
      </div>
      <ScrollArea className="flex-1">
        <SchemaBody {...props} query={query} />
      </ScrollArea>
      <p className="text-muted-foreground border-t px-3 py-1.5 text-xs">
        {countSchemaNodes(props.schema.roots).toLocaleString()} entries
      </p>
    </div>
  )
}
