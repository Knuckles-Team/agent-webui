/**
 * @file live.ts
 * @description The ONE live-update interface, so adapters do not each invent polling.
 *
 * There is no single "subscribe to everything" channel in epistemic-graph. GraphQL
 * subscriptions (`GET /graphql/subscribe`, SSE) are the only true push; everything
 * else — `Method::CdcRead`, `Watch`, `CepPoll` — is cursor/long-poll. Rather than let
 * twelve adapters each grow their own `setInterval`, an adapter supplies a
 * {@link LiveSource} and {@link createLiveController} owns the timer, the visibility
 * pause and the cancellation.
 */
import type { AdapterRequest } from './adapter'
import type { AtlasContext, ResultSet } from './types'

export type LiveMode = 'push' | 'poll' | 'none'

/**
 * Where the next poll resumes from.
 *
 * ⚠ `gap` is not decoration. `Method::CdcRead` reads a BOUNDED RING, not an unbounded
 * log; when the reader falls behind, events were lost and the response says so. The
 * controller surfaces `gap` to the UI as "may have missed changes — reload". Treating
 * a gapped read as "caught up" silently loses data.
 */
export interface LiveCursor {
  token: string | null
  gap: boolean
}

export const INITIAL_LIVE_CURSOR: LiveCursor = { token: null, gap: false }

export interface LiveUpdate<P = unknown> {
  /** A fresh result, or `null` when nothing changed since `cursor`. */
  result: ResultSet<P> | null
  cursor: LiveCursor
  changed: boolean
}

/** One typed request, for the same reason every adapter method takes one — see `adapter.ts`. */
export interface LivePollRequest extends AdapterRequest {
  query: unknown
  cursor: LiveCursor
}

export interface LiveSource<P = unknown> {
  readonly mode: LiveMode
  /** Poll cadence in milliseconds. Displayed to the user, so make it truthful. */
  readonly intervalMs: number
  poll(request: LivePollRequest): Promise<LiveUpdate<P>>
}

export interface LiveControllerOptions<P = unknown> {
  source: LiveSource<P>
  query: unknown
  ctx: AtlasContext
  onUpdate: (update: LiveUpdate<P>) => void
  onError: (error: unknown) => void
  /** Injected for tests; defaults to `document.visibilityState !== 'hidden'`. */
  isVisible?: () => boolean
}

export interface LiveController {
  start: () => void
  stop: () => void
  /** Poll once, right now, regardless of the timer. */
  tick: () => Promise<void>
}

function documentIsVisible(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

/**
 * Drive a {@link LiveSource} on its own cadence.
 *
 * Skips a tick while the document is hidden (a background tab must not keep hammering
 * a cursor endpoint), cancels the in-flight request on `stop`, and never overlaps two
 * polls — a slow backend degrades to a lower refresh rate rather than a request pile-up.
 */
export function createLiveController<P>(options: LiveControllerOptions<P>): LiveController {
  const visible = options.isVisible ?? documentIsVisible
  let cursor: LiveCursor = INITIAL_LIVE_CURSOR
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: AbortController | null = null

  async function tick(): Promise<void> {
    if (inFlight || !visible()) return
    const controller = new AbortController()
    inFlight = controller
    try {
      const update = await options.source.poll({
        query: options.query,
        cursor,
        ctx: options.ctx,
        signal: controller.signal,
      })
      cursor = update.cursor
      options.onUpdate(update)
    } catch (error) {
      if (!controller.signal.aborted) options.onError(error)
    } finally {
      inFlight = null
    }
  }

  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
    inFlight?.abort()
    inFlight = null
  }

  function start(): void {
    if (timer !== null || options.source.mode === 'none') return
    timer = setInterval(() => {
      tick().catch(options.onError)
    }, options.source.intervalMs)
  }

  return { start, stop, tick }
}
