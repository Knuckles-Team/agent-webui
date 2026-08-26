/**
 * @file rng.ts
 * @description Small deterministic hashing/PRNG helpers shared by
 * `mockTransport.ts` and `lodGraph.ts`.
 *
 * Same `splitmix32` construction `layout.worker.ts` uses for layout jitter,
 * pulled out here so the LOD layer can derive independent, deterministic
 * random streams FROM A STRING KEY (a cluster id) rather than from a single
 * numeric seed threaded through call order. That is what lets the mock
 * transport be a pure function of `(graph, level, parentClusterId)` /
 * `(graph, clusterId)` — the same request always answers the same way, with
 * no server-side session state, which is the property a stateless HTTP
 * backend would have too.
 */

/** FNV-1a — cheap, well-distributed enough to seed `splitmix32` from a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A deterministic `() => [0, 1)` PRNG seeded from a 32-bit integer. */
export function splitmix32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x9e3779b9) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad)
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97)
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296
  }
}

/** A PRNG stream keyed by an arbitrary string — the building block below. */
export function rngFor(key: string): () => number {
  return splitmix32(hashString(key))
}

/** Integer in `[min, max]`, inclusive, drawn from `rng`. */
export function randInt(rng: () => number, min: number, max: number): number {
  if (max <= min) return min
  return min + Math.floor(rng() * (max - min + 1))
}

/** One element of `items`, drawn from `rng`. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}
