import { useLayoutEffect } from 'react'

/** Keep retained focus reachable after a workspace or portal scrollport resizes. */
export function useWorkspaceViewportBoundary(element: HTMLElement | null, enabled: boolean) {
  useLayoutEffect(() => {
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
    const settle = (event: Event) => {
      if (event.target === element) schedule()
    }
    schedule()
    window.addEventListener('resize', schedule)
    viewport?.addEventListener('resize', schedule)
    element.addEventListener('focusin', schedule)
    element.addEventListener('animationend', settle)
    element.addEventListener('transitionend', settle)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      viewport?.removeEventListener('resize', schedule)
      element.removeEventListener('focusin', schedule)
      element.removeEventListener('animationend', settle)
      element.removeEventListener('transitionend', settle)
      element.style.removeProperty('--workspace-visible-height')
    }
  }, [element, enabled])
}
