/**
 * @file InstrumentGroups.tsx
 * @description User-defined instrument group tabs plus a Basic/Holdings
 * mode toggle (FUI-02). The selected group and mode persist across
 * navigation and refresh via the URL (`instrument-groups-state.ts`), and
 * the six fetch outcomes below each get their own distinct, text-labeled
 * rendering — never collapsed into one "no data" view. This depends on
 * `EG-FINANCE-PRIMITIVES-R004` (epistemic-graph finance-v1 accounts and
 * reference sessions), which is PENDING; the component is built now,
 * ahead of that backend, against a typed `InstrumentGroupsTransport`
 * fixture (see `MarketsPortfolio.tsx`/`Availability.tsx` for this
 * repository's established build-ahead-of-backend pattern). It is not yet
 * wired into `MarketsHome.tsx`'s render tree.
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { replaceSearch, useAppLocation } from '@/lib/apps/location'
import { cn } from '@/lib/utils'
import { FeaturePending } from './Availability'
import { readGroupSelection, writeGroupSelection, type GroupSelection } from './instrument-groups-state'
import type { GroupMode, InstrumentGroupSummary, InstrumentGroupsTransport } from './instrument-groups-transport'

/**
 * Local state seeded from the URL, written back on every change — the same
 * split `MarketsHome.tsx`'s `useFilters` uses: `replaceSearch` only syncs
 * the URL for bookmarking/refresh, it does not dispatch
 * `history-state-changed` (only `navigateInApp` does), so a component must
 * not depend on `useAppLocation` alone to observe its own writes.
 */
function useGroupSelection(): [GroupSelection, (next: GroupSelection) => void] {
  const location = useAppLocation()
  const [selection, setLocal] = useState(() => readGroupSelection(location.search))
  const set = useCallback((next: GroupSelection) => {
    setLocal(next)
    replaceSearch(writeGroupSelection(next, new URLSearchParams(window.location.search)))
  }, [])
  return [selection, set]
}

function ModeToggle({ mode, onChange }: { mode: GroupMode; onChange: (mode: GroupMode) => void }) {
  const options: { value: GroupMode; label: string }[] = [
    { value: 'basic', label: 'Basic' },
    { value: 'holdings', label: 'Holdings' },
  ]
  return (
    <div role="group" aria-label="View mode" className="inline-flex rounded-full border border-border/50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === mode}
          onClick={() => {
            onChange(option.value)
          }}
          className={cn(
            'rounded-full px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            option.value === mode ? 'bg-primary/15 font-semibold' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function GroupTabs({
  groups,
  groupId,
  onChange,
}: {
  groups: InstrumentGroupSummary[]
  groupId: string | null
  onChange: (groupId: string) => void
}) {
  return (
    <nav aria-label="Instrument groups" className="flex gap-1 overflow-x-auto">
      {groups.map((group) => (
        <button
          key={group.groupId}
          type="button"
          aria-pressed={group.groupId === groupId}
          onClick={() => {
            onChange(group.groupId)
          }}
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            group.groupId === groupId ? 'bg-primary/15 font-semibold' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {group.label}
        </button>
      ))}
    </nav>
  )
}

/** Keep the selected group valid once groups load, defaulting to the first. */
function useResolvedGroupId(groups: InstrumentGroupSummary[], groupId: string | null, onChange: (id: string) => void) {
  useEffect(() => {
    if (groups.length === 0) return
    if (groupId && groups.some((group) => group.groupId === groupId)) return
    onChange(groups[0].groupId)
  }, [groups, groupId, onChange])
}

export interface InstrumentGroupsProps {
  transport: InstrumentGroupsTransport
}

export default function InstrumentGroups({ transport }: InstrumentGroupsProps) {
  const [selection, setSelection] = useGroupSelection()
  const query = useQuery({
    queryKey: ['markets', 'instrument-groups'],
    queryFn: ({ signal }) => transport.listGroups(signal),
    staleTime: 30_000,
  })

  const setGroupId = useCallback(
    (groupId: string) => {
      setSelection({ ...selection, groupId })
    },
    [selection, setSelection],
  )
  const setMode = useCallback(
    (mode: GroupMode) => {
      setSelection({ ...selection, mode })
    },
    [selection, setSelection],
  )

  const result = query.data

  const groups: InstrumentGroupSummary[] =
    result?.status === 'ready' || result?.status === 'stale' || result?.status === 'partial' ? result.groups : []
  useResolvedGroupId(groups, selection.groupId, setGroupId)

  if (query.isError) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        Instrument groups could not be loaded. This is not an empty result.
      </p>
    )
  }

  if (!result || result.status === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading your instrument groups…
      </p>
    )
  }

  if (result.status === 'unavailable') {
    return <FeaturePending feature="Instrument groups" reason={result.reason} />
  }

  if (result.status === 'denied') {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        You do not have permission to view instrument groups. {result.reason}
      </p>
    )
  }

  if (result.status === 'empty') {
    return (
      <p role="status" className="rounded-lg border border-dashed border-border/60 p-6 text-sm">
        You have not created any instrument groups yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {result.status === 'stale' && (
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          Showing groups as of {result.asOf}. This data is stale.
        </p>
      )}
      {result.status === 'partial' && (
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          Some groups could not be loaded: {result.failedGroupIds.join(', ')}.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <GroupTabs groups={groups} groupId={selection.groupId} onChange={setGroupId} />
        <ModeToggle mode={selection.mode} onChange={setMode} />
      </div>
    </div>
  )
}
