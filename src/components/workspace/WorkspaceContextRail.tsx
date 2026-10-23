import { WorkspaceCommandPalette } from './WorkspaceCommands'
import { useEffect, useState } from 'react'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import { navigateWork, parseWorkState } from '@/lib/work-workspace'
import { navigateExplore, parseExploreState } from '@/lib/explore-workspace'
import { navigateOperate, parseOperateState } from '@/lib/operate-workspace'
import { roleAtLeast, type Role } from '@/lib/nav-registry'

/** Anchored outside the scrolling task pane, not a second page sidebar. */
export function WorkspaceContextRail({ active, role }: { active: 'work' | 'explore' | 'operate'; role: Role }) {
  const location = useWorkspaceLocation()
  const [remembered, setRemembered] = useState({
    work: '/workspace/work',
    explore: '/workspace/explore',
    operate: '/workspace/operate',
  })
  useEffect(() => {
    try {
      if (active === 'work') parseWorkState(location)
      else if (active === 'explore') parseExploreState(location)
      else parseOperateState(location)
      setRemembered((previous) => (previous[active] === location ? previous : { ...previous, [active]: location }))
    } catch {
      /* Never retain malformed or unrelated destinations. */
    }
  }, [active, location])
  return (
    <header className="shrink-0 border-b bg-background px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          id="workspace-home"
          className="inline-flex min-h-11 items-center font-semibold"
          href={roleAtLeast(role, 'user') ? remembered.work : remembered.operate}
          onClick={(event) => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            if (roleAtLeast(role, 'user')) navigateWork(parseWorkState(remembered.work), role)
            else navigateOperate(parseOperateState(remembered.operate), role)
          }}
        >
          Arbora
        </a>
        <nav aria-label="Primary workspace contexts" className="flex flex-wrap gap-1">
          {(['work', 'explore', 'operate'] as const).map((context) => (
            <a
              key={context}
              className="inline-flex min-h-11 items-center rounded border px-3 capitalize"
              aria-disabled={!roleAtLeast(role, context === 'operate' ? 'reader' : 'user')}
              aria-current={active === context ? 'page' : undefined}
              href={remembered[context]}
              onClick={(event) => {
                if (!roleAtLeast(role, context === 'operate' ? 'reader' : 'user')) {
                  event.preventDefault()
                  return
                }
                if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                if (context === 'work') navigateWork(parseWorkState(remembered.work), role)
                else if (context === 'explore') navigateExplore(parseExploreState(remembered.explore), role)
                else navigateOperate(parseOperateState(remembered.operate), role)
              }}
            >
              {context}
            </a>
          ))}
        </nav>
        <WorkspaceCommandPalette />
        <a className="inline-flex min-h-11 items-center text-sm underline" href="/privacy">
          Privacy
        </a>
      </div>
    </header>
  )
}
