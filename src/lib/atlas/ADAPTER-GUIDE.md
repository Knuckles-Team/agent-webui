# Writing an Atlas modality adapter

Atlas (`/explore`) is one workbench for every epistemic-graph modality. A modality is a
**file**: drop `src/lib/atlas/adapters/<id>.ts` with a default export satisfying
`ModalityAdapter` and it appears in the picker. You never edit a shared registry file —
discovery is `import.meta.glob` over that directory (`discover.ts`), which is what lets
several lanes add modalities concurrently without a merge conflict.

Atlas opens on the `graph` adapter when it is available. Adding an adapter may change
picker ordering, but it does not change that landing modality. If `graph` is unavailable,
Atlas falls back to the first discovered adapter.

Design rationale, projection rules and the modality inventory:
`plans/atlas/DESIGN-atlas.md` at the workspace root.

---

## The contract in one page

```ts
interface ModalityAdapter<Q = unknown, P = unknown> {
  readonly id: string          // lowercase, URL-safe, === your filename
  readonly label: string
  readonly description: string // one plain sentence, shown in the picker
  readonly icon: LucideIcon

  capabilities(): AdapterCapabilities
  introspect(request: IntrospectRequest): Promise<SchemaTree>          // { ctx, signal }
  compile(request: CompileRequest): Q                                   // { filters, ctx }
  describe(query: Q): string
  parse?(request: ParseRequest): Q                                      // { text, ctx }
  execute(request: ExecuteRequest<Q>): Promise<ResultSet<P>>            // { query, ctx, signal }
  toRows(result: ResultSet<P>): RowSet
  toGraph?(result: ResultSet<P>): GraphProjection
  pivots?(request: PivotRequest<P>): Pivot[]                            // { selection, result }
  readonly live?: LiveSource<P>
}
```

`Q` is your compiled query type, `P` your native payload. Both are opaque to everything
outside your file.

**Every multi-argument method takes ONE typed request object.** That is not a style
preference — see house rule 3 below. Destructure it in your implementation
(`async function execute({ query, signal }: ExecuteRequest<KvQuery>)`) and the call
reads the same as a positional one, without ever being able to grow into a positional
one.

---

## Skeleton

```ts
/**
 * @file adapters/kv.ts
 * @description Key-value namespaces and keys.
 */
import { KeyRound } from 'lucide-react'

import type { ExecuteRequest, ModalityAdapter } from '../adapter'
import { treeToGraph } from '../projection'
import { atlasGet } from '../transport'
import type { AdapterCapabilities, ResultSet, RowSet, SchemaTree } from '../types'
import { MINIMAL_FILTER_OPERATORS } from '../types'

const ID = 'kv'

interface KvQuery { prefix: string; limit: number }
interface KvPayload { entries: { key: string; size: number }[] }

const CAPABILITIES: AdapterCapabilities = {
  introspect: true,
  filters: MINIMAL_FILTER_OPERATORS,
  freeTextSearch: true,
  sort: false,
  rawQuery: false,          // no text language → the console renders read-only
  graphProjection: true,    // because toGraph is implemented below
  pivots: false,
  live: false,
  notes: { sort: 'The KV scan returns insertion order; there is no server-side sort.' },
}

async function execute({ query, signal }: ExecuteRequest<KvQuery>): Promise<ResultSet<KvPayload>> {
  const started = Date.now()
  const res = await atlasGet<KvPayload>(`/api/graph/kvcache?prefix=${encodeURIComponent(query.prefix)}`, signal)
  const payload = res.data ?? { entries: [] }
  return {
    adapterId: ID,
    shape: 'tree',
    payload,
    stats: { elapsedMs: Date.now() - started, rowCount: payload.entries.length, truncated: false },
    degraded: res.ok ? null : (res.error ?? 'KV surface unavailable.'),
    sources: [],
  }
}

const kvAdapter: ModalityAdapter<KvQuery, KvPayload> = {
  id: ID,
  label: 'Key-Value',
  description: 'Namespaced keys held in the engine cache.',
  icon: KeyRound,
  capabilities: () => CAPABILITIES,
  introspect: () => Promise.resolve({ adapterId: ID, roots: [], unavailable: true, note: 'No namespace listing route yet.' }),
  compile: ({ filters, ctx }) => ({ prefix: filters.search, limit: Math.min(filters.limit, ctx.limit) }),
  describe: (query) => `scan "${query.prefix}" limit ${String(query.limit)}`,
  execute,
  toRows: (result) => ({
    columns: [
      { key: 'key', label: 'key', type: 'string' },
      { key: 'size', label: 'size', type: 'number' },
    ],
    rows: result.payload.entries,
  }),
  toGraph: (result) => treeToGraph(keysToSchemaNodes(result.payload.entries)),
}

export default kvAdapter
```

Study the two reference adapters — they were written to be opposites, so between them
they demonstrate every branch of the interface:

| | `adapters/graph.ts` | `adapters/sparql.ts` |
|---|---|---|
| query language | none (`rawQuery: false`, no `parse`) | SPARQL (`rawQuery: true`, `parse` implemented) |
| filters | **client-side residual** + a `notes.filters` disclosure | **pushed down** into `FILTER(...)` |
| result shape | already a graph | bindings → `triplesToGraph` |
| `toGraph` | identity pass-through | derived |

---

## The nine rules

1. **Default-export the adapter.** Discovery reads `default` and structurally checks it
   (`isModalityAdapter`). A module without one is skipped, not an error — a helper file
   living in `adapters/` is harmless.

2. **Go through `transport.ts`, not bare `fetch`.** `atlasGet`/`atlasPost` carry
   `gateway.ts`'s honest-degradation rules: HTTP 404/501 and an au `degraded: true`
   body both resolve to `unavailable` rather than an exception, and the `{status,
   result}` action-twin envelope is unwrapped for you.

