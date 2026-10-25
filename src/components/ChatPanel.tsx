/** Native workspace assistant. Presentation changes never replace the Chat instance. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, Sparkles, TextCursorInput } from 'lucide-react'
import { createPortal } from 'react-dom'
import Chat from '../Chat'
import { usePageContextEnvelope } from '../lib/page-context'
import './ChatPanel.css'

interface ChatPanelProps {
  currentView: string
  /** Only the standalone compatibility surface takes the entire task area. */
  isPrimary: boolean
  contextLabel?: string
  purpose?: string
}

function isHiddenWithin(target: HTMLElement, boundary: HTMLElement): boolean {
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (node.hidden || style.display === 'none' || style.visibility === 'hidden') return true
    if (node === boundary) break
  }
  return false
}

/** Keep keyboard focus on a rendered control after disclosure or container reflow. */
function useAssistantFocus(
  panel: RefObject<HTMLElement | null>,
  entry: RefObject<HTMLButtonElement | null>,
  expanded: boolean,
) {
  const focused = useRef<HTMLElement | null>(null)
  const reveal = useCallback(() => {
    const current = panel.current
    const target = focused.current
    if (!current || !target || !current.contains(target) || !isHiddenWithin(target, current)) return
    if (current.hidden) entry.current?.focus()
    else current.querySelector<HTMLTextAreaElement>('#chat-message-input')?.focus()
  }, [entry, panel])
  useEffect(() => {
    const current = panel.current
    if (!current) return
    const remember = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return
      if (current.contains(event.target)) focused.current = event.target
      else if (event.target !== document.body) focused.current = null
    }
    window.addEventListener('focusin', remember)
    window.addEventListener('resize', reveal)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal)
    observer?.observe(current.closest('.workspace-chat-boundary') ?? current)
    return () => {
      window.removeEventListener('focusin', remember)
      window.removeEventListener('resize', reveal)
      observer?.disconnect()
    }
  }, [panel, reveal])
  useLayoutEffect(reveal, [expanded, reveal])
}

export default function ChatPanel({ currentView, isPrimary, contextLabel, purpose }: ChatPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const entryButton = useRef<HTMLButtonElement>(null)
  const [entrySlot, setEntrySlot] = useState<HTMLElement | null>(null)
  const [statusTarget, setStatusTarget] = useState<HTMLDivElement | null>(null)
  const [hasApproval, setHasApproval] = useState(false)
  const [reviewRequest, setReviewRequest] = useState(0)
  useAssistantFocus(panel, entryButton, isExpanded || isPrimary)
  useLayoutEffect(() => {
    // Identity changes can replace the header without changing the current route.
    const nextSlot = document.getElementById('workspace-assistant-entry-slot')
    if (entrySlot !== nextSlot) setEntrySlot(nextSlot)
  })
  useEffect(() => {
    const current = panel.current
    if (!current) return
    // Observe the existing review UI, never infer or make an approval decision.
    const update = () => {
      setHasApproval(Boolean(current.querySelector('[data-chat-approval-pending]')))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(current, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-chat-approval-pending'],
    })
    return () => {
      observer.disconnect()
    }
  }, [])
  useLayoutEffect(() => {
    if (!reviewRequest) return
    const review = panel.current?.querySelector<HTMLElement>('[data-chat-approval-pending]')
    review?.focus()
    review?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [reviewRequest])
  const pageContext = usePageContextEnvelope()
  const selection = pageContext.selection.at(0)
  useEffect(() => {
    const current = panel.current
    if (!current || !isExpanded) return
    function restoreOnEscape(event: KeyboardEvent) {
      // A nested menu/dialog owns its Escape; unrelated workspace focus never resizes chat.
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        !(event.target instanceof Node) ||
        !current?.contains(event.target)
      )
        return
      event.preventDefault()
      setIsExpanded(false)
    }
    // React child handlers run at the root before this window bubble listener.
    window.addEventListener('keydown', restoreOnEscape)
    return () => {
      window.removeEventListener('keydown', restoreOnEscape)
    }
  }, [isExpanded])
  const reviewApproval = () => {
    setIsExpanded(true)
    setReviewRequest((request) => request + 1)
  }
  const entry = (
    <div className="workspace-assistant-entry" data-expanded={isExpanded}>
      <button
        ref={entryButton}
        type="button"
        className="workspace-assistant-disclosure"
        aria-label={isExpanded ? 'Restore chat size' : 'Expand chat'}
        aria-expanded={isExpanded}
        aria-pressed={isExpanded}
        aria-controls="workspace-assistant"
        onClick={() => {
          setIsExpanded((expanded) => !expanded)
        }}
      >
        <Sparkles aria-hidden="true" className="size-4" />
        <span>Agent</span>
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      <div ref={setStatusTarget} className="workspace-assistant-status" />
      {hasApproval && (
        <button type="button" className="workspace-assistant-review" onClick={reviewApproval}>
          Review required approval
        </button>
      )}
    </div>
  )
  return (
    <>
      {!isPrimary && (entrySlot ? createPortal(entry, entrySlot) : entry)}
      <section
        id="workspace-assistant"
        ref={panel}
        aria-label="Workspace assistant"
        className="workspace-assistant"
        data-expanded={isExpanded}
        data-primary={isPrimary}
        hidden={!isPrimary && !isExpanded}
      >
        <header className="workspace-assistant-header">
          <div className="workspace-assistant-context">
            <h2>Assistant</h2>
            <p>
              <span>{contextLabel ?? currentView}</span>
              {selection && <span className="workspace-assistant-selection">{selection.label ?? selection.id}</span>}
            </p>
          </div>
          <div className="workspace-assistant-actions">
            <button
              type="button"
              aria-label="Focus message input"
              onClick={() => {
                panel.current?.querySelector<HTMLTextAreaElement>('#chat-message-input')?.focus()
              }}
            >
              <TextCursorInput aria-hidden="true" className="size-4" />
              <span>Write</span>
            </button>
          </div>
        </header>
        {purpose && <p className="workspace-assistant-purpose">{purpose}</p>}
        <div id="workspace-assistant-content" className="workspace-assistant-content">
          <Chat
            pageContext={pageContext}
            focusOnMount={isPrimary}
            compactStatusTarget={isPrimary ? null : statusTarget}
          />
        </div>
      </section>
    </>
  )
}
