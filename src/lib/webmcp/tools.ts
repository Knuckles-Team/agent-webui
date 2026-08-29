/**
 * The experimental, namespaced WebMCP tool definitions.
 *
 * Every execute callback is wrapped by `createValidatedExecutor`: incoming
 * object-or-JSON-string differences are normalized once and both input and
 * output are checked with Zod before crossing the browser boundary.
 */
import { z } from 'zod'
import type { AtlasAction, AtlasState } from '@/lib/atlas/workbench'
import type { Selection } from '@/lib/atlas/types'
import type { PageContextEnvelope } from '@/lib/page-context'
import { navigateWithinWebUi, type WebUiNavigationResult } from './navigation'
import {
  AtlasFilterSetSchema,
  AtlasSelectionInputSchema,
  AtlasSelectionValueSchema,
  EmptyToolInputSchema,
  NavigateInputSchema,
  NavigateOutputSchema,
  PublicAtlasStateSchema,
  PublicPageContextSchema,
  selectionFromToolInput,
  toPublicAtlasFilters,
  toPublicAtlasState,
  toPublicPageContext,
  type AtlasFilterSetInput,
  type AtlasSelectionInput,
} from './contracts'
import { createValidatedExecutor, parseBoundedWebMcpOutput } from './validation'
import type { WebMcpJsonSchema, WebMcpToolDefinition } from './types'

const PAGE_CONTEXT_JSON_SCHEMA: WebMcpJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

const NAVIGATE_JSON_SCHEMA: WebMcpJsonSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 512,
      description: 'A path on this Agent WebUI origin, such as /explore or /graph.',
    },
  },
  required: ['path'],
  additionalProperties: false,
}

const ATLAS_FILTERS_JSON_SCHEMA: WebMcpJsonSchema = {
  type: 'object',
  properties: {
    search: { type: 'string', maxLength: 512 },
    combinator: { type: 'string', enum: ['and', 'or'] },
    clauses: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128 },
          field: { type: 'string', minLength: 1, maxLength: 128 },
          op: {
            type: 'string',
            enum: ['eq', 'neq', 'contains', 'startsWith', 'gt', 'gte', 'lt', 'lte', 'in', 'exists', 'missing'],
          },
          value: {
            anyOf: [
              { type: 'string', maxLength: 256 },
              { type: 'number' },
              { type: 'boolean' },
              {
                type: 'array',
                maxItems: 16,
                items: {
                  anyOf: [{ type: 'string', maxLength: 256 }, { type: 'number' }, { type: 'boolean' }],
                },
              },
            ],
          },
        },
        required: ['id', 'field', 'op'],
        additionalProperties: false,
      },
    },
    sort: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            field: { type: 'string', minLength: 1, maxLength: 128 },
            direction: { type: 'string', enum: ['asc', 'desc'] },
          },
          required: ['field', 'direction'],
          additionalProperties: false,
        },
      ],
    },
    limit: { type: 'integer', minimum: 0, maximum: 5_000 },
  },
  required: ['search', 'combinator', 'clauses', 'sort', 'limit'],
  additionalProperties: false,
}

const ATLAS_SELECTION_JSON_SCHEMA: WebMcpJsonSchema = {
  type: 'object',
  properties: {
    selection: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['node', 'edge', 'row', 'cell'] },
            id: { type: 'string', minLength: 1, maxLength: 256 },
            label: { type: 'string', maxLength: 256 },
            type: { type: 'string', maxLength: 128 },
          },
          required: ['kind', 'id', 'label'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['selection'],
  additionalProperties: false,
}

const ATLAS_STATE_JSON_SCHEMA: WebMcpJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

const AtlasSetFiltersOutputSchema = z.object({ updated: z.literal(true), filters: AtlasFilterSetSchema }).strict()
const AtlasSelectionOutputSchema = z
  .object({ updated: z.literal(true), selection: AtlasSelectionValueSchema })
  .strict()

interface PageToolOptions {
  context: PageContextEnvelope
  role: Parameters<typeof navigateWithinWebUi>[1]
  navigate?: (path: string) => WebUiNavigationResult
}

