/**
 * @file tools.ts
 * @description WebMCP tools the Dashboards page exposes to the chat agent
 * (OVERSTORY-DASH-R007, R009). Every tool validates input and output, returns a small
 * typed result inside the 1,500-byte budget, and edits through the controller so
 * the change shows in the activity log and can be undone. Removing a panel waits for
 * the person to approve it in the page.
 */
import { z } from 'zod'
import { makeTool } from '@/lib/webmcp/tools'
import type { WebMcpJsonSchema, WebMcpToolDefinition } from '@/lib/webmcp/types'
import {
  addPanel,
  DashboardError,
  LayoutSchema,
  removePanel,
  setLayout,
  updatePanel,
  VIZ_KINDS,
  type Dashboard,
  type Layout,
  type PanelOptions,
} from './model'
import type { Cell, QueryOutcome } from './query'

export const DASHBOARD_TOOL_PREFIX = 'overstory.dashboard.'
const SOURCE = 'overstory:src/lib/dashboards/tools.ts'

export interface DashboardController {
  /** The dashboard open in the page, or null when none is open. */
  current(): Dashboard | null
  /** Create and open a new dashboard as an agent edit. */
  create(title: string): Dashboard
  /** Apply an agent edit to the open dashboard; the label feeds the activity log. */
  edit(label: string, change: (doc: Dashboard) => Dashboard): Dashboard
  /** Ask the person to approve a destructive change; resolves false on denial or abort. */
  confirm(message: string, signal: AbortSignal): Promise<boolean>
  runQuery(text: string, signal: AbortSignal): Promise<QueryOutcome>
  listSources(signal: AbortSignal): Promise<{ name: string; count: number }[]>
}

const ResultSchema = z
  .strictObject({
    ok: z.boolean(),
    error: z.string().max(240).optional(),
    dashboard_id: z.string().max(64).optional(),
    revision: z.number().int().optional(),
    panel_id: z.string().max(64).optional(),
    panels: z.number().int().optional(),
  })
  .strict()
type Result = z.infer<typeof ResultSchema>

const ColumnSchema = z.string().trim().min(1).max(128)
const ids = { panel_id: z.string().min(1).max(64) }

const CreateInput = z.strictObject({ title: z.string().trim().min(1).max(120) })
const AddInput = z.strictObject({
  title: z.string().trim().min(1).max(120),
  viz: z.enum(VIZ_KINDS),
  query: z.string().trim().min(1).max(2_000),
  x_column: ColumnSchema.optional(),
  y_column: ColumnSchema.optional(),
  layout: LayoutSchema.optional(),
})
const UpdateInput = z.strictObject({
  ...ids,
  title: z.string().trim().min(1).max(120).optional(),
  viz: z.enum(VIZ_KINDS).optional(),
  query: z.string().trim().min(1).max(2_000).optional(),
  x_column: ColumnSchema.optional(),
  y_column: ColumnSchema.optional(),
})
const RemoveInput = z.strictObject(ids)
const SetLayoutInput = z.strictObject({
  layouts: z
    .array(z.strictObject({ ...ids, ...LayoutSchema.shape }))
    .min(1)
    .max(24),
})
const EmptyInput = z.strictObject({})
const PreviewInput = z.strictObject({ query: z.string().trim().min(1).max(2_000) })

const SourcesOutput = z.strictObject({
  ok: z.boolean(),
  query_language: z.literal('uql'),
  viz_kinds: z.array(z.string()).max(8),
  node_types: z.array(z.strictObject({ name: z.string().max(48), count: z.number() })).max(12),
  note: z.string().max(160).optional(),
})
const PreviewOutput = z.strictObject({
  ok: z.boolean(),
  state: z.enum(['ok', 'empty', 'error']),
  error: z.string().max(240).optional(),
  row_count: z.number().int().optional(),
  columns: z.array(z.string().max(40)).max(8).optional(),
  sample: z
    .array(z.array(z.string().max(40)).max(8))
    .max(3)
    .optional(),
})

