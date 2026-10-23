import { describe, expect, it } from 'vitest'
import { createDashboard } from '../model'
import { createLocalStore, LOCAL_PENDING_NOTICE } from '../store'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  failWrites = false
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('quota')
    this.map.set(key, value)
  }
}

// spec: WEBUI-DASH-R011
describe('local dashboard store (WEBUI-DASH-R011)', () => {
  it('saves locally and labels the save as pending arbora', () => {
    const store = createLocalStore(new MemoryStorage())
    const result = store.save(createDashboard('One'))
    expect(result).toEqual({ status: 'saved-locally-pending-arbora', message: LOCAL_PENDING_NOTICE })
    expect(store.list().map((d) => d.id)).toEqual(['one'])
    store.remove('one')
    expect(store.list()).toEqual([])
  })

  it('drops invalid stored documents and reports storage failure', () => {
    const storage = new MemoryStorage()
    storage.setItem('agent-webui.dashboards.v1', JSON.stringify([{ nope: true }]))
    const store = createLocalStore(storage)
    expect(store.list()).toEqual([])
    storage.failWrites = true
    expect(store.save(createDashboard('x')).status).toBe('not-saved')
    expect(createLocalStore(null).save(createDashboard('x')).status).toBe('not-saved')
  })
})
