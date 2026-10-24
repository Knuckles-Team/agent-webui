import type { ReactNode, RefObject } from 'react'
import { navigateOperate, operateHref, type OperateState } from '@/lib/operate-workspace'
import type { Role } from '@/lib/nav-registry'
import type { OperateComponent } from '@/lib/operate-catalog'

export function OperateComponentInspector({
  server,
  runtimeState,
  components,
  state,
  role,
  heading,
}: {
  server: string
  runtimeState?: string
  components: OperateComponent[]
  state: OperateState
  role: Role
  heading: RefObject<HTMLHeadingElement | null>
}) {
  const component = components.find((entry) => entry.id === state.definition)

  return (
    <section aria-label={`Inspect connector ${server}`} className="min-w-0 space-y-2">
      <p>MCP runtime: {runtimeState ?? 'not reported'}</p>
      <p className="text-sm text-muted-foreground">
        Runtime state describes MCP transport, not upstream provider connectivity.
      </p>
      <h4 ref={heading} tabIndex={-1}>
        Catalog tools and skills
      </h4>
      {state.definition && !component && <p role="alert">This definition is not in the current connector catalog.</p>}
      {components.length === 0 && <p>No tool or skill definitions returned for this connector.</p>}
      {components.map((entry) => (
        <CatalogNavigationLink
          key={entry.id}
          state={{ ...state, definition: entry.id }}
          role={role}
          current={state.definition === entry.id}
        >
          {entry.kind}: {entry.name}
        </CatalogNavigationLink>
      ))}
      {component && (
        <section
          aria-label="Selected catalog definition"
          className="min-w-0 rounded border p-3 [overflow-wrap:anywhere]"
        >
          <h5>{component.name}</h5>
          <p>{component.description || 'No description supplied.'}</p>
          <dl>
            <dt>Identity</dt>
            <dd>{component.id}</dd>
            <dt>Kind</dt>
            <dd>{component.kind}</dd>
            <dt>Lifecycle</dt>
            <dd>{component.status}</dd>
            <dt>Authority</dt>
            <dd>{component.authority}</dd>
            <dt>Revision</dt>
            <dd>{component.revision ?? 'not reported'}</dd>
            <dt>Definition digest</dt>
            <dd>{component.definition_digest ?? 'not reported'}</dd>
            <dt>Content digest</dt>
            <dd>{component.content_digest ?? 'not reported'}</dd>
          </dl>
          <p>Definition inspection does not grant execution permission.</p>
        </section>
      )}
    </section>
  )
}

/** Invalid returned identities remain readable; never truncate or invent a destination. */
export function CatalogNavigationLink({
  state,
  role,
  children,
  expanded,
  current,
}: {
  state: OperateState
  role: Role
  children: ReactNode
  expanded?: boolean
  current?: boolean
}) {
  let href: string
  try {
    href = operateHref(state)
  } catch {
    return <p>{children}: workspace navigation is unavailable for this catalog identity.</p>
  }
  return (
    <a
      href={href}
      className="inline-flex min-h-11 max-w-full items-center rounded border px-3 break-words"
      aria-expanded={expanded}
      aria-current={current ? 'location' : undefined}
      onClick={(event) => {
        if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigateOperate(state, role)
      }}
    >
      {children}
    </a>
  )
}
