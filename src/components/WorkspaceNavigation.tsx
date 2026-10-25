import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { WorkspaceAppearance } from '@/components/workspace/WorkspaceAppearance'
import { useAppAvailability } from '@/lib/apps/catalog'
import { isDynamicPath, roleAtLeast, ROUTES, SECTIONS, type Role, type RouteDef } from '@/lib/nav-registry'
import { describeWorkspaceDestination, navigateWorkspace, useWorkspaceLocation } from '@/lib/workspace-navigation'

/** Compact, progressively enhanced branch navigator. Existing route bodies stay mounted normally. */
export function WorkspaceNavigation({ route, currentRole }: { route: RouteDef; currentRole: Role }) {
  const location = useWorkspaceLocation()
  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<'branches' | 'list'>('branches')
  const [error, setError] = useState('')
  const disclosure = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  const availability = useAppAvailability()
  const destination = describeWorkspaceDestination(location)
  const selectedReference = destination ? Object.values(destination.parameters).join(' / ') : ''
  const section = SECTIONS.find((entry) => entry.id === route.section)
  const candidates = ROUTES.filter(
    (entry) =>
      !isDynamicPath(entry.path) &&
      roleAtLeast(currentRole, entry.minRole) &&
      `${entry.label} ${entry.blurb} ${entry.id}`.toLowerCase().includes(query.toLowerCase().trim()),
  )

  useEffect(() => {
    if (disclosure.current?.open) {
      disclosure.current.open = false
      summary.current?.focus()
    }
  }, [location])

  useEffect(() => {
    const element = disclosure.current
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && element?.open) {
        event.preventDefault()
        element.open = false
        summary.current?.focus()
      }
    }
    element?.addEventListener('keydown', closeOnEscape)
    return () => element?.removeEventListener('keydown', closeOnEscape)
  }, [])

  function navigate(event: MouseEvent<HTMLAnchorElement>, target: RouteDef) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    try {
      navigateWorkspace(target.path, currentRole)
      setError('')
      if (disclosure.current) disclosure.current.open = false
      summary.current?.focus()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Navigation unavailable')
    }
  }

  return (
    <header className="relative z-20 shrink-0 border-b bg-background">
      <div className="flex min-h-12 min-w-0 flex-wrap items-center gap-1 px-2 sm:px-3">
        <SidebarTrigger className="min-h-11 min-w-11" />
        <nav aria-label="Workspace context" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm">
          <a
            id="workspace-home"
            href="/"
            onClick={(event) => {
              navigate(
                event,
                ROUTES.find((entry) => entry.path === '/')!,
              )
            }}
            className="inline-flex min-h-11 items-center font-semibold"
          >
            Arbora
          </a>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="text-muted-foreground">{section?.label}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span aria-current="page" className="break-all font-medium">
            {route.label}
            {selectedReference ? ` / ${selectedReference}` : ''}
          </span>
        </nav>
        <div id="workspace-assistant-entry-slot" />
        <WorkspaceAppearance />
        <details ref={disclosure} className="group">
          <summary
            ref={summary}
            className="flex min-h-11 cursor-pointer list-none items-center rounded-md px-3 text-sm font-medium hover:bg-accent"
          >
            Explore branches
          </summary>
          <section
            aria-label="Workspace branches"
            className="absolute inset-x-0 top-full max-h-[70dvh] overflow-auto border-b bg-background p-3 shadow-lg sm:p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="min-w-0 flex-1 text-sm">
                Find a destination
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                  }}
                  type="search"
                  className="mt-1 block min-h-11 w-full rounded-md border bg-background px-3"
                />
              </label>
              <div aria-label="Navigation layout" className="flex gap-1">
                <Button
                  variant="outline"
                  className="min-h-11"
                  aria-pressed={layout === 'branches'}
                  onClick={() => {
                    setLayout('branches')
                  }}
                >
                  Branches
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  aria-pressed={layout === 'list'}
                  onClick={() => {
                    setLayout('list')
                  }}
                >
                  List
                </Button>
              </div>
            </div>
            {error && <p role="alert">{error}</p>}
            {candidates.length === 0 && <p role="status">No matching destinations available for your role.</p>}
            <div
              className={
                layout === 'branches'
                  ? 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3'
                  : 'space-y-3'
              }
            >
              {SECTIONS.map((branch) => {
                const entries = candidates.filter((entry) => entry.section === branch.id)
                if (!entries.length) return null
                return (
                  <section key={branch.id} aria-label={branch.label} className="min-w-0 rounded-md border p-2">
                    <h2 className="mb-1 border-l-2 border-primary pl-2 text-sm font-semibold">{branch.label}</h2>
                    <ul>
                      {entries.map((entry) => {
                        const unavailable =
                          entry.capability !== undefined && !availability.available.has(entry.capability)
                        const reason = availability.loading
                          ? 'Checking availability'
                          : (availability.reasons.get(entry.capability ?? '') ?? 'Unavailable on this deployment')
                        return (
                          <li key={entry.id}>
                            <a
                              href={entry.path}
                              onClick={(event) => {
                                navigate(event, entry)
                              }}
                              aria-current={entry.id === route.id ? 'page' : undefined}
                              className="flex min-h-11 flex-wrap items-center gap-x-2 rounded px-2 py-1 text-sm hover:bg-accent aria-[current=page]:bg-accent"
                            >
                              <span className="break-words">{entry.label}</span>
                              {unavailable && <span className="text-xs text-muted-foreground">{reason}</span>}
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Object and approval details open from their selected records. Availability and permission checks still
              apply.
            </p>
          </section>
        </details>
      </div>
    </header>
  )
}
