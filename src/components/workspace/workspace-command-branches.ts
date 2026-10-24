import { operateHref, parseOperateState } from '@/lib/operate-workspace'
import { parseWorkState, workHref } from '@/lib/work-workspace'
import type { WorkspaceCommand } from './WorkspaceCommands'

export interface WorkspaceBranch {
  command: WorkspaceCommand
  children: WorkspaceBranch[]
}

/** Present only relationships already encoded by loaded, validated destinations. */
export function workspaceCommandBranches(entries: readonly WorkspaceCommand[]): WorkspaceBranch[] {
  const nodes = new Map<string, WorkspaceBranch>(entries.map((command) => [command.href, { command, children: [] }]))
  const roots: WorkspaceBranch[] = []
  for (const node of nodes.values()) {
    const parent = workspaceCommandParent(node.command, nodes)
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** A retired entry cannot retain an obsolete breadcrumb or descendant catalog. */
export function workspaceBranchPath(roots: readonly WorkspaceBranch[], href: string | null): WorkspaceBranch[] {
  if (href === null) return []
  for (const node of roots) {
    if (node.command.href === href) return [node]
    const child = workspaceBranchPath(node.children, href)
    if (child.length) return [node, ...child]
  }
  return []
}

function workspaceCommandParent(command: WorkspaceCommand, nodes: ReadonlyMap<string, WorkspaceBranch>) {
  const { href, id } = command
  const path = new URL(href, 'https://workspace.invalid').pathname
  let parent = nodes.get(path)
  if (path === '/workspace/operate' && id.startsWith('capability:')) {
    const state = parseOperateState(href)
    const server = nodes.get(operateHref({ ...state, item: null }))
    if (server?.command.id.startsWith('server:')) parent = server
  } else if (path === '/workspace/work' && id.startsWith('node:')) {
    const state = parseWorkState(href)
    const trace = nodes.get(workHref({ ...state, node: null }))
    if (trace?.command.id.startsWith('trace:')) parent = trace
  }
  return parent
}
