/**
 * @file QueryConsole.tsx
 * @description The top-centre region: the modality-aware query console.
 *
 * Two modes, decided by `capabilities().rawQuery`:
 *  - the adapter has a textual language (`parse` implemented) → a live editor, and
 *    what the user types is what runs;
 *  - it does not → the SAME box, read-only, showing `describe(compile(filters))`.
 *
 * The read-only mode matters. A console that pretended to be editable for a modality
 * with no query language would take input and silently ignore it; showing the compiled
 * query instead tells the user exactly what the facets built.
 */
import { Loader2, Play } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AdapterCapabilities } from '@/lib/atlas/types'

export interface QueryConsoleProps {
  text: string
  capabilities: AdapterCapabilities
  running: boolean
  onChange: (text: string) => void
  onRun: () => void
}

export function QueryConsole({ text, capabilities, running, onChange, onRun }: QueryConsoleProps) {
  const editable = capabilities.rawQuery
  return (
    <div className="space-y-2" data-testid="atlas-query-console">
      <div className="flex items-start gap-2">
        <Textarea
          aria-label="Query"
          value={text}
          readOnly={!editable}
          rows={3}
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onRun()
          }}
          className={`flex-1 font-mono text-xs ${editable ? '' : 'bg-muted/40'}`}
        />
        <Button onClick={onRun} disabled={running} data-testid="atlas-run">
          {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
          Run
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {capabilities.rawQueryLanguage && <Badge variant="secondary">{capabilities.rawQueryLanguage}</Badge>}
        {!editable && (
          <span className="text-muted-foreground text-xs">
            Read-only: this modality has no text query language here — edit the filters instead.
            {capabilities.notes?.rawQuery ? ` ${capabilities.notes.rawQuery}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
