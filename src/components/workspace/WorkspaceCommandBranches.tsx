import { workspaceButtonClass } from '@/components/ui/button'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { workspaceBranchPath, workspaceCommandBranches, type WorkspaceBranch } from './workspace-command-branches'
import type { WorkspaceCommand } from './WorkspaceCommands'

export function WorkspaceCommandBranches({
  entries,
  onSelect,
  visible,
}: {
  entries: readonly WorkspaceCommand[]
  onSelect: (href: string) => void
  visible: boolean
}) {
  const roots = useMemo(() => workspaceCommandBranches(entries), [entries])
  const [selected, setSelected] = useState<string | null>(null)
  const path = workspaceBranchPath(roots, selected)
  const current = path.at(-1)
  const children = current?.children ?? roots
  const heading = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef(false)
  const currentHref = current?.command.href ?? null
  useLayoutEffect(() => {
    if (pendingFocus.current || selected !== currentHref) {
      if (visible) heading.current?.focus()
      pendingFocus.current = false
    }
    if (selected !== currentHref) setSelected(currentHref)
  }, [selected, currentHref, visible])

  function browse(href: string | null) {
    if (href === currentHref) {
      heading.current?.focus()
      return
    }
    pendingFocus.current = true
    setSelected(href)
  }

  return (
    <section aria-label="Workspace branch map" className="min-w-0 space-y-3">
      <BranchBreadcrumbs path={path} onBrowse={browse} />
      <h3 ref={heading} tabIndex={-1} className="rounded text-base font-semibold break-words focus-visible:outline">
        {current ? `${current.command.label} destinations` : 'Workspace contexts'}
      </h3>
      <p className="text-sm text-muted-foreground">Loaded destinations only. Open a surface or browse its branches.</p>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2">
        {(current ? [current, ...children] : children).map((node) => (
          <BranchCard
            key={node.command.href}
            node={node}
            isCurrent={node === current}
            onBrowse={browse}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {current && (
        <button
          className={workspaceButtonClass}
          onClick={() => {
            browse(path.at(-2)?.command.href ?? null)
          }}
        >
          Back to {path.at(-2)?.command.label ?? 'Workspace'}
        </button>
      )}
    </section>
  )
}

function BranchCard({
  node,
  isCurrent,
  onBrowse,
  onSelect,
}: {
  node: WorkspaceBranch
  isCurrent: boolean
  onBrowse: (href: string) => void
  onSelect: (href: string) => void
}) {
  return (
    <li className="min-w-0 rounded border border-l-4 border-l-primary p-2">
      <a
        className="flex min-h-11 items-center rounded px-2 break-words hover:bg-accent"
        href={node.command.href}
        onClick={(event) => {
          if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          onSelect(node.command.href)
        }}
      >
        {node.command.label}
      </a>
      {!isCurrent && node.children.length > 0 && (
        <button
          className={`${workspaceButtonClass} mt-1 w-full justify-start text-left`}
          aria-label={`Browse ${node.command.label}`}
          onClick={() => {
            onBrowse(node.command.href)
          }}
        >
          Browse {node.children.length} {node.children.length === 1 ? 'branch' : 'branches'}
        </button>
      )}
    </li>
  )
}

function BranchBreadcrumbs({
  path,
  onBrowse,
}: {
  path: readonly WorkspaceBranch[]
  onBrowse: (href: string | null) => void
}) {
  return (
    <nav aria-label="Workspace branch breadcrumbs">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        <li>
          <button
            className={workspaceButtonClass}
            aria-current={path.length === 0 ? 'location' : undefined}
            onClick={() => {
              onBrowse(null)
            }}
          >
            Workspace
          </button>
        </li>
        {path.map(({ command }, index) => (
          <li key={command.href} className="flex min-w-0 items-center gap-1">
            <span aria-hidden="true">/</span>
            <button
              className={workspaceButtonClass}
              aria-current={index === path.length - 1 ? 'location' : undefined}
              onClick={() => {
                onBrowse(command.href)
              }}
            >
              {command.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
