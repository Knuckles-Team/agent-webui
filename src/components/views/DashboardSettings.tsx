/**
 * @file DashboardSettings.tsx
 * @description Settings modal for customizing the Agent-OS dashboard layout.
 *
 * Allows users to configure grid columns, card size, theme, refresh interval,
 * and toggle individual service visibility.
 */

import { useState, useCallback } from 'react'
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

  const toggle = useCallback(() => setIsOpen((p) => !p), [])

  return (
    <>
      {/* Trigger Button */}
      <button
        id="dashboard-settings-trigger"
        onClick={toggle}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
          'text-muted-foreground hover:text-foreground',
          'hover:bg-muted/60 transition-all duration-200',
          'border border-transparent hover:border-border/30',
        )}
      >
        <Settings2 className="w-4 h-4" />
        <span className="hidden sm:inline">Customize</span>
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={toggle}
          />
          <div
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
                <h2 className="text-lg font-semibold">Dashboard Settings</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Customize your Agent-OS desktop experience
                </p>
              </div>
              <button
                onClick={toggle}
                className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-5 space-y-6">
              {/* Theme */}
              <div>
                <label className="text-sm font-medium mb-2 block">Theme</label>
                <div className="grid grid-cols-4 gap-2">
                  {THEMES.map((t) => {
                    const Icon = t.icon
                    return (
                      <button
                        key={t.id}
                        onClick={() => onThemeChange(t.id)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 rounded-xl',
                          'border transition-all duration-200',
                          theme === t.id
                            ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                            : 'border-border/30 hover:border-border/60 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-xs">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Grid Columns */}
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Grid Columns
                </label>
                <div className="flex gap-2">
                  {COLUMN_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => onColumnsChange(n)}
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
              </div>

              {/* Card Size */}
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Card Size
                </label>
                <div className="flex gap-2">
                  {CARD_SIZES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onCardSizeChange(s.id)}
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
              </div>

              {/* Refresh Interval */}
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Refresh Interval
                </label>
                <div className="flex gap-2">
                  {REFRESH_OPTIONS.map((sec) => (
                    <button
                      key={sec}
                      onClick={() => onRefreshIntervalChange(sec)}
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
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border/30 flex justify-end">
              <button
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
