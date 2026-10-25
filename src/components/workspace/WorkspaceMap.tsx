import { useMemo, useState, type MouseEvent } from 'react'
import type { WorkspaceCommand } from './WorkspaceCommands'
import { workspaceBranchPath, workspaceCommandBranches, type WorkspaceBranch } from './workspace-command-branches'

function Destination({
  command,
  current,
  onSelect,
}: {
  command: WorkspaceCommand
  current: string | null
  onSelect: (href: string) => void
}) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onSelect(command.href)
  }
  return (
    <a
      className="workspace-map-node"
      href={command.href}
      aria-current={current === command.href ? 'location' : undefined}
      onClick={follow}
    >
      {command.label}
    </a>
  )
}

function Breadcrumbs({
  path,
  current,
  onSelect,
}: {
  path: WorkspaceBranch[]
  current: string | null
  onSelect: (href: string) => void
}) {
  return (
    <nav aria-label="Selected workspace path">
      <span className="workspace-frame-eyebrow">Selected path</span>
      <ol className="workspace-map-breadcrumbs">
        {path.map(({ command }, index) => (
          <li key={command.href}>
            <span className="workspace-path-step" aria-hidden="true">
              {index + 1}
            </span>
            <Destination command={command} current={current} onSelect={onSelect} />
          </li>
        ))}
      </ol>
    </nav>
  )
}

function shownDestinations(
  entries: readonly WorkspaceCommand[],
  branch: WorkspaceBranch | undefined,
  search: string,
  mode: string,
) {
  if (search || mode === 'list')
    return entries.filter((entry) => entry.label.toLowerCase().includes(search.toLowerCase()))
  return branch?.children.map((node) => node.command) ?? []
}

function mapView(
  roots: WorkspaceBranch[],
  entries: readonly WorkspaceCommand[],
  current: string | null,
  search: string,
  mode: string,
) {
  const path = workspaceBranchPath(roots, current)
  const location = current ? new URL(current, 'https://workspace.invalid') : null
  const contextPath = location?.pathname ?? null
  const root = roots.find((node) => node.command.href === contextPath)
  const selected = path.at(-1)
  const branch = selected?.children.length ? selected : (path.at(-2) ?? root)
  const shown = shownDestinations(entries, branch, search, mode)
  const collection =
    root && [...(location?.searchParams.keys() ?? [])].every((key) => ['q', 'lens', 'tool'].includes(key))
  return {
    path,
    root,
    branch,
    shown,
    unknown: !selected && !collection && current !== contextPath,
    map: mode === 'map' && !search,
  }
}

export function WorkspaceMap({
  entries,
  current,
  onSelect,
}: {
  entries: readonly WorkspaceCommand[]
  current: string | null
  onSelect: (href: string) => void
}) {
  const [mode, setMode] = useState<'map' | 'list'>('map')
  const [search, setSearch] = useState('')
  const roots = useMemo(() => workspaceCommandBranches(entries), [entries])
  const view = mapView(roots, entries, current, search, mode)
  return (
    <>
      <div className="workspace-map-context">
        <span className="workspace-frame-eyebrow">Current context</span>
        <strong>{view.root?.command.label ?? 'Workspace'}</strong>
      </div>
      <label className="workspace-map-search">
        Filter loaded destinations
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
          type="search"
        />
      </label>
      <div className="workspace-frame-actions" aria-label="Workspace map presentation">
        <button
          aria-pressed={mode === 'map'}
          onClick={() => {
            setMode('map')
          }}
        >
          Map
        </button>
        <button
          aria-pressed={mode === 'list'}
          onClick={() => {
            setMode('list')
          }}
        >
          List
        </button>
      </div>
      <Breadcrumbs path={view.path} current={current} onSelect={onSelect} />
      {view.unknown && (
        <p role="status">The selection is not in the loaded map. Its task surface remains available.</p>
      )}
      {view.map && view.branch && (
        <div className="workspace-map-parent">
          <span className="workspace-frame-eyebrow">
            {view.branch === view.root ? 'Context root' : 'Parent destination'}
          </span>
          <Destination command={view.branch.command} current={current} onSelect={onSelect} />
        </div>
      )}
      <ul className={view.map ? 'workspace-map-branches' : 'workspace-map-list'}>
        {view.shown.map((command) => (
          <li key={command.href}>
            <Destination command={command} current={current} onSelect={onSelect} />
          </li>
        ))}
      </ul>
      {!view.shown.length && (
        <p role="status">{search ? 'No matching loaded destinations.' : 'No further destinations are loaded here.'}</p>
      )}
      <details className="workspace-map-help">
        <summary>Map help</summary>
        <p>Loaded destinations. Your task stays beside the map.</p>
        <p>Native task controls remain available when a destination has not loaded.</p>
      </details>
    </>
  )
}