3. **Never conflate broken with empty.** A backend that cannot answer →
   `ResultSet.degraded = "<reason>"` (or `SchemaTree.unavailable = true`). A backend
   that answered with nothing → an empty result and `degraded: null`. These render
   differently on purpose; this codebase has shipped that defect twice.

4. **Declare `capabilities()` pessimistically.** Every `true` is a promise the UI keeps.
   An operator you leave out of `filters` is never offered to the user. If you filter
   **client-side**, say so in `notes.filters` — it is rendered under the filter bar,
   because "3 matches" over a truncated page is otherwise a lie.

5. **Honour `signal` and `ctx.limit`.** Every filter keystroke re-runs the query;
   without cancellation the last response to *arrive* wins rather than the last one
   asked for.

6. **`ctx.graph === null` means the union read — leave it alone.** The webui once
   pinned reads to the tenant graph and rendered 0 Tools while `__commons__` held 2,941.
   Read via the union; write to the tenant (Atlas does not write).

7. **Implement `toGraph` only if your modality is genuinely relational**, and reuse
   `projection.ts` (`rowsToGraph`, `triplesToGraph`, `treeToGraph`) rather than hand-
   rolling. Emit **closed** projections — the 3D model is CSR adjacency over array
   indices, so an edge whose endpoint is missing from `nodes` is silently dropped. A
   time series has no `toGraph`; that is correct, not a gap.

8. **Pivots are data, not callbacks.** Return `{targetAdapterId, filters, seedQuery?}`.
   The workbench applies it, and a declarative pivot is serialisable and testable.

9. **Live updates go through `LiveSource`, never your own `setInterval`.** And check
   `LiveCursor.gap`: `Method::CdcRead` is a **bounded ring**, so a gapped read means
   events were lost — surfacing it is how the user learns to reload.

---

## Tests

Add `src/lib/atlas/__tests__/<id>.test.ts` covering, at minimum:

- `capabilities()` — every `true` matches a member that actually exists
  (`graphProjection === (adapter.toGraph !== undefined)`, `rawQuery === (adapter.parse !== undefined)`);
- `compile()` output for a representative `FilterSet`;
- `execute()` on a stubbed happy response;
- `execute()` on a 404 → `degraded` set, no throw;
- `toRows()` columns and one row;
- `toGraph()` node/edge counts, if implemented.

Stub the network by assigning `global.fetch`, as the existing Atlas suites do.

---

## House rules

These three are binding on every adapter, and each one exists because the codebase has
already paid for its absence. Follow them even when the file is small — especially then,
because that is when they are cheap.

### 1. No machine-derived helper names

Every function you create gets a name derived from **what it does**. No ordinals, no
`handler_3`, no `dispatchCase07`, no `helperA`. Elsewhere in this program an extraction
pass produced 53 functions named `dispatch_case_NN_<thing>`; the ordinals have since
drifted, so those names now assert something false and the next reader has to check the
body to learn what any of them do.

If you cannot name a helper after its behaviour, the seam is in the wrong place — move
the boundary until you can. `fragmentFor`, `edgesAmong`, `toResultNodes`, `tripleTerm`
are the standard: a reader knows what each returns without opening it.

### 2. Do not inflate file length

Per-function complexity caps do not bound a FILE, and four files in this workspace now
exceed 11,000 lines because only the former was measured. Atlas is greenfield; keep it
that way.

Soft budgets, checked with `wc -l`:

| File | Budget |
|---|---|
| an adapter (`adapters/<id>.ts`) | **≤ 300 lines** |
| a lib module (`lib/atlas/*.ts`) | **≤ 300 lines** |
| a React component | **≤ 200 lines** |

The budget counts **code** modules. A declaration-only module (types, no functions) is
judged on whether it is ONE contract, not on its length: `types.ts` is 324 lines and
zero functions because splitting the contract every adapter imports would make it
harder to read, not easier. If `cccc` reports functions in your file, the budget applies.

Over budget means split by responsibility, not by line count: a big adapter usually
wants its wire types and its projections in a sibling module
(`adapters/<id>-wire.ts`, `adapters/<id>-projection.ts`) — discovery ignores modules
whose default export is not an adapter, so a sibling file in `adapters/` is free.
Never split a file just to get under a number; if the split has no name, it is not a split.

### 3. No wide parameter lists

Adapter methods take **one typed request object**, never positional arguments.
`introspect({ctx, signal})`, `compile({filters, ctx})`, `execute({query, ctx, signal})`,
`pivots({selection, result})`, `LiveSource.poll({query, cursor, ctx, signal})`.

The reason is measured, not aesthetic: agent-utilities currently carries **442 functions
with 8+ parameters and 143 with 12+, the worst at 49**, and every one of them began as a
two-parameter function that someone widened "just once". A request object makes widening
additive — a new field is ignored for free by every existing adapter and re-orders
nothing — so the interface cannot degrade that way.

Apply the same rule to your own helpers: **more than 3 parameters means introduce a
named options interface.** `rowsToGraph(rowSet, options)` and
`RowsToGraphOptions {keyColumn, labelColumn, typeColumn, linkColumns, defaultType, budget}`
is the pattern; six positional arguments would have been the alternative.

### 4. Complexity

Every function ≤ **10 cyclomatic** and ≤ **15 cognitive**, measured with
`plans/complex/bin/cccc <path>` — read the numbers it prints; there is no separate gate
script. Prefer a dispatch table (`Record<Operator, (…) => …>`) over a branch chain; both
metrics fall, which a flattened if/else chain does not do.
