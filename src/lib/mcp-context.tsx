'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { ToolSet } from 'ai'
import { ElicitationModal } from '../components/ElicitationModal'

interface JSONSchema {
  type?: string
  title?: string
  description?: string
  properties?: Record<string, JSONSchema>
}

interface ElicitationResult {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
  [key: string]: unknown
}

interface ElicitationState {
  isOpen: boolean
  message: string
  schema: JSONSchema | null
  resolve: ((result: ElicitationResult) => void) | null
}

interface MCPContextValue {
  tools: ToolSet | null
  isLoadingTools: boolean
}

const MCPContext = createContext<MCPContextValue | undefined>(undefined)

/**
 * `tools` is honestly always `null` today — there is no wiring to strip out
 * here, on purpose, not by omission.
 *
 * A real browser-side MCP client (`src/lib/mcp-client.ts`) and MCP Apps host
 * (`src/components/mcp/McpAppHost.tsx`) exist and are tested, but only on the
 * unmerged `feat/mcp-client-wiring` branch (based on `feat/mcp-apps-host`, off
 * `main@698ea63`) — neither branch is an ancestor of this repo's current
 * `main`, and current `main` has no `/api/enhanced/mcp/tools/call` /
 * `/api/enhanced/mcp/apps/resource` backend routes for it to call. Wiring
 * `tools` from that client here would either dangle (routes 404) or require
 * re-landing that whole branch (client + Apps host + two backend routes +
 * tests) against the auth/identity changes current `main` has since merged —
 * out of scope for this fix. Do not restore a `useState` setter here without
 * first landing that reconciliation; until then `tools` stays `null` and
 * `isLoadingTools` stays `false` (there is nothing to load).
 */
export function MCPProvider({ children }: { children: ReactNode }) {
  const tools: ToolSet | null = null
  const isLoadingTools = false
  const [elicitation, setElicitation] = useState<ElicitationState>({
    isOpen: false,
    message: '',
    schema: null,
    resolve: null,
  })

  const handleElicitationResponse = useCallback(
    (result: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) => {
      if (elicitation.resolve) {
        elicitation.resolve(result)
      }
      setElicitation({ isOpen: false, message: '', schema: null, resolve: null })
    },
    [elicitation.resolve],
  )

  return (
    <MCPContext.Provider value={{ tools, isLoadingTools }}>
      {children}

      {elicitation.isOpen && elicitation.schema && (
        <ElicitationModal
          message={elicitation.message}
          schema={elicitation.schema}
          onSubmit={(content) => {
            handleElicitationResponse({ action: 'accept', content })
          }}
          onCancel={() => {
            handleElicitationResponse({ action: 'cancel' })
          }}
          onDecline={() => {
            handleElicitationResponse({ action: 'decline' })
          }}
        />
      )}
    </MCPContext.Provider>
  )
}

export function useMCP() {
  const context = useContext(MCPContext)
  if (!context) throw new Error('useMCP must be used within MCPProvider')
  return context
}