const str = (extra: object = {}): WebMcpJsonSchema => ({ type: 'string', minLength: 1, maxLength: 128, ...extra })
const vizEnum: WebMcpJsonSchema = { type: 'string', enum: [...VIZ_KINDS] }
const layoutSchema: WebMcpJsonSchema = {
  type: 'object',
  properties: {
    x: { type: 'integer', minimum: 0, maximum: 11 },
    y: { type: 'integer', minimum: 0 },
    w: { type: 'integer', minimum: 1, maximum: 12 },
    h: { type: 'integer', minimum: 1, maximum: 12 },
  },
  required: ['x', 'y', 'w', 'h'],
  additionalProperties: false,
}
const obj = (properties: Record<string, unknown>, required: string[]): WebMcpJsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

function refusal(error: unknown): Result {
  const message = error instanceof Error ? error.message : 'The change was refused.'
  return { ok: false, error: message.slice(0, 240) }
}

function done(doc: Dashboard, panelId?: string): Result {
  return {
    ok: true,
    dashboard_id: doc.id,
    revision: doc.revision,
    panels: doc.panels.length,
    ...(panelId ? { panel_id: panelId } : {}),
  }
}

function options(x?: string, y?: string): PanelOptions {
  return { ...(x ? { x } : {}), ...(y ? { y } : {}) }
}

function requireOpen(controller: DashboardController): Dashboard {
  const doc = controller.current()
  if (!doc) throw new DashboardError('no dashboard is open; call create first')
  return doc
}

function short(value: Cell | undefined): string {
  return String(value ?? '').slice(0, 40)
}

