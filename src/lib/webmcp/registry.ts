import { buildWebMcpCapabilityCatalog, type WebMcpCapabilityCatalog, type WebMcpCatalogBinding } from './catalog'
import type { WebMcpToolDefinition } from './types'

export type WebMcpRegistryRetirementReason =
  'identity-change' | 'route-change' | 'document-change' | 'generation-change' | 'provider-unmount'

interface RegistryState {
  readonly generation: number
  readonly tools: ReadonlyMap<string, WebMcpToolDefinition>
  readonly catalog: Promise<WebMcpCapabilityCatalog>
}

export interface WebMcpRegistrySnapshot {
  readonly generation: number
  readonly catalog: WebMcpCapabilityCatalog
  readonly toolIds: readonly string[]
}

let nextRemoteRegistrationGeneration = 0

function allocateGeneration(): number {
  nextRemoteRegistrationGeneration += 1
  return nextRemoteRegistrationGeneration
}

function combinedTools(
  toolSets: ReadonlyMap<string, readonly WebMcpToolDefinition[]>,
): Map<string, WebMcpToolDefinition> {
  const combined = new Map<string, WebMcpToolDefinition>()
  for (const tools of toolSets.values()) {
    for (const tool of tools) {
      if (combined.has(tool.name)) throw new Error(`Duplicate active WebMCP tool ID: ${tool.name}`)
      combined.set(tool.name, tool)
    }
  }
  return combined
}

/**
 * Holds only the active, browser-acknowledged tool definitions for one binding.
 * Old generations are discarded immediately and can never be executed by ID.
 */
export class ActiveWebMcpRegistry {
  readonly binding: WebMcpCatalogBinding
  private readonly toolSets = new Map<string, readonly WebMcpToolDefinition[]>()
  private readonly listeners = new Set<() => void>()
  private state: RegistryState | null = null
  private retiredReason: WebMcpRegistryRetirementReason | null = null

  constructor(binding: WebMcpCatalogBinding) {
    this.binding = binding
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  replaceToolSet(ownerId: string, tools: readonly WebMcpToolDefinition[]): void {
    if (this.retiredReason) throw new Error('WebMCP registry has been retired')
    const previous = this.toolSets.get(ownerId)
    this.toolSets.set(ownerId, tools)
    try {
      this.publishGeneration()
    } catch (error) {
      if (previous) this.toolSets.set(ownerId, previous)
      else this.toolSets.delete(ownerId)
      throw error
    }
  }

  removeToolSet(ownerId: string): void {
    if (!this.toolSets.delete(ownerId) || this.retiredReason) return
    this.publishGeneration()
  }

  retire(reason: WebMcpRegistryRetirementReason): void {
    if (this.retiredReason) return
    this.retiredReason = reason
    this.toolSets.clear()
    this.state = null
    allocateGeneration()
    this.emit()
  }

  isRetired(): boolean {
    return this.retiredReason !== null
  }

  currentGeneration(): number | null {
    return this.state?.generation ?? null
  }

  async snapshot(expectedGeneration?: number): Promise<WebMcpRegistrySnapshot> {
    const state = this.state
    if (!state || this.retiredReason) throw new Error('No active WebMCP registration')
    if (expectedGeneration !== undefined && state.generation !== expectedGeneration) {
      throw new Error('Stale WebMCP registration generation')
    }
    const catalog = await state.catalog
    if (this.state !== state) throw new Error('WebMCP registration changed while cataloging')
    return { generation: state.generation, catalog, toolIds: [...state.tools.keys()].sort() }
  }

  async resolveTool(expectedGeneration: number, toolId: string): Promise<WebMcpToolDefinition> {
    const state = this.state
    if (!state || this.retiredReason || state.generation !== expectedGeneration) {
      throw new Error('Stale WebMCP registration generation')
    }
    await state.catalog
    if (this.state !== state) throw new Error('WebMCP registration changed before dispatch')
    const tool = state.tools.get(toolId)
    if (!tool) throw new Error('WebMCP tool is not active in this generation')
    return tool
  }

  private publishGeneration(): void {
    const tools = combinedTools(this.toolSets)
    const generation = allocateGeneration()
    this.state = {
      generation,
      tools,
      catalog: buildWebMcpCapabilityCatalog({
        binding: this.binding,
        registrationGeneration: generation,
        tools: [...tools.values()],
      }),
    }
    this.emit()
  }

  private emit(): void {
    this.listeners.forEach((listener) => {
      listener()
    })
  }
}
