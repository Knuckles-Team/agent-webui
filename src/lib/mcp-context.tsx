'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { ElicitationModal } from '../components/ElicitationModal'
import { DEFAULT_MCP_SERVER, McpClientError, fetchMcpServerTools, type McpToolDescriptor } from './mcp-client'

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

/**
 * Where the catalog currently stands, distinguishing "never asked",
 * "asking", a real answer, an honest refusal (server reachable, catalog not
 * available — e.g. delegation unconfigured, policy denial), and a transport
 * failure. `MCPProvider` never collapses these into a single boolean: a
 * consumer that needs to render "no tools" vs "couldn't check" needs to tell
 * them apart, and BUG-050 is exactly the failure mode of pretending
 * unresolved state is a settled answer.
 */
export type MCPCatalogStatus = 'idle' | 'loading' | 'available' | 'unavailable' | 'error'

interface MCPContextValue {
  /** Bounded, validated tool descriptors from the last successful catalog
   * fetch, or `null` before the first load resolves or after a failure. */
  tools: McpToolDescriptor[] | null
  isLoadingTools: boolean
  /** Human-readable reason the catalog is not `available`, or `null`. */
  toolsError: string | null
  catalogStatus: MCPCatalogStatus
}

const MCPContext = createContext<MCPContextValue | undefined>(undefined)

export interface MCPProviderProps {
  children: ReactNode
  /** MCP server whose governed catalog is loaded. Defaults to graph-os, the
   * fleet gateway — the same default `mcp-client.ts`'s callers use. */
  server?: string
}

/**
 * Loads the caller's policy-filtered tool catalog through the same-origin
 * BFF route (`GET /api/enhanced/mcp/servers/{server}/tools`,
 * `list_mcp_server_tools` in `agent_webui.api_extensions`) — never opens a
 * browser-side MCP connection (see `mcp-client.ts`'s module docstring for
 * why that is impossible to do safely, not merely undone). The fetch reruns
 * whenever `server` changes and is aborted on unmount or before a stale
 * request can land, so an in-flight response for a previous server can never
 * overwrite the current one (BUG-010).
 *
 * A missing/refusing backend (no delegation configured, policy denial,
 * transport failure) settles to an explicit `unavailable`/`error` status
 * with `tools: null` — it never fabricates a catalog and never leaves
 * `isLoadingTools` stuck `true`.
 */
export function MCPProvider({ children, server = DEFAULT_MCP_SERVER }: MCPProviderProps) {
  const [tools, setTools] = useState<McpToolDescriptor[] | null>(null)
  const [isLoadingTools, setIsLoadingTools] = useState(false)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [catalogStatus, setCatalogStatus] = useState<MCPCatalogStatus>('idle')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setIsLoadingTools(true)
    setCatalogStatus('loading')
    setToolsError(null)

    fetchMcpServerTools(server, { signal: controller.signal })
      .then((fetched) => {
        if (cancelled) return
        setTools(fetched)
        setCatalogStatus('available')
        setIsLoadingTools(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTools(null)
        // A response the backend actually sent (400/501/503/…) is an honest
        // refusal -- "unavailable". No response at all (network/transport
        // failure, request never reached the backend) is a harder "error".
        const isBackendRefusal = err instanceof McpClientError && typeof err.status === 'number'
        setCatalogStatus(isBackendRefusal ? 'unavailable' : 'error')
        setToolsError(err instanceof Error ? err.message : String(err))
        setIsLoadingTools(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [server])

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
    <MCPContext.Provider value={{ tools, isLoadingTools, toolsError, catalogStatus }}>
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
