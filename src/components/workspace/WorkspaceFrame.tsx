import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { useWorkspaceCommandNavigation } from './WorkspaceCommands'
import { WorkspaceMap } from './WorkspaceMap'
import './WorkspaceFrame.css'

function FrameToolbar({
  heading,
  showMap,
  toggleMap,
  focusMap,
  focusTask,
}: {
  heading: RefObject<HTMLHeadingElement | null>
  showMap: boolean
  toggleMap: () => void
  focusMap: () => void
  focusTask: () => void
}) {
  return (
    <div className="workspace-frame-toolbar">
      <div>
        <span className="workspace-frame-eyebrow">Navigate · inspect · continue</span>
        <h2 ref={heading} tabIndex={-1}>
          Workspace navigation
        </h2>
      </div>
      <div className="workspace-frame-actions">
        <button aria-expanded={showMap} aria-controls="workspace-map" onClick={toggleMap}>
          {showMap ? 'Hide map' : 'Show map'}
        </button>
        <button onClick={focusMap}>Focus map</button>
        <button onClick={focusTask}>Focus current task</button>
      </div>
    </div>
  )
}

/** Keep task/chat children mounted while navigation and viewport presentation change. */
export function WorkspaceFrame({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const catalog = useWorkspaceCommandNavigation()
  const [showMap, setShowMap] = useState(true)
  const heading = useRef<HTMLHeadingElement>(null)
  const task = useRef<HTMLDivElement>(null)
  function focusMap() {
    setShowMap(true)
    heading.current?.focus()
  }
  const taskProps = enabled ? { role: 'region', 'aria-label': 'Current workspace task', tabIndex: -1 } : {}
  return (
    <div className={enabled ? 'workspace-frame' : 'contents'}>
      {enabled && (
        <FrameToolbar
          heading={heading}
          showMap={showMap}
          toggleMap={() => {
            setShowMap(!showMap)
          }}
          focusMap={focusMap}
          focusTask={() => task.current?.focus()}
        />
      )}
      <div className={enabled ? 'workspace-frame-layout' : 'contents'} data-map-open={enabled && showMap}>
        {enabled && (
          <aside id="workspace-map" className="workspace-map" aria-label="Workspace map" hidden={!showMap}>
            <WorkspaceMap
              key={catalog.owner}
              entries={catalog.entries}
              current={catalog.current}
              onSelect={catalog.select}
            />
          </aside>
        )}
        <div ref={task} className={enabled ? 'workspace-task-surface' : 'contents'} {...taskProps}>
          {children}
        </div>
      </div>
    </div>
  )
}
