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
 * CORRECTION (GOC-60-W07, 2026-08-09): a prior version of this comment
 * claimed the browser-side MCP client (`src/lib/mcp-client.ts`) and MCP Apps
 * host (`src/components/mcp/McpAppHost.tsx`) plus their backend routes
 * existed only on an unmerged `feat/mcp-client-wiring` branch. That claim is
 * now false and actively misleading: commit `9fc394f`
 * ("merge(webui-closeout): feat/mcp-client-wiring", 2026-08-08) merged that
 * branch into `main` — `9fc394f` is an ancestor of current `main` — and both
 * backend routes it names now exist (`api_extensions.py`'s
 * `POST /api/enhanced/mcp/tools/call` and
 * `POST /api/enhanced/mcp/apps/resource`).
 *
 * What is actually true today: `McpAppHost` is merged, exported, and
 * covered by its own test (`src/components/mcp/__tests__/McpAppHost.test.tsx`),
 * but it has **zero production render sites** — grepping `src/` for
 * `<McpAppHost` matches only that test file. Nothing in this app currently
 * mounts it into a real UX, and no `useMCP().tools` consumer exists either
 * (`SkillsView.tsx` keeps its own separate `mcpTools` state fetched over
 * REST, unrelated to this context). Deciding *how* and *where* to mount
 * `McpAppHost` (and correspondingly wire `tools` here) is an MCP Apps
 * consumer-UX decision this lane hands off explicitly to **GOC-26** rather
 * than making unilaterally — see the GOC-60 lane brief's E3 finding and
 * handoff checklist. Do not restore a `useState` setter here without first
 * landing that decision; until then `tools` stays `null` and
 * `isLoadingTools` stays `false` (there is nothing to load) — this is a
 * truthfulness correction only, not a behaviour change.
 */
export function MCPProvider({ children }: { children: ReactNode }) {
  // D-FE-3: `tools` is a deliberate, documented placeholder -- always `null`,
  // no live consumer of `useMCP().tools` exists in this repo today (grepped;
  // SkillsView.tsx keeps its own separate `mcpTools` state fetched over
  // REST, unrelated to this context). A stale sibling `.backup*` draft of
  // this file once wired `tools` to `@ai-sdk/mcp`'s `createMCPClient` over
  // an SSE transport at `/mcp/sse` -- that route does not exist anywhere in
  // `agent/agent_webui/*.py` (grepped), and the draft's
  // `process.env.NEXT_PUBLIC_MCP_SSE_URL` is a Next.js convention this
  // Vite-based app has no equivalent for, so that draft was never a viable
  // fix, just a dead lead. Removed the `.backup*` files (six of them) so a
  // future reader isn't misled into thinking a working implementation
  // already existed. A real fix needs a backend MCP-tool-listing surface
  // first (none exists), not a frontend patch alone.
  const [tools] = useState<ToolSet | null>(null)
  // No setter: with `tools` a fixed `null` placeholder there is nothing to
  // load, so this never leaves `false`. (main carried a
  // `useEffect(() => setIsLoadingTools(false), [])` that was already a no-op
  // over the identical initial state; fix/lane-sweep-frontends-webui deleted
  // it, and keeping a write-only setter would just be an unused binding.)
  const [isLoadingTools] = useState(false)
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
