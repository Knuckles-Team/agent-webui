import { workApi } from '@/lib/work-workspace'

/** Admission-owned locks survive task selection and status changes. */
export function createTaskCancellation() {
  const pending = new Set<string>()
  const listeners = new Set<() => void>()
  let active = false
  function notify() {
    for (const listener of listeners) listener()
  }
  return {
    activate() {
      active = true
    },
    retire() {
      active = false
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isPending(taskId: string) {
      return pending.has(taskId)
    },
    async cancel(taskId: string) {
      if (!active) throw new Error('Work admission is stale')
      if (pending.has(taskId)) return false
      pending.add(taskId)
      notify()
      try {
        await workApi.cancelTask(taskId)
        return true
      } finally {
        pending.delete(taskId)
        notify()
      }
    },
  }
}
export type TaskCancellation = ReturnType<typeof createTaskCancellation>
