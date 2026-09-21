import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import {
  WEBMCP_CAPABILITY_CATALOG_VERSION,
  WEBMCP_CONTROL_PROTOCOL,
  buildWebMcpCapabilityCatalog,
  toCatalogRegisterMessage,
  type WebMcpCatalogBinding,
} from '../catalog'
import { ActiveWebMcpRegistry } from '../registry'
import type { WebMcpToolDefinition } from '../types'
import { createValidatedExecutor } from '../validation'

const BINDING: WebMcpCatalogBinding = {
  documentId: 'document-1',
  routeId: 'graph',
  route: '/graph',
  identityClaim: 'principal-1|reader',
  role: 'reader',
}

function tool(name: string, readOnly = true): WebMcpToolDefinition {
  return {
    name,
    title: `Title for ${name}`,
    description: 'Bounded local test tool',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string', maxLength: 16 } },
      required: ['value'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: readOnly },
    capability: {
      version: '1.0.0',
      outputSchema: {
        type: 'object',
        properties: { accepted: { type: 'boolean' } },
        required: ['accepted'],
        additionalProperties: false,
      },
      mutationClass: readOnly ? 'read' : 'local-ui-mutation',
      confirmationPolicy: readOnly ? 'none' : 'exact-request',
      source: 'agent-webui:test',
    },
    execute: createValidatedExecutor(z.record(z.string(), z.unknown()), z.unknown(), async () => ({ accepted: true })),
  }
}

describe('versioned WebMCP capability catalog', () => {
  it('publishes deterministic schema and catalog digests with explicit authority', async () => {
    const first = await buildWebMcpCapabilityCatalog({
      binding: BINDING,
      registrationGeneration: 7,
      tools: [tool('agent-webui.navigate', false), tool('agent-webui.get-page-context')],
    })
    const second = await buildWebMcpCapabilityCatalog({
      binding: BINDING,
      registrationGeneration: 7,
      tools: [tool('agent-webui.get-page-context'), tool('agent-webui.navigate', false)],
    })

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      version: WEBMCP_CAPABILITY_CATALOG_VERSION,
      authority: 'browser-local',
      registrationGeneration: 7,
      catalogDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      toolScopeDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })
    expect(first.tools.map((entry) => entry.toolId)).toEqual(['agent-webui.get-page-context', 'agent-webui.navigate'])
    expect(first.tools[1]).toMatchObject({
      mutationClass: 'local-ui-mutation',
      confirmation: 'exact-request',
      requiredRoles: ['reader'],
      routeId: 'graph',
      schemaDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      inputSchemaDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      outputSchemaDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      authority: 'browser-local',
      source: 'agent-webui:test',
    })
    expect(first.tools[1].schemaDigest).toBe('sha256:5b55d760d089d942def7d1900dcabc5671fab6c64c1f06dd718e009f47ebceac')
    expect(first.catalogDigest).toBe('sha256:cd58d61f38903955a239e220dd82b2d0f16d6a0eb29dca4c8645ba66e7b97c52')
    expect(first.toolScopeDigest).toBe('sha256:57b486f4f6ebc7c59987ca1d1879604615ee5653fdc2acf270961d0760e3cf6c')
  })

  it('projects only the exact AU catalog fields onto the authenticated channel', async () => {
    const catalog = await buildWebMcpCapabilityCatalog({
      binding: BINDING,
      registrationGeneration: 11,
      tools: [tool('agent-webui.navigate', false)],
    })
    const message = toCatalogRegisterMessage(catalog)

    expect(Object.keys(message).sort()).toEqual([
      'authority',
      'catalog_digest',
      'protocol',
      'registration_generation',
      'route_id',
      'tool_scope_digest',
      'tools',
      'type',
    ])
    expect(message).toMatchObject({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'catalog.register',
      authority: 'browser-local',
      route_id: 'graph',
      registration_generation: 11,
      catalog_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      tool_scope_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      tools: [
        {
          tool_id: 'agent-webui.navigate',
          version: '1.0.0',
          mutation_class: 'local-ui-mutation',
          confirmation_policy: 'exact-request',
          required_roles: ['reader'],
          source_ref: 'agent-webui:test',
        },
      ],
    })
    expect(JSON.stringify(message)).not.toContain('principal-1')
    expect(JSON.stringify(message)).not.toContain('document-1')
  })

  it('fails closed when a definition has no catalog metadata', async () => {
    const incomplete = { ...tool('agent-webui.incomplete'), capability: undefined }
    await expect(
      buildWebMcpCapabilityCatalog({ binding: BINDING, registrationGeneration: 1, tools: [incomplete] }),
    ).rejects.toThrow('has no capability metadata')
  })

  it('refuses a remotely projected definition that bypasses the validated executor', async () => {
    const unvalidated = { ...tool('agent-webui.unvalidated'), execute: vi.fn(async () => ({ accepted: true })) }
    await expect(
      buildWebMcpCapabilityCatalog({ binding: BINDING, registrationGeneration: 1, tools: [unvalidated] }),
    ).rejects.toThrow('does not use the validated executor')
  })

  it('fails closed before publishing protocol-invalid identifiers', async () => {
    await expect(
      buildWebMcpCapabilityCatalog({
        binding: BINDING,
        registrationGeneration: 1,
        tools: [tool('agent webui invalid')],
      }),
    ).rejects.toThrow('invalid protocol ID')
  })

  it('enforces the backend tool-count and per-schema byte bounds', async () => {
    const tooMany = Array.from({ length: 65 }, (_, index) => tool(`agent-webui.tool-${index}`))
    await expect(
      buildWebMcpCapabilityCatalog({ binding: BINDING, registrationGeneration: 1, tools: tooMany }),
    ).rejects.toThrow('too many tools')

    const oversized = tool('agent-webui.oversized')
    const oversizedSchema = {
      ...oversized,
      inputSchema: { type: 'object', description: '🙂'.repeat(4_100) },
    }
    await expect(
      buildWebMcpCapabilityCatalog({ binding: BINDING, registrationGeneration: 1, tools: [oversizedSchema] }),
    ).rejects.toThrow('schema byte budget')
  })

  it.each([1.5, 9_007_199_254_740_992, '\uD800'])('rejects non-canonical schema content %s', async (value) => {
    const invalid = tool('agent-webui.invalid-schema')
    const invalidSchema = { ...invalid, inputSchema: { type: 'object', extension: value } }

    await expect(
      buildWebMcpCapabilityCatalog({ binding: BINDING, registrationGeneration: 1, tools: [invalidSchema] }),
    ).rejects.toThrow()
  })
})

