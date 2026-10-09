/**
 * @file instrument-groups-state.ts
 * @description URL-param persistence for the selected instrument group and
 * Basic/Holdings mode (FUI-02), following `../view-state.ts`'s
 * `readFilters`/`writeFilters` convention: the URL is the source of truth
 * so a selection survives navigation and refresh. Kept local to this
 * component rather than added to the shared `view-state.ts` to avoid
 * touching a file another lane may be editing concurrently.
 */
import type { GroupMode } from './instrument-groups-transport'

export interface GroupSelection {
  groupId: string | null
  mode: GroupMode
}

const DEFAULT_MODE: GroupMode = 'basic'

export const DEFAULT_GROUP_SELECTION: GroupSelection = { groupId: null, mode: DEFAULT_MODE }

function oneOfMode(raw: string | null): GroupMode {
  return raw === 'holdings' ? 'holdings' : DEFAULT_MODE
}

export function readGroupSelection(search: URLSearchParams): GroupSelection {
  return { groupId: search.get('group'), mode: oneOfMode(search.get('mode')) }
}

export function writeGroupSelection(selection: GroupSelection, base: URLSearchParams): URLSearchParams {
  const search = new URLSearchParams(base)
  if (selection.groupId) {
    search.set('group', selection.groupId)
  } else {
    search.delete('group')
  }
  search.set('mode', selection.mode)
  return search
}
