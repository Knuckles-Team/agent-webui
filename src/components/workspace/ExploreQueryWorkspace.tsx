import { useLayoutEffect, useMemo, useRef } from 'react'
import { z } from 'zod'
import { useIdentity } from '@/lib/auth'
import { conversationOwnerKey } from '@/lib/chat-store'
import { roleAtLeast, type Role } from '@/lib/nav-registry'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import {
  EXPLORE_LENSES,
  exploreLensHref,
  navigateExploreLens,
  parseExploreLensState,
  type ExploreLensState,
} from '@/lib/explore-lens-state'
import { QueryValidationLens } from '@/components/query-validation/QueryValidationLens'
import { useQueryValidationLens, type Mode } from '@/components/query-validation/useQueryValidationLens'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import EvidenceWorkspace from './ExploreWorkspace'
import { QueryEditorTools } from './QueryEditorTools'

/** New retained composition; no legacy feature-page shell is mounted. */
export default function ExploreQueryWorkspace() {
  const { identity, loading } = useIdentity()
  const location = useWorkspaceLocation()
  let state: ExploreLensState
  try {
    state = parseExploreLensState(location)
  } catch {
    return <p role="alert">This Explore destination is invalid.</p>
  }
  if (loading) return <p role="status">Checking workspace access…</p>
  if (identity.needsSignIn || !roleAtLeast(identity.role, 'user'))
    return <p role="alert">Explore is not available for the current identity.</p>
  if (state.lens !== 'evidence' && !roleAtLeast(identity.role, 'maintainer'))
    return (
      <p role="alert">
        Query and validation require maintainer access.{' '}
        <a href={exploreLensHref({ ...state, lens: 'evidence' })}>Return to evidence</a>
      </p>
    )
  return (
    <OwnedExplore
      key={JSON.stringify([conversationOwnerKey(identity), identity.role, state.entity, state.query])}
      state={state}
      role={identity.role}
    />
  )
}
function OwnedExplore({ state, role }: { state: ExploreLensState; role: Role }) {
  const controller = useQueryValidationLens()
  const available = roleAtLeast(role, 'maintainer') ? EXPLORE_LENSES : (['evidence'] as const)
  const heading = useRef<HTMLHeadingElement>(null)
  const active = useRef(true)
  const live = useRef(state)
  live.current = state
  useLayoutEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useLayoutEffect(() => {
    if (state.lens !== 'evidence') controller.setMode(state.lens === 'query' ? 'sparql' : 'shacl')
    heading.current?.focus({ preventScroll: true })
  }, [state.lens, controller.setMode])
  const select = (lens: ExploreLensState['lens']) => {
    if (!active.current || live.current !== state) throw new Error('Explore lens context is stale')
    navigateExploreLens({ ...state, lens }, role, available)
  }
  const tools = useMemo(() => {
    const schema = z.object({ lens: z.enum(available) }).strict()
    return [
      makeTool({
        name: 'agent-webui.explore.lens',
        title: 'Select an Explore lens',
        description:
          'Select evidence, query or validation in the current workspace. Does not edit or execute queries or grant backend permission.',
        inputSchema: schema,
        outputSchema: schema,
        jsonSchema: z.toJSONSchema(schema),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/ExploreQueryWorkspace.tsx',
        execute: ({ lens }) => {
          if (!active.current || live.current !== state) throw new Error('Explore lens context is stale')
          navigateExploreLens({ ...state, lens }, role, available)
          return { lens }
        },
      }),
    ]
  }, [state, role, available])
  useWebMcpToolSet(tools)
  const displayed = {
    ...controller,
    setMode: (next: Mode | ((previous: Mode) => Mode)) => {
      const mode = typeof next === 'function' ? next(controller.mode) : next
      select(mode === 'sparql' ? 'query' : 'validation')
    },
    runSparql: async () => {
      if (active.current && live.current === state && state.lens === 'query') await controller.runSparql()
    },
    runValidate: async () => {
      if (active.current && live.current === state && state.lens === 'validation') await controller.runValidate()
    },
  }
  return (
    <section aria-label="Explore workspace lenses" className="workspace-surface min-w-0 space-y-3">
      <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold">
        Explore
      </h1>
      <nav aria-label="Explore lenses" className="flex flex-wrap gap-2">
        {available.map((lens) => (
          <a
            key={lens}
            href={exploreLensHref({ ...state, lens })}
            aria-current={state.lens === lens ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded border px-3 capitalize"
            onClick={(event) => {
              if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              select(lens)
            }}
          >
            {lens}
          </a>
        ))}
      </nav>
      <div hidden={state.lens !== 'evidence'}>
        <EvidenceWorkspace showHeading={false} active={state.lens === 'evidence'} />
      </div>
      {state.lens !== 'evidence' && <QueryValidationLens controller={displayed} />}
      {state.lens !== 'evidence' && (
        <QueryEditorTools
          controller={displayed}
          lens={state.lens}
          context={JSON.stringify(state)}
          restoreFocus={() => heading.current?.focus({ preventScroll: true })}
        />
      )}
      {state.lens !== 'evidence' && (
        <p className="text-xs text-muted-foreground">
          Queries use the existing provider. Entity selection does not scope execution. Provider errors and permissions
          remain authoritative.
        </p>
      )}
    </section>
  )
}
