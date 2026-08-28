/**
 * @file schema.ts
 * @description Pure helpers over a {@link SchemaTree}: the search filter the source
 * panel uses, and the field list the filter bar offers.
 *
 * The filter bar offers ONLY fields the adapter's own `introspect` advertised. That is
 * what stops a user building a clause on a field the modality has never heard of and
 * then wondering why it silently matched nothing.
 */
import type { FilterValueType, SchemaNode, SchemaTree } from './types'

/** Every `field`-kind node in the tree, depth-first, de-duplicated by id. */
export function collectFields(tree: SchemaTree): SchemaNode[] {
  const found = new Map<string, SchemaNode>()
  const visit = (node: SchemaNode): void => {
    if (node.kind === 'field' && !found.has(node.id)) found.set(node.id, node)
    for (const child of node.children ?? []) visit(child)
  }
  for (const root of tree.roots) visit(root)
  return [...found.values()]
}

/** The declared type of `field`, or `'unknown'` when the adapter did not say. */
export function fieldType(fields: readonly SchemaNode[], field: string): FilterValueType {
  return fields.find((node) => node.id === field)?.dataType ?? 'unknown'
}

function matches(node: SchemaNode, needle: string): boolean {
  return node.label.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle)
}

/**
 * Prune the tree to branches containing a match, keeping ancestors so the hit stays
 * in context. An empty query returns the roots untouched (same array identity).
 */
export function searchSchema(roots: readonly SchemaNode[], query: string): SchemaNode[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...roots]
  return roots.flatMap((node) => pruneNode(node, needle))
}

function pruneNode(node: SchemaNode, needle: string): SchemaNode[] {
  const children = (node.children ?? []).flatMap((child) => pruneNode(child, needle))
  if (matches(node, needle)) return [{ ...node, children: node.children }]
  if (children.length > 0) return [{ ...node, children }]
  return []
}

/** Total nodes in the tree — the source panel's "N sources" line. */
export function countSchemaNodes(roots: readonly SchemaNode[]): number {
  return roots.reduce((total, node) => total + 1 + countSchemaNodes(node.children ?? []), 0)
}
