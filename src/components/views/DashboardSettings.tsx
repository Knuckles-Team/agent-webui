/**
 * @file DashboardSettings.tsx
 * @description Settings modal for customizing the Agent-OS dashboard layout.
 *
 * Allows users to configure grid columns, card size, theme, refresh interval,
 * and toggle individual service visibility.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Settings2, X, Monitor, Moon, Sun, Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'

interface DashboardSettingsProps {
  columns: number
  cardSize: string
  theme: string
  refreshInterval: number
  onColumnsChange: (cols: number) => void
  onCardSizeChange: (size: string) => void
  onThemeChange: (theme: string) => void
  onRefreshIntervalChange: (interval: number) => void
}

const THEMES = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'glass', label: 'Glass', icon: Sparkles },
]

const CARD_SIZES = [
  { id: 'small', label: 'Compact' },
  { id: 'medium', label: 'Standard' },
  { id: 'large', label: 'Expanded' },
]

const COLUMN_OPTIONS = [2, 3, 4, 5, 6]
const REFRESH_OPTIONS = [10, 15, 30, 60, 120]

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  )
}

function handleDialogKeyDown(event: KeyboardEvent, dialog: HTMLDivElement | null): void {
  if (event.key !== 'Tab' || !dialog?.contains(document.activeElement)) return
  const focusable = getFocusableElements(dialog)
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function useDashboardSettingsFocus(isOpen: boolean, setIsOpen: (open: boolean) => void) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    let handleKeyDown: ((event: KeyboardEvent) => void) | undefined
    if (isOpen) {
      wasOpen.current = true
      const focusable = dialogRef.current ? getFocusableElements(dialogRef.current) : []
      const initialFocus = focusable[0] ?? dialogRef.current
      initialFocus.focus()
      handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setIsOpen(false)
          return
        }
        handleDialogKeyDown(event, dialogRef.current)
      }
      window.addEventListener('keydown', handleKeyDown)
    } else {
      if (wasOpen.current) triggerRef.current?.focus()
      wasOpen.current = false
    }

    return () => {
      if (handleKeyDown) window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, setIsOpen])

  return { triggerRef, dialogRef }
}

export default function DashboardSettings({
  columns,
  cardSize,
  theme,
  refreshInterval,
  onColumnsChange,
  onCardSizeChange,
  onThemeChange,
  onRefreshIntervalChange,
}: DashboardSettingsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { triggerRef, dialogRef } = useDashboardSettingsFocus(isOpen, setIsOpen)

  const toggle = useCallback(() => {
    setIsOpen((p) => !p)
  }, [])

  return (
    <>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        id="dashboard-settings-trigger"
        aria-expanded={isOpen}
        aria-controls="dashboard-settings-dialog"
        aria-label="Customize dashboard"
        onClick={toggle}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
          'text-muted-foreground hover:text-foreground',
          'hover:bg-muted/60 transition-all duration-200',
          'border border-transparent hover:border-border/30',
        )}
      >
        <Settings2 className="w-4 h-4" aria-hidden="true" />
        <span className="hidden sm:inline">Customize</span>
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button
            type="button"
            aria-label="Close dashboard settings"
            className="absolute inset-0 border-0 bg-black/40 p-0 backdrop-blur-sm"
            onClick={toggle}
          />
          <div
            ref={dialogRef}
            id="dashboard-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-settings-title"
            aria-describedby="dashboard-settings-description"
            tabIndex={-1}
            className={cn(
              'relative z-10 w-full max-w-lg mx-4',
              'bg-background/95 backdrop-blur-xl',
              'rounded-2xl border border-border/50',
              'shadow-2xl shadow-black/20',
              'animate-in fade-in zoom-in-95 duration-200',
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
              <div>
                <h2 id="dashboard-settings-title" className="text-lg font-semibold">
                  Dashboard Settings
                </h2>
                <p id="dashboard-settings-description" className="text-xs text-muted-foreground mt-0.5">
                  Choose a theme, card layout, and how often dashboard data refreshes.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close dashboard settings"
                onClick={toggle}
                className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-5 space-y-6">
              {/* Theme */}
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="text-sm font-medium mb-2 block">Theme</legend>
                <div className="grid grid-cols-4 gap-2">
                  {THEMES.map((t) => {
                    const Icon = t.icon
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-label={`${t.label} theme`}
                        aria-pressed={theme === t.id}
                        onClick={() => {
                          onThemeChange(t.id)
                        }}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 rounded-xl',
                          'border transition-all duration-200',
                          theme === t.id
                            ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                            : 'border-border/30 hover:border-border/60 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="w-5 h-5" aria-hidden="true" />
                        <span className="text-xs">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              {/* Grid Columns */}
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="text-sm font-medium mb-2 block">Grid Columns</legend>
                <div className="flex gap-2">
                  {COLUMN_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`Use ${n} grid columns`}
                      aria-pressed={columns === n}
                      onClick={() => {
                        onColumnsChange(n)
                      }}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-sm font-medium',
                        'border transition-all duration-200',
                        columns === n
                          ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                          : 'border-border/30 text-muted-foreground hover:text-foreground hover:border-border/60',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Card Size */}
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="text-sm font-medium mb-2 block">Card Size</legend>
                <div className="flex gap-2">
                  {CARD_SIZES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-label={`${s.label} card size`}
                      aria-pressed={cardSize === s.id}
                      onClick={() => {
                        onCardSizeChange(s.id)
                      }}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-sm font-medium',
                        'border transition-all duration-200',
                        cardSize === s.id
                          ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                          : 'border-border/30 text-muted-foreground hover:text-foreground hover:border-border/60',
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Refresh Interval */}
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="text-sm font-medium mb-2 block">Refresh Interval</legend>
                <div className="flex gap-2">
                  {REFRESH_OPTIONS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      aria-label={`Refresh dashboard every ${sec} seconds`}
                      aria-pressed={refreshInterval === sec}
                      onClick={() => {
                        onRefreshIntervalChange(sec)
                      }}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-sm font-medium',
                        'border transition-all duration-200',
                        refreshInterval === sec
                          ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                          : 'border-border/30 text-muted-foreground hover:text-foreground hover:border-border/60',
                      )}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border/30 flex justify-end">
              <button
                type="button"
                onClick={toggle}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium',
                  'bg-gradient-to-r from-violet-600 to-indigo-600',
                  'text-white hover:opacity-90 transition-opacity',
                )}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