describe('exact-generation WebMCP registry', () => {
  it('retains only the current definitions and rejects a prior generation', async () => {
    const registry = new ActiveWebMcpRegistry(BINDING)
    const firstTool = tool('agent-webui.first')
    registry.replaceToolSet('page', [firstTool])
    const first = await registry.snapshot()

    expect(await registry.resolveTool(first.generation, firstTool.name)).toBe(firstTool)

    const secondTool = tool('agent-webui.second')
    registry.replaceToolSet('page', [secondTool])
    const second = await registry.snapshot()
    expect(second.generation).toBeGreaterThan(first.generation)
    await expect(registry.resolveTool(first.generation, firstTool.name)).rejects.toThrow('Stale')
    expect(await registry.resolveTool(second.generation, secondTool.name)).toBe(secondTool)
  })

  it('retires all definitions and refuses later publication', async () => {
    const registry = new ActiveWebMcpRegistry(BINDING)
    registry.replaceToolSet('page', [tool('agent-webui.first')])
    const generation = registry.currentGeneration()
    registry.retire('identity-change')

    await expect(registry.snapshot(generation ?? undefined)).rejects.toThrow('No active')
    expect(() => {
      registry.replaceToolSet('page', [tool('agent-webui.second')])
    }).toThrow('retired')
  })

  it('rejects duplicate active IDs without replacing the last valid generation', async () => {
    const registry = new ActiveWebMcpRegistry(BINDING)
    registry.replaceToolSet('page', [tool('agent-webui.same')])
    const validGeneration = registry.currentGeneration()

    expect(() => {
      registry.replaceToolSet('atlas', [tool('agent-webui.same')])
    }).toThrow('Duplicate active')
    expect((await registry.snapshot()).generation).toBe(validGeneration)
  })
})
