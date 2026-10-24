import { useEffect, useRef, useState, type ReactNode } from 'react'

function keepDisclosure(event: MouseEvent, anchor: HTMLAnchorElement | null) {
  return [
    event.button,
    event.ctrlKey,
    event.metaKey,
    event.altKey,
    event.shiftKey,
    anchor?.getAttribute('aria-disabled') === 'true',
  ].some(Boolean)
}

/** Compact non-modal header access; desktop presents the same controls inline. */
export function WorkspaceHeaderDisclosure({
  id,
  label,
  caption,
  children,
}: {
  id: string
  label: string
  caption: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = root.current
    function dismiss(event: MouseEvent) {
      const target = event.target as HTMLElement
      const anchor = target.closest('a')
      if (keepDisclosure(event, anchor)) return
      if (!anchor && !target.closest('#workspace-frame-tools-slot button')) return
      setOpen(false)
      if (anchor?.getAttribute('aria-current') && trigger.current?.getClientRects().length) {
        trigger.current.focus()
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || !open) return
      setOpen(false)
      if (trigger.current?.getClientRects().length) trigger.current.focus()
    }
    element?.addEventListener('keydown', escape)
    element?.addEventListener('click', dismiss)
    return () => {
      element?.removeEventListener('click', dismiss)
      element?.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div ref={root} className="workspace-header-disclosure">
      <button
        ref={trigger}
        className="workspace-header-summary"
        aria-label={label}
        aria-controls={id}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        {caption}
      </button>
      <div id={id} className="workspace-header-content" data-open={open}>
        {children}
      </div>
    </div>
  )
}
