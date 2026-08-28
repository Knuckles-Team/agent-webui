/**
 * @file AtlasWorkbench.tsx
 * @description The four-region `/explore` workbench.
 *
 * Composition only: every decision lives in `useAtlas` (state + queries), the adapter
 * (what a modality is) or the renderer registry (how a result draws). This file's job
 * is layout and wiring, which is why it has no branching worth the name.
 */
import { useMemo } from 'react'

import { FilterBar } from './FilterBar'
import { InspectorPanel } from './InspectorPanel'
import { ModalityPicker } from './ModalityPicker'
import { QueryConsole } from './QueryConsole'
import { registerBuiltinRenderers } from './renderers'
import { ResultCanvas } from './ResultCanvas'
import { collectFields } from '@/lib/atlas/schema'
import { SourceTree } from './SourceTree'
import { useAtlas } from '@/lib/atlas/useAtlas'
import type { Pivot } from '@/lib/atlas/types'

// Renderers are a closed, lane-owned set; registering them at import keeps the
// registry populated before the first render regardless of which entry point mounts.
registerBuiltinRenderers()

function EmptyWorkbench() {
  return (
    <div className="text-muted-foreground p-8 text-center text-sm">
      No modality adapters are registered. Add one at <code>src/lib/atlas/adapters/</code>.
    </div>
  )
}

export function AtlasWorkbench() {
  const atlas = useAtlas()
  const { adapter, state, dispatch, projection, result } = atlas
  const fields = useMemo(() => collectFields(atlas.schema), [atlas.schema])
  const capabilities = useMemo(() => adapter?.capabilities() ?? null, [adapter])
  const pivots = useMemo<Pivot[]>(
    () => (adapter?.pivots && state.selection && result ? adapter.pivots({ selection: state.selection, result }) : []),
    [adapter, state.selection, result],
  )

  if (!adapter || !capabilities) return <EmptyWorkbench />

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-2" data-testid="atlas-workbench">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModalityPicker
          adapters={atlas.adapters}
          activeId={state.adapterId}
          onSelect={(adapterId) => {
            dispatch({ type: 'selectAdapter', adapterId })
          }}
        />
        <span className="text-muted-foreground text-xs">
          graph: {state.ctx.graph ?? 'union read (all accessible graphs)'}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        <div className="hidden min-h-0 rounded-md border lg:block">
          <SourceTree
            schema={atlas.schema}
            loading={atlas.schemaLoading}
            onSeed={(text) => {
              dispatch({ type: 'seedQuery', text })
            }}
          />
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="space-y-2 rounded-md border p-2">
            <QueryConsole
              text={atlas.consoleText}
              capabilities={capabilities}
              running={atlas.resultLoading}
              onChange={(text) => {
                dispatch({ type: 'setConsoleText', text })
              }}
              onRun={() => {
                dispatch({ type: 'run' })
              }}
            />
            <FilterBar
              filters={state.filters}
              fields={fields}
              capabilities={capabilities}
              onChange={(filters) => {
                dispatch({ type: 'setFilters', filters })
              }}
            />
            {capabilities.notes?.filters && (
              <p className="text-muted-foreground text-xs" data-testid="atlas-filter-note">
                {capabilities.notes.filters}
              </p>
            )}
          </div>
          <div className="min-h-0 flex-1 rounded-md border">
            <ResultCanvas
              projection={projection}
              adapter={adapter}
              ctx={state.ctx}
              accepting={atlas.renderers}
              renderer={atlas.renderer}
              loading={atlas.resultLoading}
              error={atlas.resultError}
              selection={state.selection}
              onSelect={atlas.select}
              onPickRenderer={(rendererId) => {
                dispatch({ type: 'setRenderer', rendererId })
              }}
            />
          </div>
        </div>

        <div className="hidden min-h-0 rounded-md border lg:block">
          <InspectorPanel
            selection={state.selection}
            pivots={pivots}
            onPivot={(pivot) => {
              dispatch({ type: 'applyPivot', pivot })
            }}
          />
        </div>
      </div>
    </div>
  )
}
