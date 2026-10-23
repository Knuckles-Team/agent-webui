import { useEffect, useMemo, useRef } from 'react'
import type { UIMessage } from 'ai'
import { z } from 'zod'
import { readRunIdentity } from '@/lib/run-identity'
import { roleAtLeast, type Role } from '@/lib/nav-registry'
import { navigateWork, workHref, type WorkState } from '@/lib/work-workspace'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'

function destination(message: UIMessage | undefined, conversationId: string, status: string, role: Role) {
  // SDK ready can follow interruption; it does not prove task completion.
  if (status !== 'ready' || message?.role !== 'assistant' || !roleAtLeast(role, 'user')) return null
  const identity = readRunIdentity(message.metadata, conversationId)
  if (!identity) return null
  const state: WorkState = { conversation: conversationId, task: identity.task_id, run: null, node: null }
  try {
    return { messageId: message.id, state, href: workHref(state) }
  } catch {
    return null
  }
}

/** Returned references identify a read target, never authorization or a graph trace. */
export function CurrentResponseTaskLink({
  message,
  conversationId,
  status,
  role,
}: {
  message: UIMessage | undefined
  conversationId: string
  status: string
  role: Role
}) {
  const target = useMemo(
    () => destination(message, conversationId, status, role),
    [message, conversationId, status, role],
  )
  const live = useRef(target)
  live.current = target
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const tools = useMemo(() => {
    if (!target) return []
    return [
      makeTool({
        name: 'agent-webui.work.inspect-current-task',
        title: 'Inspect current response task',
        description:
          'Open the explicitly returned task for the current non-streaming response. Does not execute or authorize a task.',
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({ selected: z.literal(true) }).strict(),
        jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
        readOnly: false,
        source: 'agent-webui:src/components/workspace/CurrentResponseTaskLink.tsx',
        execute: () => {
          if (!active.current || live.current !== target)
            throw new Error('The current response task is no longer available')
          navigateWork(target.state, role)
          return { selected: true as const }
        },
      }),
    ]
  }, [target, role])
  useWebMcpToolSet(tools)
  if (!target) return null
  return (
    <a
      className="inline-flex min-h-11 items-center rounded border px-3 text-sm"
      href={target.href}
      onClick={(event) => {
        if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        if (active.current && live.current === target) navigateWork(target.state, role)
      }}
    >
      Inspect response task
    </a>
  )
}