function makeTool<Input, Output>(options: {
  name: string
  title: string
  description: string
  inputSchema: z.ZodType<Input>
  outputSchema: z.ZodType<Output>
  jsonSchema: WebMcpJsonSchema
  readOnly: boolean
  execute: (input: Input) => Output | PromiseLike<Output>
}): WebMcpToolDefinition {
  return {
    name: options.name,
    title: options.title,
    description: options.description,
    inputSchema: options.jsonSchema,
    annotations: { readOnlyHint: options.readOnly, untrustedContentHint: true },
    execute: createValidatedExecutor(options.inputSchema, options.outputSchema, options.execute),
  }
}

/** Register the route/context subset. No tool exposes page action affordances. */
export function createPageTools(options: PageToolOptions): readonly WebMcpToolDefinition[] {
  const navigate = options.navigate ?? ((path: string) => navigateWithinWebUi(path, options.role))
  const publicContext = toPublicPageContext(options.context)

  return [
    makeTool({
      name: 'agent-webui.get-page-context',
      title: 'Get page context',
      description:
        'Read the current Agent WebUI route, view, selection, and filter context. ' +
        'This returns UI context only and cannot invoke backend actions.',
      inputSchema: EmptyToolInputSchema,
      outputSchema: PublicPageContextSchema,
      jsonSchema: PAGE_CONTEXT_JSON_SCHEMA,
      readOnly: true,
      execute: () => publicContext,
    }),
    makeTool({
      name: 'agent-webui.navigate',
      title: 'Navigate in Agent WebUI',
      description:
        'Navigate to a registered same-origin Agent WebUI route visible to the current role. ' +
        'This changes browser UI state only and never calls a backend API.',
      inputSchema: NavigateInputSchema,
      outputSchema: NavigateOutputSchema,
      jsonSchema: NAVIGATE_JSON_SCHEMA,
      readOnly: false,
      execute: ({ path }) => navigate(path),
    }),
  ]
}

export interface AtlasToolController {
  state: AtlasState
  dispatch: (action: AtlasAction) => void
  select: (selection: Selection | null) => void
}

/** Register only the typed, local Atlas selection/filter controls. */
export function createAtlasTools(controller: AtlasToolController): readonly WebMcpToolDefinition[] {
  const publicState = toPublicAtlasState(controller.state)

  return [
    makeTool({
      name: 'agent-webui.atlas.get-state',
      title: 'Get Atlas UI state',
      description:
        'Read the current Atlas adapter, filters, selection, renderer, and graph context. ' +
        'Console text, results, adapter options, and backend data are not exposed.',
      inputSchema: EmptyToolInputSchema,
      outputSchema: PublicAtlasStateSchema,
      jsonSchema: ATLAS_STATE_JSON_SCHEMA,
      readOnly: true,
      execute: () => publicState,
    }),
    makeTool({
      name: 'agent-webui.atlas.set-filters',
      title: 'Set Atlas filters',
      description:
        'Replace Atlas’s local filter editor state. This does not execute a query or write backend data; ' +
        'the operator still controls when a query runs.',
      inputSchema: AtlasFilterSetSchema,
      outputSchema: AtlasSetFiltersOutputSchema,
      jsonSchema: ATLAS_FILTERS_JSON_SCHEMA,
      readOnly: false,
      execute: (filters: AtlasFilterSetInput) => {
        const output = parseBoundedWebMcpOutput(AtlasSetFiltersOutputSchema, {
          updated: true,
          filters: toPublicAtlasFilters(filters),
        })
        controller.dispatch({ type: 'setFilters', filters })
        return output
      },
    }),
    makeTool({
      name: 'agent-webui.atlas.select',
      title: 'Select in Atlas',
      description:
        'Change Atlas’s local selection or clear it. Selection data is limited to kind, id, label, and type; ' +
        'this does not fetch, edit, or write backend data.',
      inputSchema: AtlasSelectionInputSchema,
      outputSchema: AtlasSelectionOutputSchema,
      jsonSchema: ATLAS_SELECTION_JSON_SCHEMA,
      readOnly: false,
      execute: (selection: AtlasSelectionInput) => {
        const output = parseBoundedWebMcpOutput(AtlasSelectionOutputSchema, {
          updated: true,
          selection: selection.selection,
        })
        controller.select(selectionFromToolInput(selection))
        return output
      },
    }),
  ]
}

export type { PublicAtlasState, PublicPageContext } from './contracts'
