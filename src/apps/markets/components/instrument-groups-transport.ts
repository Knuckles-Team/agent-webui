/**
 * @file instrument-groups-transport.ts
 * @description The one data-access seam `InstrumentGroups` depends on
 * (FUI-02), following the same split as `src/components/decisions/decisions-transport.ts`
 * and `src/lib/kg-lod/contract.ts`'s `LodTransport`: a typed interface the
 * view is written against, kept separate from any one implementation. No
 * production implementation is wired up here — this repository's groups
 * live on `EG-FINANCE-PRIMITIVES-R004` (epistemic-graph finance-v1 accounts
 * and reference sessions), which is PENDING per
 * `specs/finance-asset-manager/tasks.md`. `InstrumentGroups` therefore takes
 * an `InstrumentGroupsTransport` as a required prop with no default; tests
 * inject an explicit fixture transport, and wiring a real implementation is
 * left for future work once that backend lands.
 */

export type GroupMode = 'basic' | 'holdings'

export interface InstrumentGroupSummary {
  groupId: string
  label: string
}

/**
 * The six distinguishable outcomes of fetching the user's instrument
 * groups, plus the ordinary fresh-data case. Each must render its own
 * distinct, correctly labeled text — never collapsed into another.
 */
export type InstrumentGroupsResult =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; groups: InstrumentGroupSummary[] }
  | { status: 'stale'; groups: InstrumentGroupSummary[]; asOf: string }
  | { status: 'partial'; groups: InstrumentGroupSummary[]; failedGroupIds: string[] }
  | { status: 'denied'; reason: string }
  | { status: 'unavailable'; reason: string }

export interface InstrumentGroupsTransport {
  /** The caller's user-defined instrument groups, in one of the states above. */
  listGroups(signal?: AbortSignal): Promise<InstrumentGroupsResult>
}
