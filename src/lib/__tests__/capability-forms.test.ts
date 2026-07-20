import { describe, expect, it } from 'vitest'

import { contextualCapabilityScore, createSchemaFormState, materializeSchemaInputs } from '../capability-forms'
import type { JsonSchema } from '../capabilities-api'
import type { PageContextEnvelope } from '../page-context'

const context: PageContextEnvelope = {
  schemaVersion: '1.0',
  route: '/object/object-7?query=neighbors&limit=5&as_of=2026-07-13T10%3A00%3A00Z',
  view: 'object',
  selection: [{ kind: 'ontology-object', id: 'object-7', label: 'Customer' }],
  filters: { query: 'neighbors', limit: '5' },
  timeRange: { asOf: '2026-07-13T10:00:00Z', timezone: 'America/Chicago' },
  allowedActions: [{ id: 'inspect-object', label: 'Inspect object', kind: 'read' }],
  capturedAt: '2026-07-13T10:00:01Z',
}

const schema: JsonSchema = {
  type: 'object',
  required: ['action', 'object_id', 'limit'],
  properties: {
    action: { const: 'inspect' },
    object_id: { type: 'string' },
    query: { type: 'string' },
    limit: { type: 'integer' },
    as_of: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    filters: { type: 'object' },
    include_history: { type: 'boolean', default: true },
    tags: { type: 'array' },
  },
}

describe('schema-generated contextual forms', () => {
  it('prefills schema fields from typed selection, filters, and time context', () => {
    expect(createSchemaFormState(schema, context)).toEqual({
      action: 'inspect',
      object_id: 'object-7',
      query: 'neighbors',
      limit: '5',
      as_of: '2026-07-13T10:00:00Z',
      filters: JSON.stringify({ query: 'neighbors', limit: '5' }, null, 2),
      include_history: true,
      tags: '',
    })
  })

  it('materializes typed values and reports invalid structured input before preflight', () => {
    const state = createSchemaFormState(schema, context)
    state.tags = '["critical", "customer"]'
    const valid = materializeSchemaInputs(schema, state)
    expect(valid.issues).toEqual([])
    expect(valid.inputs).toMatchObject({
      action: 'inspect',
      object_id: 'object-7',
      limit: 5,
      filters: { query: 'neighbors', limit: '5' },
      include_history: true,
      tags: ['critical', 'customer'],
    })

    state.limit = 'not-a-number'
    state.filters = '{broken'
    const invalid = materializeSchemaInputs(schema, state)
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        { field: 'limit', message: 'Expected integer' },
        { field: 'filters', message: 'Expected valid JSON object' },
      ]),
    )
  })

  it('ranks actions explicitly allowed by the current view above vocabulary-only matches', () => {
    const explicit = contextualCapabilityScore(
      { id: 'object-reader', title: 'Reader', actions: [{ id: 'inspect-object' }], typed_io: { tags: [] } },
      context,
    )
    const vocabularyOnly = contextualCapabilityScore(
      { id: 'object-search', title: 'Object search', actions: [{ id: 'search' }], typed_io: { tags: [] } },
      context,
    )
    expect(explicit).toBeGreaterThan(vocabularyOnly)
  })
})
