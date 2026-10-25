import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceCommandNavigation } from './WorkspaceCommands'
import { WorkspaceMap } from './WorkspaceMap'
import { WorkspaceMapResize } from './WorkspaceMapResize'
import { useWorkspaceMapWidth } from './useWorkspaceMapWidth'
import './WorkspaceFrame.css'

function useHeaderSlots(enabled: boolean, owner: string) {
  const [slots, setSlots] = useState<{ toggle: HTMLElement | null; focus: HTMLElement | null }>({
    toggle: null,
    focus: null,
  })
  useLayoutEffect(() => {
    setSlots({
      toggle: enabled ? document.getElementById('workspace-map-toggle-slot') : null,
      focus: enabled ? document.getElementById('workspace-frame-tools-slot') : null,
    })
  }, [enabled, owner])
  return slots
}

function FrameControls({
  slots,
  showMap,
  toggleMap,
  focusMap,
  focusTask,
}: {
  slots: ReturnType<typeof useHeaderSlots>
  showMap: boolean
  toggleMap: () => void
  focusMap: () => void
  focusTask: () => void
}) {
  return (
    <>
      {slots.toggle &&
        createPortal(
          <button
            className="workspace-map-toggle"
            aria-label={showMap ? 'Hide workspace navigation' : 'Browse workspace'}
            aria-expanded={showMap}
            aria-controls="workspace-map"
            onClick={toggleMap}
          >
            Browse
          </button>,
          slots.toggle,
        )}
      {slots.focus &&
        createPortal(
          <div className="workspace-frame-actions">
            <button className="sr-only focus:not-sr-only" aria-label="Skip to navigation" onClick={focusMap}>
              Skip to navigation
            </button>
            <button className="sr-only focus:not-sr-only" aria-label="Skip to content" onClick={focusTask}>
              Skip to content
            </button>
          </div>,
          slots.focus,
        )}
    </>
  )
}

function focusMapFilter(map: HTMLElement | null) {
  map?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
}
function revealFocusedMap(map: HTMLElement | null) {
  const focused = document.activeElement
  if (focused instanceof HTMLElement && map?.contains(focused))
    focused.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
}
function useMapDisclosure() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 64rem)').matches)
  const [mapChoice, setShowMap] = useState<boolean | null>(null)
  const showMap = mapChoice ?? wide
  const map = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const media = window.matchMedia('(min-width: 64rem)')
    function reflow() {
      // Preserve actual interaction; only the automatic wide default collapses.
      if (!media.matches && map.current?.contains(document.activeElement)) setShowMap(true)
      setWide(media.matches)
    }
    reflow()
    media.addEventListener('change', reflow)
    return () => {
      media.removeEventListener('change', reflow)
    }
  }, [])
  const focusRequested = useRef(false)
  useLayoutEffect(() => {
    if (!showMap || !focusRequested.current) return
    focusMapFilter(map.current)
    focusRequested.current = false
  }, [showMap])
  function focusMap() {
    setShowMap(true)
    if (showMap) focusMapFilter(map.current)
    else {
      focusRequested.current = true
    }
  }
  return { showMap, setShowMap, map, focusMap }
}

/** Stable task/chat subtree with presentation controls hosted in the single rail. */
export function WorkspaceFrame({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const catalog = useWorkspaceCommandNavigation()
  const slots = useHeaderSlots(enabled, catalog.owner)
  const { showMap, setShowMap, map, focusMap } = useMapDisclosure()
  const [frame, setFrame] = useState<HTMLDivElement | null>(null)
  const width = useWorkspaceMapWidth(frame)
  const task = useRef<HTMLDivElement>(null)
  const taskProps = enabled ? { role: 'region', 'aria-label': 'Current workspace task', tabIndex: -1 } : {}
  return (
    <div
      ref={setFrame}
      className={enabled ? 'workspace-frame' : 'contents'}
      style={{ '--workspace-map-size': `${width.width}rem` } as CSSProperties}
    >
      <FrameControls
        slots={slots}
        showMap={showMap}
        toggleMap={() => {
          setShowMap(!showMap)
        }}
        focusMap={focusMap}
        focusTask={() => task.current?.focus()}
      />
      <div className={enabled ? 'workspace-frame-layout' : 'contents'} data-map-open={showMap}>
        {enabled && (
          <aside
            ref={map}
            id="workspace-map"
            className="workspace-map"
            aria-label="Workspace map"
            hidden={!showMap}
            onAnimationEnd={() => {
              revealFocusedMap(map.current)
            }}
          >
            <WorkspaceMap
              key={catalog.owner}
              entries={catalog.entries}
              current={catalog.current}
              onSelect={catalog.select}
            />
          </aside>
        )}
        {enabled && showMap && <WorkspaceMapResize control={width} />}
        <div ref={task} className={enabled ? 'workspace-task-surface' : 'contents'} {...taskProps}>
          {children}
        </div>
      </div>
    </div>
  )
}