export function createDashboardTools(controller: DashboardController): readonly WebMcpToolDefinition[] {
  return [
    makeTool({
      name: `${DASHBOARD_TOOL_PREFIX}create`,
      title: 'Create dashboard',
      description: 'Create a new empty dashboard and open it. The person can undo this.',
      inputSchema: CreateInput,
      outputSchema: ResultSchema,
      jsonSchema: obj({ title: str({ maxLength: 120 }) }, ['title']),
      readOnly: false,
      source: SOURCE,
      execute: ({ title }) => {
        try {
          return done(controller.create(title))
        } catch (error) {
          return refusal(error)
        }
      },
    }),
    makeTool({
      name: `${DASHBOARD_TOOL_PREFIX}add_panel`,
      title: 'Add dashboard panel',
      description:
        'Add a panel to the open dashboard: a UQL query shown as a table, line, bar or kpi. ' +
        'Use {{name}} for dashboard parameters. The query runs through arbora when the panel renders.',
      inputSchema: AddInput,
      outputSchema: ResultSchema,
      jsonSchema: obj(
        {
          title: str({ maxLength: 120 }),
          viz: vizEnum,
          query: str({ maxLength: 2000 }),
          x_column: str(),
          y_column: str(),
          layout: layoutSchema,
        },
        ['title', 'viz', 'query'],
      ),
      readOnly: false,
      source: SOURCE,
      execute: (input) => {
        try {
          requireOpen(controller)
          let panelId = ''
          const doc = controller.edit(`Added panel "${input.title}"`, (current) => {
            const added = addPanel(current, {
              title: input.title,
              viz: input.viz,
              query: input.query,
              options: options(input.x_column, input.y_column),
              layout: input.layout,
            })
            panelId = added.panelId
            return added.doc
          })
          return done(doc, panelId)
        } catch (error) {
          return refusal(error)
        }
      },
    }),
    makeTool({
      name: `${DASHBOARD_TOOL_PREFIX}update_panel`,
      title: 'Update dashboard panel',
      description: 'Change the title, visualization, query or columns of one panel. The person can undo this.',
      inputSchema: UpdateInput,
      outputSchema: ResultSchema,
      jsonSchema: obj(
        {
          panel_id: str({ maxLength: 64 }),
          title: str({ maxLength: 120 }),
          viz: vizEnum,
          query: str({ maxLength: 2000 }),
          x_column: str(),
          y_column: str(),
        },
        ['panel_id'],
      ),
      readOnly: false,
      source: SOURCE,
      execute: (input) => {
        try {
          requireOpen(controller)
          const doc = controller.edit(`Updated panel ${input.panel_id}`, (current) => {
            const panel = current.panels.find((p) => p.id === input.panel_id)
            const opts =
              input.x_column || input.y_column
                ? { ...panel?.options, ...options(input.x_column, input.y_column) }
                : undefined
            return updatePanel(current, input.panel_id, {
              title: input.title,
              viz: input.viz,
              query: input.query,
              options: opts,
            })
          })
          return done(doc, input.panel_id)
        } catch (error) {
          return refusal(error)
        }
      },
    }),
    makeTool({
      name: `${DASHBOARD_TOOL_PREFIX}remove_panel`,
      title: 'Remove dashboard panel',
      description:
        'Remove one panel. The person must approve in the page first; a denial leaves the dashboard unchanged.',
      inputSchema: RemoveInput,
      outputSchema: ResultSchema,
      jsonSchema: obj({ panel_id: str({ maxLength: 64 }) }, ['panel_id']),
      readOnly: false,
      source: SOURCE,
      execute: async (input) => {
        try {
          const doc = requireOpen(controller)
          const panel = doc.panels.find((p) => p.id === input.panel_id)
          if (!panel) throw new DashboardError(`no panel with id ${input.panel_id}`)
          const approved = await controller.confirm(
            `The agent asks to remove the panel "${panel.title}".`,
            new AbortController().signal,
          )
          if (!approved) return { ok: false, error: 'The person denied the removal.' }
          return done(
            controller.edit(`Removed panel "${panel.title}"`, (current) => removePanel(current, input.panel_id)),
          )
        } catch (error) {
          return refusal(error)
        }
      },
    }),
    makeTool({
      name: `${DASHBOARD_TOOL_PREFIX}set_layout`,
      title: 'Set dashboard layout',
      description: 'Place panels on the 12-column grid by panel id with x, y, w and h. The person can undo this.',
      inputSchema: SetLayoutInput,
      outputSchema: ResultSchema,
      jsonSchema: obj(
        {
          layouts: {
            type: 'array',
            minItems: 1,
            maxItems: 24,
            items: obj(
              {
                panel_id: str({ maxLength: 64 }),
                ...(layoutSchema as { properties: Record<string, unknown> }).properties,
              },
              ['panel_id', 'x', 'y', 'w', 'h'],
            ),
          },
        },
        ['layouts'],
      ),
      readOnly: false,
      source: SOURCE,
      execute: ({ layouts }) => {
        try {
          requireOpen(controller)
          const map: Record<string, Layout> = {}
          for (const entry of layouts) map[entry.panel_id] = { x: entry.x, y: entry.y, w: entry.w, h: entry.h }
          return done(controller.edit('Changed layout', (current) => setLayout(current, map)))
        } catch (error) {
          return refusal(error)
        }
      },
    }),
    makeTool({
      name: `${DASHBOARD_TOOL_PREFIX}list_data_sources`,
      title: 'List dashboard data sources',
      description: 'List the query language, panel kinds and the most common graph node types a panel query can read.',
      inputSchema: EmptyInput,
      outputSchema: SourcesOutput,
      jsonSchema: obj({}, []),
      readOnly: true,
      source: SOURCE,
      execute: async () => {
        const base = { ok: true, query_language: 'uql' as const, viz_kinds: [...VIZ_KINDS] }
        try {
          const types = await controller.listSources(new AbortController().signal)
          return {
            ...base,
            node_types: types.slice(0, 12).map((t) => ({ name: t.name.slice(0, 48), count: t.count })),
          }
        } catch {
          return { ...base, node_types: [], note: 'Node types are unavailable right now.' }
        }
      },
    }),
    makeTool({
      name: `${DASHBOARD_TOOL_PREFIX}preview_query`,
      title: 'Preview dashboard query',
      description:
        'Run a UQL query through arbora and return its columns, row count and a short sample. Writes nothing.',
      inputSchema: PreviewInput,
      outputSchema: PreviewOutput,
      jsonSchema: obj({ query: str({ maxLength: 2000 }) }, ['query']),
      readOnly: true,
      source: SOURCE,
      execute: async ({ query }) => {
        const outcome = await controller.runQuery(query, new AbortController().signal)
        if (outcome.state === 'error')
          return { ok: false, state: 'error' as const, error: outcome.error.slice(0, 240) }
        if (outcome.state === 'empty') return { ok: true, state: 'empty' as const, row_count: 0 }
        const columns = outcome.data.columns.slice(0, 8)
        const sample = outcome.data.rows.slice(0, 3).map((row) => columns.map((c) => short(row[c])))
        return {
          ok: true,
          state: 'ok' as const,
          row_count: outcome.data.rows.length,
          columns: columns.map(short),
          sample,
        }
      },
    }),
  ]
}
