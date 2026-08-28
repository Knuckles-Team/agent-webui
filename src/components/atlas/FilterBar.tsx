/**
 * @file FilterBar.tsx
 * @description The modality-neutral facet UI — the "easily filter" half of the ask.
 *
 * The same control drives every modality because it edits a {@link FilterSet}, which
 * each adapter compiles down itself. Two rules keep it honest:
 *  - only fields the adapter's `introspect` advertised are offered;
 *  - only operators in `capabilities().filters` are offered — never offered and then
 *    silently dropped at compile time.
 */
import { Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClause, isValuelessOperator, OPERATOR_LABELS, operatorsForType } from '@/lib/atlas/filters'
import { fieldType } from '@/lib/atlas/schema'
import type { AdapterCapabilities, FilterClause, FilterOperator, FilterSet, SchemaNode } from '@/lib/atlas/types'

export interface FilterBarProps {
  filters: FilterSet
  fields: SchemaNode[]
  capabilities: AdapterCapabilities
  onChange: (filters: FilterSet) => void
}

function ClauseRow({
  clause,
  fields,
  capabilities,
  onChange,
  onRemove,
}: {
  clause: FilterClause
  fields: SchemaNode[]
  capabilities: AdapterCapabilities
  onChange: (clause: FilterClause) => void
  onRemove: () => void
}) {
  const operators = operatorsForType(fieldType(fields, clause.field), capabilities.filters)
  return (
    <div className="flex items-center gap-1.5" data-testid="atlas-filter-clause">
      <Select
        value={clause.field}
        onValueChange={(field) => {
          onChange({ ...clause, field })
        }}
      >
        <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter field">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.map((field) => (
            <SelectItem key={field.id} value={field.id}>
              {field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={clause.op}
        onValueChange={(op) => {
          onChange({ ...clause, op: op as FilterOperator })
        }}
      >
        <SelectTrigger className="h-8 w-28 text-xs" aria-label="Filter operator">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isValuelessOperator(clause.op) && (
        <Input
          aria-label="Filter value"
          value={String(clause.value ?? '')}
          onChange={(event) => {
            onChange({ ...clause, value: event.target.value })
          }}
          className="h-8 w-44 text-xs"
          placeholder="value"
        />
      )}
      <Button variant="ghost" size="icon" className="size-8" aria-label="Remove filter" onClick={onRemove}>
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

/** Replace clause `id` with `next`, preserving order. */
function replaceClause(clauses: FilterClause[], next: FilterClause): FilterClause[] {
  return clauses.map((clause) => (clause.id === next.id ? next : clause))
}

export function FilterBar({ filters, fields, capabilities, onChange }: FilterBarProps) {
  const canAdd = fields.length > 0 && capabilities.filters.length > 0
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="atlas-filter-bar">
      {capabilities.freeTextSearch && (
        <Input
          aria-label="Search results"
          value={filters.search}
          onChange={(event) => {
            onChange({ ...filters, search: event.target.value })
          }}
          placeholder="Search…"
          className="h-8 w-48 text-xs"
        />
      )}
      {filters.clauses.map((clause) => (
        <ClauseRow
          key={clause.id}
          clause={clause}
          fields={fields}
          capabilities={capabilities}
          onChange={(next) => {
            onChange({ ...filters, clauses: replaceClause(filters.clauses, next) })
          }}
          onRemove={() => {
            onChange({ ...filters, clauses: filters.clauses.filter((entry) => entry.id !== clause.id) })
          }}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        disabled={!canAdd}
        onClick={() => {
          onChange({
            ...filters,
            clauses: [...filters.clauses, createClause(fields[0].id, capabilities.filters[0])],
          })
        }}
      >
        <Plus className="mr-1 size-3.5" />
        Filter
      </Button>
      {filters.clauses.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            onChange({ ...filters, combinator: filters.combinator === 'and' ? 'or' : 'and' })
          }}
        >
          match {filters.combinator === 'and' ? 'all' : 'any'}
        </Button>
      )}
    </div>
  )
}
