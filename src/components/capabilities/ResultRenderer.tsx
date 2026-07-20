import type { ComponentType } from 'react'
import { Braces, ExternalLink, GitFork, Quote, Table2 } from 'lucide-react'

import type { CapabilityRenderer } from '../../lib/capabilities-api'
import { safeExternalUrl } from '../../lib/safe-url'
import { Badge } from '../ui/badge'

interface RendererProps {
  value: unknown
}

type RegisteredRenderer = 'json' | 'table' | 'evidence' | 'graph'

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function unwrapCapabilityResult(value: unknown): unknown {
  const object = asObject(value)
  if (object && 'result' in object && ('status' in object || Object.keys(object).length <= 2)) return object.result
  return value
}

function findArray(value: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[]
  const object = asObject(value)
  if (!object) return null
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key] as unknown[]
  }
  return null
}

function tableRows(value: unknown): Record<string, unknown>[] | null {
  const rows = findArray(value, ['rows', 'items', 'results', 'records', 'data'])
  if (!rows?.length || !rows.every((row) => Boolean(asObject(row)))) return null
  return rows as Record<string, unknown>[]
}

function evidenceRows(value: unknown): Record<string, unknown>[] | null {
  const rows = findArray(value, ['evidence', 'citations', 'sources', 'claims'])
  if (!rows?.length) return null
  const objects = rows.map(asObject).filter((item): item is Record<string, unknown> => Boolean(item))
  return objects.length ? objects : null
}

interface GraphShape {
  nodes: unknown[]
  edges: unknown[]
}

function graphShape(value: unknown): GraphShape | null {
  const object = asObject(value)
  if (!object) return null
  const nodes = Array.isArray(object.nodes) ? object.nodes : Array.isArray(object.vertices) ? object.vertices : null
  const edges = Array.isArray(object.edges)
    ? object.edges
    : Array.isArray(object.relationships)
      ? object.relationships
      : Array.isArray(object.links)
        ? object.links
        : null
  if (nodes || edges) return { nodes: nodes ?? [], edges: edges ?? [] }
  for (const key of ['graph', 'result', 'data']) {
    const nested = graphShape(object[key])
    if (nested) return nested
  }
  return null
}

/** Choose a registered renderer, falling back according to the actual payload shape. */
export function selectResultRenderer(hint: CapabilityRenderer | undefined, value: unknown): RegisteredRenderer {
  if (hint === 'graph' && graphShape(value)) return 'graph'
  if (hint === 'evidence' && evidenceRows(value)) return 'evidence'
  if (hint === 'table' && tableRows(value)) return 'table'
  if (graphShape(value)) return 'graph'
  if (evidenceRows(value)) return 'evidence'
  if (tableRows(value)) return 'table'
  return 'json'
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function JsonResult({ value }: RendererProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        <Braces className="size-3.5" /> JSON
      </div>
      <pre className="max-h-96 overflow-auto p-3 text-xs leading-relaxed">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function TableResult({ value }: RendererProps) {
  const rows = tableRows(value)
  if (!rows) return <JsonResult value={value} />
  const columns = Array.from(new Set(rows.slice(0, 50).flatMap((row) => Object.keys(row)))).slice(0, 10)
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-2">
          <Table2 className="size-3.5" /> Table
        </span>
        <span>{rows.length} rows</span>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full min-w-max text-left text-xs">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b">
              {columns.map((column) => (
                <th key={column} className="px-3 py-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((row, index) => (
              <tr key={index} className="border-b last:border-0 hover:bg-muted/30">
                {columns.map((column) => (
                  <td key={column} className="max-w-72 truncate px-3 py-2" title={compactValue(row[column])}>
                    {compactValue(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 200 && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">Showing first 200 rows.</div>
      )}
    </div>
  )
}

function EvidenceResult({ value }: RendererProps) {
  const rows = evidenceRows(value)
  if (!rows) return <JsonResult value={value} />
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Quote className="size-3.5" /> Evidence
        </span>
        <span>{rows.length} items</span>
      </div>
      {rows.slice(0, 50).map((row, index) => {
        const title = compactValue(row.title ?? row.label ?? row.source ?? `Evidence ${index + 1}`)
        const excerpt = compactValue(row.snippet ?? row.excerpt ?? row.content ?? row.claim ?? '')
        const url = safeExternalUrl(row.url ?? row.uri ?? row.href)
        const confidence = row.confidence ?? row.score
        return (
          <article key={index} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-sm">{title}</div>
              {confidence !== undefined && <Badge variant="outline">{compactValue(confidence)}</Badge>}
            </div>
            {excerpt && <p className="mt-1 text-sm text-muted-foreground">{excerpt}</p>}
            {url && (
              <a
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open source <ExternalLink className="size-3" />
              </a>
            )}
          </article>
        )
      })}
    </div>
  )
}

function graphItemLabel(value: unknown, fallback: string): string {
  const object = asObject(value)
  if (!object) return compactValue(value)
  return compactValue(object.label ?? object.name ?? object.title ?? object.id ?? fallback)
}

function GraphResult({ value }: RendererProps) {
  const shape = graphShape(value)
  if (!shape) return <JsonResult value={value} />
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <GitFork className="size-4" /> Graph result
        </span>
        <div className="flex gap-2">
          <Badge variant="secondary">{shape.nodes.length} nodes</Badge>
          <Badge variant="outline">{shape.edges.length} edges</Badge>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Nodes</div>
          <div className="space-y-1">
            {shape.nodes.slice(0, 12).map((node, index) => (
              <div key={index} className="truncate rounded bg-muted/40 px-2 py-1 text-xs" title={compactValue(node)}>
                {graphItemLabel(node, `Node ${index + 1}`)}
              </div>
            ))}
            {shape.nodes.length === 0 && <div className="text-xs text-muted-foreground">No nodes returned.</div>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Relationships</div>
          <div className="space-y-1">
            {shape.edges.slice(0, 12).map((edge, index) => (
              <div key={index} className="truncate rounded bg-muted/40 px-2 py-1 text-xs" title={compactValue(edge)}>
                {graphItemLabel(edge, `Edge ${index + 1}`)}
              </div>
            ))}
            {shape.edges.length === 0 && (
              <div className="text-xs text-muted-foreground">No relationships returned.</div>
            )}
          </div>
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Raw graph payload</summary>
        <div className="mt-2">
          <JsonResult value={value} />
        </div>
      </details>
    </div>
  )
}

const RESULT_RENDERER_REGISTRY: Record<RegisteredRenderer, ComponentType<RendererProps>> = {
  json: JsonResult,
  table: TableResult,
  evidence: EvidenceResult,
  graph: GraphResult,
}

interface ResultRendererProps {
  value: unknown
  hint?: CapabilityRenderer
}

export function ResultRenderer({ value, hint }: ResultRendererProps) {
  const unwrapped = unwrapCapabilityResult(value)
  const renderer = selectResultRenderer(hint, unwrapped)
  const Renderer = RESULT_RENDERER_REGISTRY[renderer]
  return <Renderer value={unwrapped} />
}
