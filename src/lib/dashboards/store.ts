/**
 * @file store.ts
 * @description Dashboard persistence (OVERSTORY-DASH-R011). Arbora's dashboard save
 * operations are not served yet (OVERSTORY-DASH-R010), so the interim store keeps
 * documents in browser local storage and reports every save as local and pending.
 * Storage failure never loses the in-memory document.
 */
import { DashboardSchema, type Dashboard } from './model'

export const STORAGE_KEY = 'agent-webui.dashboards.v1'

export type SaveStatus = 'saved-locally-pending-arbora' | 'not-saved'

export interface SaveResult {
  status: SaveStatus
  message: string
}

export interface DashboardStore {
  list(): Dashboard[]
  save(doc: Dashboard): SaveResult
  remove(id: string): SaveResult
}

export const LOCAL_PENDING_NOTICE =
  'Saved in this browser only. Saving to arbora is pending: the arbora dashboard operations are not available yet.'

function readAll(storage: Storage): Dashboard[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const result = DashboardSchema.safeParse(item)
      return result.success ? [result.data] : []
    })
  } catch {
    return []
  }
}

function writeAll(storage: Storage, docs: readonly Dashboard[]): SaveResult {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(docs))
    return { status: 'saved-locally-pending-arbora', message: LOCAL_PENDING_NOTICE }
  } catch {
    return { status: 'not-saved', message: 'Browser storage is unavailable. Changes stay in this page only.' }
  }
}

export function createLocalStore(storage: Storage | null = safeStorage()): DashboardStore {
  const unavailable: SaveResult = {
    status: 'not-saved',
    message: 'Browser storage is unavailable. Changes stay in this page only.',
  }
  return {
    list: () => (storage ? readAll(storage) : []),
    save(doc) {
      if (!storage) return unavailable
      return writeAll(storage, [...readAll(storage).filter((d) => d.id !== doc.id), doc])
    },
    remove(id) {
      if (!storage) return unavailable
      return writeAll(
        storage,
        readAll(storage).filter((d) => d.id !== id),
      )
    },
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
