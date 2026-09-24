/**
 * @file ShareDialog.tsx
 * @description Share the analysis on screen as an immutable snapshot with a
 * time-limited link (EH-421). An optional note is a claim, so it needs a
 * source; the engine refuses an unsourced claim anyway. Positions are never
 * included.
 */
import { useState, type SyntheticEvent, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createShare, type ShareNote } from '../api'
import type { ShareCreated } from '../schemas'
import type { ChartSettings } from '../view-state'
import { RequestFailed } from './Availability'
import { HALLUCINATION, INFORMATIONAL_ONLY } from './notices-text'

interface Draft {
  hours: number
  note: string
  sourceTitle: string
  sourceUrl: string
}

const EMPTY: Draft = { hours: 24, note: '', sourceTitle: '', sourceUrl: '' }

function notes(draft: Draft): ShareNote[] {
  if (!draft.note.trim()) return []
  return [{ text: draft.note.trim(), sources: [{ title: draft.sourceTitle.trim(), url: draft.sourceUrl.trim() }] }]
}

function noteProblem(draft: Draft): string | null {
  if (!draft.note.trim()) return null
  if (!draft.sourceTitle.trim() || !/^https?:\/\//.test(draft.sourceUrl.trim())) {
    return 'A note is a claim: give it a source title and an http(s) link.'
  }
  return null
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  )
}

function Created({ created }: { created: ShareCreated }) {
  const link = `${window.location.origin}${created.path}`
  return (
    <div role="status" className="space-y-2 text-sm">
      <p>
        Shared. The link works for signed-in people on this deployment until{' '}
        {new Date(created.expires_at).toLocaleString()}.
      </p>
      <input
        readOnly
        aria-label="Share link"
        value={link}
        className="w-full rounded-md border px-2 py-1 font-mono text-xs"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(link).catch(() => {
            // Copying can be refused by the browser; the link stays selectable above.
          })
        }}
      >
        Copy link
      </Button>
      <p className="text-xs text-muted-foreground">Snapshot {created.digest.slice(0, 19)}…</p>
    </div>
  )
}

export function ShareDialog({
  open,
  onOpenChange,
  listingId,
  settings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listingId: string
  settings: ChartSettings
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const share = useMutation({
    mutationFn: () => createShare({ listing_id: listingId, ...settings, notes: notes(draft), hours: draft.hours }),
  })
  const problem = noteProblem(draft)
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    if (!problem) share.mutate()
  }
  const input = 'w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this analysis</DialogTitle>
          <DialogDescription>
            {INFORMATIONAL_ONLY} {HALLUCINATION}
          </DialogDescription>
        </DialogHeader>
        {share.data ? (
          <Created created={share.data} />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Link lifetime">
              <select
                value={draft.hours}
                onChange={(e) => {
                  setDraft({ ...draft, hours: Number(e.target.value) })
                }}
                className={input}
              >
                {[1, 4, 12, 24].map((hours) => (
                  <option key={hours} value={hours}>{`${hours} hour${hours > 1 ? 's' : ''}`}</option>
                ))}
              </select>
            </Field>
            <Field label="Note (optional)">
              <textarea
                value={draft.note}
                maxLength={2000}
                onChange={(e) => {
                  setDraft({ ...draft, note: e.target.value })
                }}
                className={input}
              />
            </Field>
            {draft.note.trim() && (
              <>
                <Field label="Source title">
                  <input
                    value={draft.sourceTitle}
                    onChange={(e) => {
                      setDraft({ ...draft, sourceTitle: e.target.value })
                    }}
                    className={input}
                  />
                </Field>
                <Field label="Source link">
                  <input
                    type="url"
                    value={draft.sourceUrl}
                    onChange={(e) => {
                      setDraft({ ...draft, sourceUrl: e.target.value })
                    }}
                    className={input}
                  />
                </Field>
              </>
            )}
            {problem && <p className="text-sm text-amber-700 dark:text-amber-400">{problem}</p>}
            {share.isError && <RequestFailed what="The share link" error={share.error} />}
            <Button type="submit" disabled={share.isPending || problem !== null}>
              {share.isPending ? 'Sharing…' : 'Create link'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
