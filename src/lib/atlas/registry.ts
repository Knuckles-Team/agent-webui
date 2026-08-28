/**
 * @file registry.ts
 * @description The two Atlas registries (modalities, renderers) over one tiny generic.
 *
 * Registration is idempotent by id: re-registering the same id replaces the entry.
 * That is what makes `discover.ts`'s eager glob safe to run more than once (vitest
 * re-imports modules per suite) and lets a test swap in a fake adapter without
 * mutating module-level arrays.
 */

export interface Identified {
  readonly id: string
}

/** An insertion-ordered, id-keyed collection. Deliberately not reactive — see `useAtlasWorkbench`. */
export class Registry<T extends Identified> {
  private readonly items = new Map<string, T>()

  register(item: T): void {
    this.items.set(item.id, item)
  }

  registerAll(items: readonly T[]): void {
    for (const item of items) this.register(item)
  }

  get(id: string | null | undefined): T | null {
    if (!id) return null
    return this.items.get(id) ?? null
  }

  has(id: string): boolean {
    return this.items.has(id)
  }

  /** Registration order. */
  list(): T[] {
    return [...this.items.values()]
  }

  get size(): number {
    return this.items.size
  }

  /** Test affordance only — production code never unregisters a modality. */
  clear(): void {
    this.items.clear()
  }
}
