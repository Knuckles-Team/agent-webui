import { useState, type ReactNode } from 'react'
import { useWorkspaceViewportBoundary } from './useWorkspaceViewportBoundary'
import './WorkspaceViewport.css'

/** Resize the retained workspace, without replacing its editors or moving focus. */
export function WorkspaceViewport({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [surface, setSurface] = useState<HTMLDivElement | null>(null)
  useWorkspaceViewportBoundary(surface, enabled)
  return (
    <div
      ref={setSurface}
      className={enabled ? 'workspace-viewport' : 'flex min-w-0 flex-1 flex-col h-dvh overflow-auto'}
    >
      {children}
    </div>
  )
}
