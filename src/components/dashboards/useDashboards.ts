/**
 * @file useDashboards.ts
 * @description State for the Dashboards page: the open dashboard with undo history,
 * the saved list, the save status, the pending approval, and the controller the WebMCP
 * tools use. User and agent edits share one path (WEBUI-DASH-R006, R008, R009).
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  applyEdit,
  openDocument,
  redo as redoState,
  undo as undoState,
  type Actor,
  type HistoryState,
} from '@/lib/dashboards/history'
import { createDashboard, type Dashboard } from '@/lib/dashboards/model'
import { listNodeTypes, runPanelQuery } from '@/lib/dashboards/query'
import { createLocalStore, type DashboardStore, type SaveResult } from '@/lib/dashboards/store'
import type { DashboardController } from '@/lib/dashboards/tools'

export interface PendingApproval {
  message: string
}

export function useDashboards(store?: DashboardStore) {
  const storeRef = useRef<DashboardStore>(store ?? createLocalStore())
  const stateRef = useRef<HistoryState>(openDocument(null))
  const [state, setStateValue] = useState<HistoryState>(stateRef.current)
  const [saved, setSaved] = useState<Dashboard[]>(() => storeRef.current.list())
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null)
  const [pending, setPending] = useState<PendingApproval | null>(null)
  const resolverRef = useRef<((approved: boolean) => void) | null>(null)

  const persist = useCallback((doc: Dashboard | null) => {
    if (!doc) return
    setSaveResult(storeRef.current.save(doc))
    setSaved(storeRef.current.list())
  }, [])

  const commit = useCallback(
    (next: HistoryState) => {
      stateRef.current = next
      setStateValue(next)
      persist(next.doc)
    },
    [persist],
  )

  const edit = useCallback(
    (actor: Actor, label: string, change: (doc: Dashboard) => Dashboard): Dashboard => {
      const current = stateRef.current.doc
      if (!current) throw new Error('no dashboard is open')
      const after = change(current)
      commit(applyEdit(stateRef.current, actor, label, after))
      return after
    },
    [commit],
  )

  const create = useCallback(
    (actor: Actor, title: string): Dashboard => {
      const doc = createDashboard(
        title,
        storeRef.current.list().map((d) => d.id),
      )
      commit(applyEdit(stateRef.current, actor, `Created dashboard "${doc.title}"`, doc))
      return doc
    },
    [commit],
  )

  const open = useCallback((doc: Dashboard) => {
    stateRef.current = openDocument(doc)
    setStateValue(stateRef.current)
  }, [])

  const remove = useCallback((id: string) => {
    setSaveResult(storeRef.current.remove(id))
    setSaved(storeRef.current.list())
    if (stateRef.current.doc?.id === id) {
      stateRef.current = openDocument(null)
      setStateValue(stateRef.current)
    }
  }, [])

  const undo = useCallback(() => {
    commit(undoState(stateRef.current))
  }, [commit])
  const redo = useCallback(() => {
    commit(redoState(stateRef.current))
  }, [commit])

  const requestApproval = useCallback((message: string, signal?: AbortSignal): Promise<boolean> => {
    resolverRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        resolverRef.current = null
        setPending(null)
        resolve(approved)
      }
      resolverRef.current = finish
      setPending({ message })
      signal?.addEventListener('abort', () => {
        finish(false)
      })
    })
  }, [])

  const answer = useCallback((approved: boolean) => {
    resolverRef.current?.(approved)
  }, [])

  const controller = useMemo<DashboardController>(
    () => ({
      current: () => stateRef.current.doc,
      create: (title) => create('agent', title),
      edit: (label, change) => edit('agent', label, change),
      confirm: (message, signal) => requestApproval(message, signal),
      runQuery: (text, signal) =>
        runPanelQuery({ query: { kind: 'uql', text } }, stateRef.current.doc?.params ?? [], signal),
      listSources: listNodeTypes,
    }),
    [create, edit, requestApproval],
  )

  return {
    state,
    saved,
    saveResult,
    pending,
    controller,
    edit,
    create,
    open,
    remove,
    undo,
    redo,
    requestApproval,
    answer,
  }
}
