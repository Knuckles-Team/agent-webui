/**
 * @file RawRenderer.tsx
 * @description The untransformed adapter payload.
 *
 * `accepts` is unconditionally true: there is ALWAYS an escape hatch to what the
 * backend actually said. When a projection looks wrong, this is how a user tells
 * whether the adapter mis-projected it or the backend never sent it.
 */
import { FileJson } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area'
import type { AtlasRenderer, RendererProps } from '@/lib/atlas/renderers'
import { toPrettyJson } from '@/lib/atlas/text'

/** Payloads above this are elided rather than stringified — a megabyte of JSON hangs the tab. */
const MAX_CHARS = 200_000

function serialize(payload: unknown): string {
  const text = toPrettyJson(payload)
  if (text.length <= MAX_CHARS) return text
  return `${text.slice(0, MAX_CHARS)}\n\n… elided: payload is ${text.length.toLocaleString()} characters.`
}

function RawRendererBody({ projection }: RendererProps) {
  return (
    <ScrollArea className="h-full w-full">
      <pre className="p-3 font-mono text-xs" data-testid="atlas-raw">
        {serialize(projection.result.payload)}
      </pre>
    </ScrollArea>
  )
}

export const rawRenderer: AtlasRenderer = {
  id: 'raw',
  label: 'Raw',
  icon: FileJson,
  priority: 10,
  accepts: () => true,
  component: RawRendererBody,
}
