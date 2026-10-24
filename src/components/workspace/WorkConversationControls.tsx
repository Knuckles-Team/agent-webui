import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { readConversationMessages } from '@/lib/chat-store'
import {
  LocalConversationLabel,
  localConversationSnapshot,
  removeLocalConversation,
  renameLocalConversation,
} from '@/lib/work-conversation-history'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'

const requestSchema = z
  .object({ action: z.enum(['new', 'rename', 'remove']), label: LocalConversationLabel.optional() })
  .strict()
type Request = z.infer<typeof requestSchema>
const resultSchema = z.object({ reviewRequired: z.literal(true) }).strict()
const button = 'min-h-11 rounded border px-3 py-2 text-sm'
const titles = { new: 'Start a new conversation', rename: 'Rename local copy', remove: 'Remove local copy' }
const descriptions = {
  new: 'This clears the unsent draft and opens a fresh conversation. Saved history and selected task or trace stay available.',
  rename:
    'Only this browser’s local label changes. A server-provided name may still appear in the conversation selector.',
  remove:
    'Remove this owner’s local index entry and cached messages, then open a fresh conversation. This clears the unsent draft. Server history is not deleted and can remain in the selector.',
}
interface Props {
  enabled?: boolean
  owner: string
  conversation: string
  onNew: () => void
  /** Test-only seam; production requires a trusted browser interaction. */
  isAttendedGesture?: (event: MouseEvent<HTMLButtonElement>) => boolean
}
function revision(owner: string, conversation: string, action: Request['action']) {
  const snapshot = localConversationSnapshot(owner, conversation)
  return JSON.stringify(
    action === 'remove' ? [snapshot, readConversationMessages(owner, conversation)] : snapshot.entry,
  )
}
function requireAction(
  action: Request['action'],
  snapshot: ReturnType<typeof localConversationSnapshot>,
  conversation: string,
) {
  if (action === 'new' && conversation === '/') throw new Error('Already in a new conversation.')
  if (action === 'rename' && !snapshot.entry) throw new Error('No local index entry is available to rename.')
  if (action === 'remove' && !snapshot.entry && !snapshot.cached)
    throw new Error('No local copy is available to remove.')
}
function applyChange(action: Request['action'], owner: string, conversation: string, label: string) {
  if (action === 'rename') renameLocalConversation(owner, conversation, label)
  if (action === 'remove') removeLocalConversation(owner, conversation)
}
export function WorkConversationControls(props: Props) {
  if (props.enabled === false) return null
  const snapshot = localConversationSnapshot(props.owner, props.conversation)
  return (
    <OwnedConversationControls
      key={JSON.stringify([props.owner, props.conversation, snapshot.entry])}
      {...props}
      snapshot={snapshot}
    />
  )
}
function OwnedConversationControls({
  owner,
  conversation,
  onNew,
  snapshot,
  isAttendedGesture = (event) => event.nativeEvent.isTrusted,
}: Props & { snapshot: ReturnType<typeof localConversationSnapshot> }) {
  const live = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [review, setReview] = useState<(Request & { revision: string }) | null>(null)
  const current = useRef<typeof review>(null)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  useLayoutEffect(() => {
    live.current = true
    return () => {
      live.current = false
      current.current = null
    }
  }, [])
  const request = useCallback(
    (input: Request) => {
      if (!live.current) throw new Error('Conversation context is stale')
      if (current.current) throw new Error('A conversation review is already open')
      const parsed = requestSchema.parse(input)
      requireAction(parsed.action, snapshot, conversation)
      const next = { ...parsed, revision: revision(owner, conversation, parsed.action) }
      current.current = next
      setLabel(parsed.label ?? snapshot.entry?.firstMessage ?? '')
      setError(null)
      setReview(next)
      return { reviewRequired: true as const }
    },
    [owner, conversation, snapshot.entry, snapshot.cached],
  )
  const tools = useMemo(
    () => [
      makeTool({
        name: 'agent-webui.work.conversation.review',
        title: 'Review a local conversation change',
        description:
          'Open visible review for a fresh conversation, local rename or local removal. Does not change history, submit a message or delete remote data.',
        inputSchema: requestSchema,
        outputSchema: resultSchema,
        jsonSchema: z.toJSONSchema(requestSchema),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/WorkConversationControls.tsx',
        execute: request,
      }),
    ],
    [request],
  )
  useWebMcpToolSet(tools)
  function close() {
    current.current = null
    setReview(null)
  }
  function confirm(event: MouseEvent<HTMLButtonElement>) {
    if (!isAttendedGesture(event)) {
      setError('Use the visible confirmation button with a browser interaction.')
      return
    }
    if (!live.current || !review || current.current !== review) return
    try {
      if (review.revision !== revision(owner, conversation, review.action))
        throw new Error('The local copy changed. Cancel and review it again.')
      applyChange(review.action, owner, conversation, label)
      if (review.action !== 'rename') onNew()
      close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The local change failed.')
    }
  }
  return (
    <section aria-label="Conversation lifecycle" className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          ref={trigger}
          type="button"
          className={button}
          disabled={conversation === '/'}
          onClick={() => request({ action: 'new' })}
        >
          New conversation…
        </button>
        <button
          type="button"
          className={button}
          disabled={!snapshot.entry}
          onClick={() => request({ action: 'rename' })}
        >
          Rename local copy…
        </button>
        <button
          type="button"
          className={button}
          disabled={!snapshot.entry && !snapshot.cached}
          onClick={() => request({ action: 'remove' })}
        >
          Remove local copy…
        </button>
      </div>
      {snapshot.entry && (
        <p className="break-words text-sm">Local label: {snapshot.entry.firstMessage ?? conversation}</p>
      )}
      <p className="text-sm text-muted-foreground">Local history controls do not change server history.</p>
      <ConversationReview
        review={review}
        label={label}
        setLabel={setLabel}
        error={error}
        close={close}
        confirm={confirm}
        trigger={trigger}
      />
    </section>
  )
}
function ConversationReview({
  review,
  label,
  setLabel,
  error,
  close,
  confirm,
  trigger,
}: {
  review: Request | null
  label: string
  setLabel: (value: string) => void
  error: string | null
  close: () => void
  confirm: (event: MouseEvent<HTMLButtonElement>) => void
  trigger: React.RefObject<HTMLButtonElement | null>
}) {
  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus()
        }}
      >
        <DialogTitle>{review ? titles[review.action] : 'Conversation review'}</DialogTitle>
        <DialogDescription>{review ? descriptions[review.action] : ''}</DialogDescription>
        {review?.action === 'rename' && (
          <label className="flex flex-col gap-1">
            Local conversation label
            <input
              className="min-h-11 rounded border bg-background px-2"
              maxLength={120}
              value={label}
              onChange={(event) => {
                setLabel(event.target.value)
              }}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={button}
            onClick={confirm}
            disabled={review?.action === 'rename' && !LocalConversationLabel.safeParse(label).success}
          >
            Confirm conversation change
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
