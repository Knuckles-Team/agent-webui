/**
 * @file PanelShell.tsx
 * @description Shared chrome for a single dashboard panel — a Card with a title,
 * optional badge, refresh + remove controls, and a body slot. Keeps every panel
 * type (PromQL / logs / traces) visually consistent inside the dashboard grid.
 */

import type { ReactNode } from 'react'
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export interface PanelShellProps {
  title: string
  icon: ReactNode
  description?: string
  badge?: ReactNode
  loading?: boolean
  onRefresh?: () => void
  onRemove?: () => void
  children: ReactNode
}

export function PanelShell({
  title,
  icon,
  description,
  badge,
  loading,
  onRefresh,
  onRemove,
  children,
}: PanelShellProps) {
  return (
    <Card data-testid="dashboard-panel">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-2">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            <span className="truncate">{title}</span>
            {badge}
          </CardTitle>
          {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onRefresh ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh panel"
              disabled={loading}
              onClick={() => {
                onRefresh()
              }}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </Button>
          ) : null}
          {onRemove ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove panel"
              onClick={() => {
                onRemove()
              }}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

/** Amber "capability not activated" notice for routes the backend hasn't wired. */
export function CapabilityNotice({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm">
      <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-muted-foreground">
        The <span className="font-mono">{label}</span> gateway route is not activated on this backend yet.{' '}
        {detail ?? (
          <>
            Wire it in <span className="font-mono">agent_utilities.gateway.graph_api</span> to see live data here.
          </>
        )}
      </p>
    </div>
  )
}

/** Inline error strip for a failed (non-404) query. */
export function PanelError({ message }: { message: string }) {
  return (
    <pre className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
      {message}
    </pre>
  )
}
