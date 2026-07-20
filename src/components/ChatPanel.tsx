/**
 * @file ChatPanel.tsx
 * @description Collapsible chat drawer that slides in from the right edge.
 *
 * Always available regardless of which view is active, providing context-aware
 * agent interaction. The agent receives the current view context so it knows
 * what page the user is looking at.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import Chat from '../Chat'
import { cn } from '../lib/utils'
import { MessageCircle, X, Minimize2, Maximize2 } from 'lucide-react'
import { usePageContextEnvelope } from '../lib/page-context'

interface ChatPanelProps {
  /** Current active view for context injection */
  currentView: string
  /** Render the same mounted assistant as the primary `/chat` surface. */
  isPrimary: boolean
}

export default function ChatPanel({ currentView, isPrimary }: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const pageContext = usePageContextEnvelope()

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
    if (isExpanded) setIsExpanded(false)
  }, [isExpanded])

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        setIsExpanded(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <>
      {/* Floating Action Button — visible when panel is closed */}
      <button
        id="chat-panel-toggle"
        onClick={toggle}
        disabled={isPrimary}
        className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center justify-center',
          'w-14 h-14 rounded-full shadow-2xl',
          'bg-gradient-to-br from-violet-600 to-indigo-700',
          'text-white hover:scale-110 active:scale-95',
          'transition-all duration-300 ease-out',
          'hover:shadow-violet-500/40 hover:shadow-lg',
          (isOpen || isPrimary) && 'scale-0 pointer-events-none opacity-0',
        )}
        aria-label="Open chat"
      >
        <MessageCircle className="w-6 h-6" />
        {/* Pulse ring */}
        <span
          className={cn('absolute inset-0 rounded-full', 'bg-violet-500/30 animate-ping')}
          style={{ animationDuration: '3s' }}
        />
      </button>

      {/* Backdrop overlay — subtle darkening when panel is open */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity duration-300',
          isOpen && !isPrimary ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={toggle}
        aria-hidden
      />

      {/* Slide-in Panel */}
      <div
        ref={panelRef}
        inert={!isPrimary && !isOpen}
        aria-hidden={!isPrimary && !isOpen}
        className={cn(
          'flex flex-col bg-background/95 transition-all duration-400 ease-[cubic-bezier(0.32,0.72,0,1)]',
          isPrimary
            ? 'relative z-0 flex-1 min-h-0 w-full border-0 shadow-none translate-x-0'
            : cn(
                'fixed top-0 right-0 z-50 h-full backdrop-blur-xl border-l border-border/50 shadow-2xl shadow-black/20',
                isOpen ? 'translate-x-0' : 'translate-x-full',
                isExpanded ? 'w-[90vw] md:w-[60vw]' : 'w-full md:w-[420px]',
              ),
        )}
      >
        {/* Panel Header */}
        <div
          className={cn(
            'flex items-center justify-between h-14 px-4 border-b border-border/50 shrink-0',
            isPrimary && 'hidden',
          )}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-semibold text-foreground/80">Agent Chat</span>
            <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/50">{currentView}</span>
            {pageContext.selection.length > 0 && (
              <span className="text-xs text-muted-foreground truncate max-w-32">
                {pageContext.selection[0].label ?? pageContext.selection[0].id}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleExpand}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label={isExpanded ? 'Minimize' : 'Maximize'}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={toggle}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Close chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Chat Content — reuse existing Chat component */}
        <div className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', !isPrimary && 'px-2')}>
          <Chat pageContext={pageContext} />
        </div>
      </div>
    </>
  )
}
