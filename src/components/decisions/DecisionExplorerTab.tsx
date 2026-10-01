import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import type { DecisionsTransport } from './decisions-transport'
import type { DecisionListRow } from './decision-schemas'
import { categoryTone, formatEpochMs, humanize, shortenId } from './decision-format'
import DecisionDetailPanel from './DecisionDetailPanel'

/**
 * @file DecisionExplorerTab.tsx
 * @description The decision explorer's list half — every visible decision-log
 * entry, filterable by question id, newest first. Selecting a row drives
 * `DecisionDetailPanel`'s two independent reads (record, provenance); this
 * component owns only the filter text and which row is selected, never the
 * fetched data itself (React Query owns that, through the injected
 * `transport` seam — see `decisions-transport.ts`).
 */

function ListRow({
  row,
  selected,
  onSelect,
}: {
  row: DecisionListRow
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(row.record_id)
      }}
      aria-pressed={selected}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        selected ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border/30 bg-muted/5 hover:border-border/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold truncate">{shortenId(row.record_id, 28)}</span>
        <Badge variant="outline" className={`text-[10px] ${categoryTone(row.outcome)}`}>
          {humanize(row.outcome)}
        </Badge>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>{row.question_id ?? 'assemble'}</span>
        <Badge variant="outline" className={`text-[9px] ${categoryTone(row.evidence_class)}`}>
          {humanize(row.evidence_class)}
        </Badge>
        <Badge variant="outline" className={`text-[9px] ${categoryTone(row.resolution_kind)}`}>
          {humanize(row.resolution_kind)}
        </Badge>
        <span className="ml-auto">{formatEpochMs(row.committed_at_ms ?? row.created_at_ms)}</span>
      </div>
    </button>
  )
}

function ListBody({
  rows,
  isLoading,
  isError,
  selectedId,
  onSelect,
}: {
  rows: DecisionListRow[]
  isLoading: boolean
  isError: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading decisions…</div>
  }
  if (isError) {
    return (
      <div className="py-6">
        <UnavailableNotice what="The decision log" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No decisions recorded yet.</div>
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <ListRow key={row.record_id} row={row} selected={row.record_id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}

export default function DecisionExplorerTab({ transport }: { transport: DecisionsTransport }) {
  const [questionFilter, setQuestionFilter] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ['decisions', appliedFilter],
    queryFn: ({ signal }) => transport.listDecisions({ questionId: appliedFilter || undefined }, signal),
  })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
      <div className="space-y-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setAppliedFilter(questionFilter.trim())
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              aria-label="Filter by question id"
              placeholder="Filter by question id…"
              value={questionFilter}
              onChange={(e) => {
                setQuestionFilter(e.target.value)
              }}
              className="pl-9 h-9 bg-muted/20"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => {
              void listQuery.refetch()
            }}
            disabled={listQuery.isFetching}
            aria-label="Refresh decisions"
          >
            <RefreshCw className={`size-4 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </form>
        <ScrollArea className="h-[calc(100vh-26rem)] min-h-[16rem] pr-2">
          <ListBody
            rows={listQuery.data ?? []}
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </ScrollArea>
      </div>
      <DecisionDetailPanel recordId={selectedId} transport={transport} />
    </div>
  )
}
