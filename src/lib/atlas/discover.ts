/**
 * @file discover.ts
 * @description Auto-discovery of modality adapters — the reason adding a modality
 * never means editing a shared file.
 *
 * `import.meta.glob` is resolved by Vite at BUILD time (and by vitest, which runs on
 * Vite), so every `src/lib/atlas/adapters/*.ts` with a default export satisfying
 * {@link isModalityAdapter} is registered automatically. Concurrent lanes can each add
 * a modality without a merge conflict and without one lane's file ever being the
 * bottleneck for another's.
 *
 * Modules whose default export is not an adapter (a shared helper dropped in the
 * folder, a type-only module) are ignored rather than throwing — a bad neighbour must
 * not take the explorer down.
 */
import { isModalityAdapter, type ModalityAdapter } from './adapter'
import { Registry } from './registry'

export const adapterRegistry = new Registry<ModalityAdapter>()

/** Pull the default export out of a glob-imported module, if it is an adapter. */
function adapterFromModule(module: unknown): ModalityAdapter | null {
  if (!module || typeof module !== 'object') return null
  const candidate = (module as { default?: unknown }).default
  return isModalityAdapter(candidate) ? candidate : null
}

/**
 * Register every adapter module in `./adapters/`. Idempotent (registration is keyed
 * by id), so a second call after a hot reload or in a second test suite is harmless.
 */
export function discoverAdapters(registry: Registry<ModalityAdapter> = adapterRegistry): ModalityAdapter[] {
  const modules = import.meta.glob('./adapters/*.ts', { eager: true })
  const found: ModalityAdapter[] = []
  for (const module of Object.values(modules)) {
    const adapter = adapterFromModule(module)
    if (adapter) {
      registry.register(adapter)
      found.push(adapter)
    }
  }
  return found.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Discovery, memoised. Every entry point (`AtlasView`, the workbench hook, a test)
 * calls this; the glob work happens once per module graph.
 */
let discovered: ModalityAdapter[] | null = null

export function atlasAdapters(): ModalityAdapter[] {
  discovered ??= discoverAdapters()
  return discovered
}

/** Test affordance: forget the memoised discovery so a suite can re-run it. */
export function resetAdapterDiscovery(): void {
  discovered = null
}
