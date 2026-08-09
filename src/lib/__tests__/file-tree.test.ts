import { describe, it, expect } from 'vitest'
import { ancestorPaths, buildFileTree, matchingPaths, type FileTreeEntry } from '@/lib/file-tree'

const ENTRIES: FileTreeEntry[] = [
  { name: 'src', isDir: true },
  { name: 'src/components', isDir: true },
  { name: 'src/components/App.tsx', isDir: false, size: 120 },
  { name: 'src/components/Button.tsx', isDir: false, size: 40 },
  { name: 'src/index.ts', isDir: false, size: 10 },
  { name: 'README.md', isDir: false, size: 5 },
  { name: 'docs', isDir: true },
]

describe('buildFileTree', () => {
  it('nests entries under their parent directory', () => {
    const tree = buildFileTree(ENTRIES)
    const src = tree.find((n) => n.path === 'src')
    expect(src).toBeDefined()
    expect(src?.isDir).toBe(true)
    const components = src?.children.find((n) => n.path === 'src/components')
    expect(components?.children.map((c) => c.path).sort()).toEqual([
      'src/components/App.tsx',
      'src/components/Button.tsx',
    ])
  })

  it('sorts directories before files, then alphabetically', () => {
    const tree = buildFileTree(ENTRIES)
    // Roots: README.md, docs, src -> dirs first (docs, src), then files (README.md)
    expect(tree.map((n) => n.path)).toEqual(['docs', 'src', 'README.md'])
  })

  it('carries size/modified metadata onto the matching node', () => {
    const tree = buildFileTree(ENTRIES)
    const src = tree.find((n) => n.path === 'src')
    const indexTs = src?.children.find((n) => n.path === 'src/index.ts')
    expect(indexTs?.size).toBe(10)
  })

  it('synthesizes missing ancestor directories rather than dropping a truncated child', () => {
    // No 'a' or 'a/b' entries at all -- only the deep file.
    const tree = buildFileTree([{ name: 'a/b/c.py', isDir: false }])
    expect(tree).toHaveLength(1)
    expect(tree[0].path).toBe('a')
    expect(tree[0].isDir).toBe(true)
    const b = tree[0].children[0]
    expect(b.path).toBe('a/b')
    const c = b.children[0]
    expect(c.path).toBe('a/b/c.py')
    expect(c.isDir).toBe(false)
  })

  it('returns an empty tree for an empty listing', () => {
    expect(buildFileTree([])).toEqual([])
  })

  it('ignores blank-name entries', () => {
    expect(buildFileTree([{ name: '   ' }, { name: 'a.txt' }])).toHaveLength(1)
  })
})

describe('ancestorPaths', () => {
  it('lists every ancestor, root-most first', () => {
    expect(ancestorPaths('a/b/c.py')).toEqual(['a', 'a/b'])
  })

  it('is empty for a root-level path', () => {
    expect(ancestorPaths('a.py')).toEqual([])
  })
})

describe('matchingPaths', () => {
  it('returns null for a blank query (no filter)', () => {
    expect(matchingPaths(ENTRIES, '')).toBeNull()
    expect(matchingPaths(ENTRIES, '   ')).toBeNull()
  })

  it('matches case-insensitively on the full path', () => {
    const visible = matchingPaths(ENTRIES, 'button')
    expect(visible?.has('src/components/Button.tsx')).toBe(true)
  })

  it('includes every ancestor directory of a match so the tree can auto-expand to it', () => {
    const visible = matchingPaths(ENTRIES, 'Button')
    expect(visible?.has('src')).toBe(true)
    expect(visible?.has('src/components')).toBe(true)
  })

  it('excludes entries that do not match', () => {
    const visible = matchingPaths(ENTRIES, 'Button')
    expect(visible?.has('README.md')).toBe(false)
    expect(visible?.has('docs')).toBe(false)
  })
})
