/**
 * @file file-tree.ts
 * @description Pure helpers for turning the flat `/api/enhanced/files` listing
 * into a nested tree `FilesView` renders as a collapsible explorer (W-4).
 *
 * The backend (`agent_webui/api_extensions.py::list_files`) walks the
 * workspace recursively and returns every file AND every directory it visits
 * as its own flat record, `name` carrying the path relative to the workspace
 * root (e.g. `src/components/App.tsx`). Building the nesting is therefore a
 * pure client-side transform with no extra network round-trips.
 *
 * Kept dependency-free and side-effect-free so it is unit-testable without
 * mounting the component, and so `FilesView`'s render stays a thin consumer.
 */

export interface FileTreeEntry {
  name: string
  size?: number
  modified?: string
  isDir?: boolean
}

export interface FileTreeNode {
  /** Full path relative to the workspace root, e.g. `src/components`. */
  path: string
  /** Just this node's own path segment, e.g. `components`. */
  segment: string
  isDir: boolean
  size?: number
  modified?: string
  children: FileTreeNode[]
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

function segmentOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

/**
 * Build a nested tree from the flat listing.
 *
 * Every directory the backend's `os.walk` traversal visited is present as
 * its own entry, so the common case needs no inference -- but the endpoint
 * accepts a `limit` and can be truncated mid-walk, which can list a file
 * whose parent directory entry didn't make the cut. Rather than silently
 * dropping that file, its ancestor directories are synthesized here as
 * metadata-less placeholder nodes.
 */
export function buildFileTree(entries: FileTreeEntry[]): FileTreeNode[] {
  const nodes = new Map<string, FileTreeNode>()

  function ensure(path: string): FileTreeNode {
    const existing = nodes.get(path)
    if (existing) return existing
    const node: FileTreeNode = { path, segment: segmentOf(path), isDir: true, children: [] }
    nodes.set(path, node)
    const parent = parentPath(path)
    if (parent) ensure(parent).children.push(node)
    return node
  }

  for (const entry of entries) {
    const name = entry.name.trim()
    if (!name) continue
    const node = ensure(name)
    node.isDir = entry.isDir ?? node.isDir
    node.size = entry.size
    node.modified = entry.modified
  }

  const roots = [...nodes.values()].filter((node) => parentPath(node.path) === '')
  sortTree(roots)
  return roots
}

function sortTree(nodes: FileTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.segment.localeCompare(b.segment, undefined, { sensitivity: 'base' })
  })
  for (const node of nodes) sortTree(node.children)
}

/** Every ancestor directory path of `path`, root-most first — e.g.
 * `a/b/c.py` -> `['a', 'a/b']`. */
export function ancestorPaths(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join('/'))
  }
  return out
}

/**
 * Paths that should stay visible under a case-insensitive substring search
 * over the full path -- every entry whose path matches, plus every ancestor
 * directory of a match (so the tree can auto-expand a route to each result).
 * Returns `null` for a blank query, meaning "no filter, show everything".
 */
export function matchingPaths(entries: FileTreeEntry[], query: string): Set<string> | null {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return null
  const visible = new Set<string>()
  for (const entry of entries) {
    if (!entry.name.toLowerCase().includes(trimmed)) continue
    visible.add(entry.name)
    for (const ancestor of ancestorPaths(entry.name)) visible.add(ancestor)
  }
  return visible
}
