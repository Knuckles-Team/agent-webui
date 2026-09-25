/**
 * @file Notices.tsx
 * @description The informational-only and hallucination notices every
 * Markets page carries. A shared snapshot shows the engine-stamped text of its
 * own record instead (see SharePage).
 */
import { Info } from 'lucide-react'
import { HALLUCINATION, INFORMATIONAL_ONLY, MECHANICAL_TRIGGER } from './notices-text'

export interface NoticeText {
  informational: string
  hallucination: string
  trigger: string
}

const DEFAULT_TEXT: NoticeText = {
  informational: INFORMATIONAL_ONLY,
  hallucination: HALLUCINATION,
  trigger: MECHANICAL_TRIGGER,
}

export function MarketsNotices({ text = DEFAULT_TEXT }: { text?: NoticeText }) {
  return (
    <aside aria-label="About this information" className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
      <p className="flex gap-2 font-medium">
        <Info className="size-4 shrink-0" aria-hidden="true" />
        {text.informational}
      </p>
      <p className="mt-1 pl-6 text-muted-foreground">{text.trigger}</p>
      <p className="mt-1 pl-6 text-muted-foreground">{text.hallucination}</p>
    </aside>
  )
}
