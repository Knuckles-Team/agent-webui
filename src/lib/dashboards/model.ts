/**
 * @file model.ts
 * @description The dashboard document (WEBUI-DASH-R001): a declarative, versioned grid
 * of panels, each a query plus a visualization. All edits are pure functions that
 * return a new document with revision + 1, so user edits, agent edits and undo share
 * one path. No I/O lives here.
 */
import { z } from 'zod'

export const GRID_COLUMNS = 12
export const MAX_PANELS = 24
export const VIZ_KINDS = ['table', 'line', 'bar', 'kpi'] as const
export type VizKind = (typeof VIZ_KINDS)[number]

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
const textSchema = (max: number) => z.string().trim().min(1).max(max)

export const LayoutSchema = z.strictObject({
  x: z
    .number()
    .int()
    .min(0)
    .max(GRID_COLUMNS - 1),
  y: z.number().int().min(0).max(1_000),
  w: z.number().int().min(1).max(GRID_COLUMNS),
  h: z.number().int().min(1).max(12),
})
export type Layout = z.infer<typeof LayoutSchema>

export const QuerySchema = z.strictObject({
  kind: z.literal('uql'),
  text: z.string().trim().min(1).max(2_000),
})
export type PanelQuery = z.infer<typeof QuerySchema>

export const PanelOptionsSchema = z.strictObject({
  /** Column drawn on the x axis, or used as the label column. */
  x: z.string().max(128).optional(),
  /** Column drawn on the y axis, or used as the KPI value. */
  y: z.string().max(128).optional(),
})
export type PanelOptions = z.infer<typeof PanelOptionsSchema>

export const PanelSchema = z.strictObject({
  id: idSchema,
  title: textSchema(120),
  viz: z.enum(VIZ_KINDS),
  query: QuerySchema,
  layout: LayoutSchema,
  options: PanelOptionsSchema,
})
export type Panel = z.infer<typeof PanelSchema>

export const ParamSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  label: textSchema(60),
  type: z.enum(['text', 'number']),
  value: z.union([z.string().max(128), z.number()]),
})
export type Param = z.infer<typeof ParamSchema>

export const DashboardSchema = z
  .strictObject({
    schema_version: z.literal(1),
    id: idSchema,
    title: textSchema(120),
    revision: z.number().int().min(0),
    params: z.array(ParamSchema).max(8),
    panels: z.array(PanelSchema).max(MAX_PANELS),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>()
    for (const [index, panel] of doc.panels.entries()) {
      if (seen.has(panel.id))
        ctx.addIssue({ code: 'custom', path: ['panels', index, 'id'], message: 'duplicate panel id' })
      seen.add(panel.id)
      if (panel.layout.x + panel.layout.w > GRID_COLUMNS) {
        ctx.addIssue({ code: 'custom', path: ['panels', index, 'layout'], message: 'panel exceeds the grid width' })
      }
    }
  })
export type Dashboard = z.infer<typeof DashboardSchema>

export class DashboardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DashboardError'
  }
}

/** Lowercase slug usable as an id; falls back to a prefix and counter. */
export function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : fallback
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; n < 1_000; n += 1) {
    const candidate = `${base}-${String(n)}`
    if (!taken.has(candidate)) return candidate
  }
  throw new DashboardError('could not allocate a unique id')
}

/** Validate then bump the revision; every edit funnels through here. */
function commit(next: Omit<Dashboard, 'revision'>, previous: Dashboard): Dashboard {
  const parsed = DashboardSchema.safeParse({ ...next, revision: previous.revision + 1 })
  if (!parsed.success) {
    const issue = parsed.error.issues.at(0)
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    throw new DashboardError(`invalid dashboard: ${where}${issue?.message ?? 'unknown'}`)
  }
  return parsed.data
}

export function createDashboard(title: string, existingIds: readonly string[] = []): Dashboard {
  const id = uniqueId(slugify(title, 'dashboard'), new Set(existingIds))
  const parsed = DashboardSchema.safeParse({ schema_version: 1, id, title, revision: 0, params: [], panels: [] })
  if (!parsed.success) throw new DashboardError('invalid dashboard title')
  return parsed.data
}

/** The first free row below every existing panel, so a new panel never overlaps. */
export function nextFreeLayout(doc: Dashboard, w = 6, h = 4): Layout {
  const bottom = doc.panels.reduce((max, panel) => Math.max(max, panel.layout.y + panel.layout.h), 0)
  return { x: 0, y: bottom, w: Math.min(w, GRID_COLUMNS), h }
}

export interface NewPanel {
  title: string
  viz: VizKind
  query: string
  options?: PanelOptions
  layout?: Layout
}

export function addPanel(doc: Dashboard, input: NewPanel): { doc: Dashboard; panelId: string } {
  const panelId = uniqueId(slugify(input.title, 'panel'), new Set(doc.panels.map((p) => p.id)))
  const panel: Panel = {
    id: panelId,
    title: input.title,
    viz: input.viz,
    query: { kind: 'uql', text: input.query },
    layout: input.layout ?? nextFreeLayout(doc),
    options: input.options ?? {},
  }
  return { doc: commit({ ...doc, panels: [...doc.panels, panel] }, doc), panelId }
}

export interface PanelPatch {
  title?: string
  viz?: VizKind
  query?: string
  options?: PanelOptions
}

function findPanel(doc: Dashboard, panelId: string): Panel {
  const panel = doc.panels.find((p) => p.id === panelId)
  if (!panel) throw new DashboardError(`no panel with id ${panelId}`)
  return panel
}

export function updatePanel(doc: Dashboard, panelId: string, patch: PanelPatch): Dashboard {
  const current = findPanel(doc, panelId)
  const next: Panel = {
    ...current,
    title: patch.title ?? current.title,
    viz: patch.viz ?? current.viz,
    query: patch.query === undefined ? current.query : { kind: 'uql', text: patch.query },
    options: patch.options ?? current.options,
  }
  return commit({ ...doc, panels: doc.panels.map((p) => (p.id === panelId ? next : p)) }, doc)
}

export function removePanel(doc: Dashboard, panelId: string): Dashboard {
  findPanel(doc, panelId)
  return commit({ ...doc, panels: doc.panels.filter((p) => p.id !== panelId) }, doc)
}

export function setLayout(doc: Dashboard, layouts: Readonly<Record<string, Layout>>): Dashboard {
  for (const id of Object.keys(layouts)) findPanel(doc, id)
  return commit({ ...doc, panels: doc.panels.map((p) => ({ ...p, layout: layouts[p.id] ?? p.layout })) }, doc)
}

export function renameDashboard(doc: Dashboard, title: string): Dashboard {
  return commit({ ...doc, title }, doc)
}

export function setParams(doc: Dashboard, params: readonly Param[]): Dashboard {
  return commit({ ...doc, params: [...params] }, doc)
}

/** Swap two panels' vertical order by exchanging their layouts; keyboard-friendly move. */
export function swapPanels(doc: Dashboard, a: string, b: string): Dashboard {
  const pa = findPanel(doc, a)
  const pb = findPanel(doc, b)
  return setLayout(doc, { [a]: pb.layout, [b]: pa.layout })
}

export function parseDashboard(raw: unknown): Dashboard {
  const parsed = DashboardSchema.safeParse(raw)
  if (!parsed.success) throw new DashboardError('stored dashboard is not valid')
  return parsed.data
}
