/** One bounded session read shared by mounted identity consumers. */
import type { AuthSession } from './auth'
import { installCsrfToken } from './csrf'
import { IDENTITY_INVALIDATED, IDENTITY_STORAGE_KEY } from './identity-events'

interface SessionReply {
  session: AuthSession | null
  ssoConfigured: boolean
}
type Snapshot = SessionReply & { loading: boolean }
const initial: Snapshot = { session: null, ssoConfigured: false, loading: true }

export function createIdentitySession(read: (signal: AbortSignal) => Promise<SessionReply>) {
  const listeners = new Set<() => void>()
  let snapshot = initial
  let generation = 0
  let pending: Promise<void> | null = null
  let repeat = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function publish(value: Snapshot) {
    snapshot = value
    installCsrfToken(value.session?.csrf_token ?? null)
    listeners.forEach((listener) => {
      listener()
    })
  }

  function schedule() {
    clearTimeout(timer)
    const session = snapshot.session
    if (!session?.authenticated || session.mode === 'none') return
    const expires = session.expires_at
    const delay =
      typeof expires === 'number' && Number.isFinite(expires)
        ? Math.max(1000, Math.min(60_000, expires * 1000 - Date.now()))
        : 60_000
    timer = setTimeout(refresh, delay)
  }

  async function boundedRead(): Promise<SessionReply> {
    const controller = new AbortController()
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        read(controller.signal),
        new Promise<SessionReply>((resolve) => {
          deadline = setTimeout(() => {
            controller.abort()
            resolve({ session: null, ssoConfigured: false })
          }, 10_000)
        }),
      ])
    } catch {
      return { session: null, ssoConfigured: false }
    } finally {
      clearTimeout(deadline)
    }
  }

  function refresh(): void {
    if (pending || !listeners.size) return
    const current = generation
    pending = boundedRead()
      .then((reply) => {
        if (current !== generation || !listeners.size) return
        publish({ ...reply, loading: false })
        schedule()
      })
      .finally(() => {
        pending = null
        if (!repeat) return
        repeat = false
        refresh()
      })
  }

  function invalidate() {
    generation += 1
    clearTimeout(timer)
    publish({ session: null, ssoConfigured: snapshot.ssoConfigured, loading: false })
    repeat = pending !== null
    refresh()
  }

  function visible() {
    if (document.visibilityState === 'visible') refresh()
  }

  function storage(event: StorageEvent) {
    if (event.key === IDENTITY_STORAGE_KEY) invalidate()
  }

  function connect() {
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener(IDENTITY_INVALIDATED, invalidate)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', visible)
    refresh()
  }

  function disconnect() {
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
    window.removeEventListener(IDENTITY_INVALIDATED, invalidate)
    window.removeEventListener('storage', storage)
    document.removeEventListener('visibilitychange', visible)
    clearTimeout(timer)
    generation += 1
    snapshot = initial
    installCsrfToken(null)
    repeat = pending !== null
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      if (listeners.size === 1) connect()
      return () => {
        listeners.delete(listener)
        if (!listeners.size) disconnect()
      }
    },
  }
}
