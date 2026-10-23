import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { QueryValidationController } from '@/components/query-validation/useQueryValidationLens'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import { canonicalJson, utf8ByteLength, WEBMCP_ARGUMENT_BYTE_BUDGET } from '@/lib/webmcp/canonical'

type Lens = 'query' | 'validation'
const sourceType = z.enum(['text', 'file', 'url', 'auto'])
const editSchema = z.object({ text: z.string().max(32_768), sourceType: sourceType.optional() }).strict()
const emptySchema = z.object({}).strict()
const editedSchema = z.object({ edited: z.literal(true) }).strict()
const reviewSchema = z.object({ reviewRequired: z.literal(true) }).strict()

/** Tools change local editor/review state only. Only the human confirmation submits. */
export function QueryEditorTools({
  controller,
  lens,
  context,
  restoreFocus,
  isAttendedGesture = (event) => event.nativeEvent.isTrusted,
}: {
  controller: QueryValidationController
  lens: Lens
  context: string
  restoreFocus: () => void
  /** Test-only seam; production uses the browser trusted-event signal. */
  isAttendedGesture?: (event: MouseEvent<HTMLButtonElement>) => boolean
}) {
  const text = lens === 'query' ? controller.sparqlQuery : controller.shaclSource
  const type = lens === 'validation' ? controller.shaclSourceType : undefined
  const running = lens === 'query' ? controller.sparqlRunning : controller.shaclRunning
  const generation = useMemo(() => ({ context, lens, text, type, running }), [context, lens, text, type, running])
  const committedController = useRef(controller)
  useLayoutEffect(() => {
    committedController.current = controller
  })
  const live = useRef<typeof generation | null>(null)
  interface Review {
    generation: typeof generation
    token: symbol
  }
  const pending = useRef<Review | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  useLayoutEffect(() => {
    live.current = generation
    return () => {
      live.current = null
    }
  }, [generation])
  const tools = useMemo(() => {
    const assertCurrent = () => {
      if (live.current !== generation) throw new Error('Query editor context is stale')
      if (generation.running) throw new Error('A provider request is already pending')
    }
    return [
      makeTool({
        name: 'agent-webui.explore.edit-query',
        title: 'Edit the current query or validation draft',
        description:
          'Update the visible draft only. This never submits to a provider. Validation source types retain their existing meaning.',
        inputSchema: editSchema,
        outputSchema: editedSchema,
        jsonSchema: z.toJSONSchema(editSchema),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/QueryEditorTools.tsx',
        execute: ({ text: nextText, sourceType: nextType }) => {
          assertCurrent()
          const argumentsValue = nextType === undefined ? { text: nextText } : { text: nextText, sourceType: nextType }
          if (utf8ByteLength(canonicalJson(argumentsValue)) > WEBMCP_ARGUMENT_BYTE_BUDGET)
            throw new Error('Editor input exceeds the WebMCP byte budget')
          if (lens === 'query' && nextType !== undefined) throw new Error('Source type is only valid for validation')
          // An edit retires a pending review and all same-tick handles before React commits.
          if (nextText !== generation.text || (nextType !== undefined && nextType !== generation.type))
            live.current = null
          pending.current = null
          setReview(null)
          setError(null)
          if (lens === 'query') committedController.current.setSparqlQuery(nextText)
          else {
            committedController.current.setShaclSource(nextText)
            if (nextType !== undefined) committedController.current.setShaclSourceType(nextType)
          }
          return { edited: true as const }
        },
      }),
      makeTool({
        name: 'agent-webui.explore.request-query-submission',
        title: 'Request human review of the visible draft',
        description:
          'Open an attended review dialog for the current draft. Does not submit or authorize provider execution. A person must confirm in the visible UI.',
        inputSchema: emptySchema,
        outputSchema: reviewSchema,
        jsonSchema: z.toJSONSchema(emptySchema),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/QueryEditorTools.tsx',
        execute: () => {
          assertCurrent()
          if (!generation.text.trim()) throw new Error('The draft is empty')
          if (pending.current) throw new Error('A review is already pending')
          const request = { generation, token: Symbol('query-review') }
          pending.current = request
          setReview(request)
          setError(null)
          return { reviewRequired: true as const }
        },
      }),
    ]
  }, [generation, lens])
  useWebMcpToolSet(tools)
  const close = () => {
    if (!review || pending.current !== review) return
    pending.current = null
    setReview(null)
  }
  const confirm = async () => {
    if (!review || pending.current !== review) return
    if (live.current !== review.generation) {
      setError('The draft or workspace changed. Close this review and request a new one.')
      return
    }
    // Consume first, so duplicate clicks cannot submit the same review twice.
    pending.current = null
    setReview(null)
    if (review.generation.lens === 'query') await controller.runSparql()
    else await controller.runValidate()
  }
  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto motion-reduce:animate-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
      >
        <DialogTitle>Review provider submission</DialogTitle>
        <DialogDescription>
          This sends the displayed draft to the configured provider. Backend permissions still apply. Cancel does not
          submit.
        </DialogDescription>
        <p>
          {review?.generation.lens === 'query'
            ? 'SPARQL query'
            : `Validation source (${review?.generation.type ?? 'text'})`}
        </p>
        <pre className="max-h-[35dvh] overflow-auto whitespace-pre-wrap break-all rounded border p-3 text-sm">
          {review?.generation.text}
        </pre>
        {(error ?? (review !== null && review.generation !== generation)) && (
          <p role="alert">{error ?? 'The draft or workspace changed. Close this review and request a new one.'}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded border px-3" onClick={close}>
            Cancel submission
          </button>
          <button
            type="button"
            className="min-h-11 rounded border px-3"
            onClick={(event) => {
              if (!isAttendedGesture(event)) {
                setError('Use the visible confirmation button with a browser interaction.')
                return
              }
              void confirm()
            }}
          >
            Confirm provider submission
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
