'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
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

export function MCPProvider({ children }: { children: ReactNode }) {
  const [tools] = useState<ToolSet | null>(null)
  const [isLoadingTools, setIsLoadingTools] = useState(false)
  const [elicitation, setElicitation] = useState<ElicitationState>({
    isOpen: false,
    message: '',
    schema: null,
    resolve: null,
  })

  useEffect(() => {
    setIsLoadingTools(false)
  }, [])

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
