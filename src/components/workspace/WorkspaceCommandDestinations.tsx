import { useState } from 'react'
import { WorkspaceCommandBranches } from './WorkspaceCommandBranches'
import type { WorkspaceCommand } from './WorkspaceCommands'

/** Branch and list presentations share one bounded destination selection. */
export function WorkspaceCommandDestinations({
  entries,
  search,
  onSelect,
}: {
  entries: readonly WorkspaceCommand[]
  search: string
  onSelect: (href: string) => void
}) {
  const [layout, setLayout] = useState<'list' | 'branches'>('list')
  const matches = entries.filter((entry) => entry.label.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <div aria-label="Destination layout" className="flex flex-wrap gap-1">
        {(['list', 'branches'] as const).map((value) => (
          <button
            key={value}
            className="min-h-11 rounded border px-3 capitalize"
            aria-pressed={layout === value}
            onClick={() => {
              setLayout(value)
            }}
          >
            {value === 'list' ? 'List' : 'Branches'}
          </button>
        ))}
      </div>
      <div hidden={layout !== 'branches' || Boolean(search)}>
        <WorkspaceCommandBranches entries={entries} onSelect={onSelect} visible={layout === 'branches' && !search} />
      </div>
      {(layout === 'list' || search) && (
        <ul className="space-y-1">
          {matches.map((entry) => (
            <li key={entry.href}>
              <a
                className="block min-h-11 rounded border px-3 py-2 break-words"
                href={entry.href}
                onClick={(event) => {
                  if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  onSelect(entry.href)
                }}
              >
                {entry.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      {!matches.length && <p role="status">No matching available destinations.</p>}
    </>
  )
}
