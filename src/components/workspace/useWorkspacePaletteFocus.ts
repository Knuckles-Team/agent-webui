import { useCallback, useRef } from 'react'

function reachable(element: HTMLElement | null): element is HTMLElement {
  return (
    !!element?.isConnected &&
    element !== document.body &&
    !element.matches(':disabled') &&
    element.getClientRects().length > 0
  )
}

/** Modal cancellation returns to a visible opener, not a collapsed header control. */
export function useWorkspacePaletteFocus(location: string) {
  const trigger = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const openedLocation = useRef(location)
  const navigating = useRef(false)
  const onNavigate = useCallback(() => {
    navigating.current = true
  }, [])
  return {
    trigger,
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      openedLocation.current = location
      navigating.current = false
    },
    onNavigate,
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault()
      // Native destinations own focus after selection or Back/Forward.
      if (navigating.current || openedLocation.current !== location) return
      const summary =
        trigger.current
          ?.closest('.workspace-header-disclosure')
          ?.querySelector<HTMLButtonElement>('.workspace-header-summary') ?? null
      const target = [opener.current, trigger.current, summary].find(reachable)
      target?.focus()
    },
  }
}
