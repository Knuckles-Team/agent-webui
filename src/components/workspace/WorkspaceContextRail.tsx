import arboraLogo from '../../../docs/assets/brands/agent-webui-logo-v1.png'
import { WorkspaceAppearance } from './WorkspaceAppearance'
import { WorkspaceCommandPalette } from './WorkspaceCommands'
import { useEffect, useState } from 'react'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import { navigateWork, parseWorkState } from '@/lib/work-workspace'
import { EXPLORE_LENSES, exploreLensHref, navigateExploreLens, parseExploreLensState } from '@/lib/explore-lens-state'
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
      else if (active === 'explore') parseExploreLensState(location)
      else parseOperateState(location)
      setRemembered((previous) => (previous[active] === location ? previous : { ...previous, [active]: location }))
    } catch {
      /* Never retain malformed or unrelated destinations. */
    }
  }, [active, location])
  const exploreDestination = (() => {
    const state = parseExploreLensState(remembered.explore)
    return exploreLensHref(!roleAtLeast(role, 'maintainer') ? { ...state, lens: 'evidence' } : state)
  })()
  return (
    <header className="workspace-context-rail shrink-0">
      <div className="workspace-header-row">
        <a
          id="workspace-home"
          aria-label="Overstory"
          className="inline-flex min-h-11 items-center font-semibold"
          href={roleAtLeast(role, 'user') ? remembered.work : remembered.operate}
          onClick={(event) => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            if (roleAtLeast(role, 'user')) navigateWork(parseWorkState(remembered.work), role)
            else navigateOperate(parseOperateState(remembered.operate), role)
          }}
        >
          <img src={arboraLogo} alt="Arbora" className="workspace-brand-logo" />
          <span aria-hidden="true">Overstory</span>
        </a>
        <div className="workspace-context-navigation">
          <nav aria-label="Primary workspace contexts" className="flex flex-wrap gap-1">
            {(['work', 'explore', 'operate'] as const).map((context) => (
              <a
                key={{ work: 'Chat', explore: 'Knowledge', operate: 'Tools' }[context]}
                className="inline-flex min-h-11 items-center rounded border px-3 capitalize"
                aria-disabled={!roleAtLeast(role, context === 'operate' ? 'reader' : 'user')}
                aria-current={active === context ? 'page' : undefined}
                href={context === 'explore' ? exploreDestination : remembered[context]}
                onClick={(event) => {
                  if (!roleAtLeast(role, context === 'operate' ? 'reader' : 'user')) {
                    event.preventDefault()
                    return
                  }
                  if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  if (context === 'work') navigateWork(parseWorkState(remembered.work), role)
                  else if (context === 'explore')
                    navigateExploreLens(parseExploreLensState(exploreDestination), role, EXPLORE_LENSES)
                  else navigateOperate(parseOperateState(remembered.operate), role)
                }}
              >
                {{ work: 'Chat', explore: 'Knowledge', operate: 'Tools' }[context]}
              </a>
            ))}
          </nav>
        </div>
        <div id="workspace-map-toggle-slot" />
        <div className="workspace-command-entry">
          <WorkspaceCommandPalette />
        </div>
        <div id="workspace-frame-tools-slot" />
        <div id="workspace-assistant-entry-slot" />
        <div className="workspace-header-utilities">
          <WorkspaceAppearance />
        </div>
      </div>
    </header>
  )
}
