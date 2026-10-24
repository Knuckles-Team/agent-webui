import { useLayoutEffect, useRef, type ReactNode } from 'react'
import './WorkspaceViewport.css'

/** Resize the retained workspace, without replacing its editors or moving focus. */
export function WorkspaceViewport({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = surface.current
    if (!enabled || !element) return
    const viewport = window.visualViewport
    let frame = 0
    const revealFocus = () => {
      if (viewport && viewport.scale !== 1) return
      const focused = document.activeElement
      if (focused instanceof HTMLElement && element.contains(focused)) {
        focused.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
      }
    }
    const update = () => {
      // Pinch zoom should magnify the existing layout, not repeatedly reflow it.
      if (viewport && viewport.scale !== 1) return
      if (viewport) element.style.setProperty('--workspace-visible-height', `${viewport.height}px`)
      // Let the resized scrollports settle before revealing the retained focus.
      frame = requestAnimationFrame(revealFocus)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    schedule()
    window.addEventListener('resize', schedule)
    viewport?.addEventListener('resize', schedule)
    element.addEventListener('focusin', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      viewport?.removeEventListener('resize', schedule)
      element.removeEventListener('focusin', schedule)
      element.style.removeProperty('--workspace-visible-height')
    }
  }, [enabled])
  return (
    <div
      ref={surface}
      className={enabled ? 'workspace-viewport' : 'flex min-w-0 flex-1 flex-col h-dvh overflow-hidden'}
    >
      {children}
    </div>
  )
}
