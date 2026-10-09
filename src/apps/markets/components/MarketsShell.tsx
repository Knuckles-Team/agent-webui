/**
 * @file MarketsShell.tsx
 * @description Wraps one Markets destination's page content with the
 * five-destination navigation (FUI-01): a side rail beside the content on
 * desktop, a bottom bar below it on mobile. Bottom padding keeps the bar from
 * covering the last row of content.
 */
import type { ReactNode } from 'react'
import { MarketsNav } from './MarketsNav'

export function MarketsShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-4 pb-16 md:pb-0">
      <MarketsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
