/**
 * @file useVoiceDictation.ts
 * @description Microphone-capture -> transcript state machine for the voice
 * dictation control (`VoiceDictationButton`).
 *
 * Talks to agent-webui's OWN backend route, `POST /api/enhanced/voice/transcribe`
 * (`agent/agent_webui/api_extensions.py`) — a single-shot upload (record, stop,
 * upload the whole clip), not a live streaming transcript: there is no
 * streaming ASR backend behind this route today, so this hook never claims one.
 *
 * Four DISTINCT, honest states are the point of this hook — a silent failure,
 * or two different failure modes rendering identically, is itself a defect:
 *   - `unsupported`         — this browser has no `getUserMedia`/`MediaRecorder`.
 *   - `permission-denied`   — the user (or the OS) refused microphone access.
 *   - `backend-unavailable` — the route answered 404/501 (no `transcribe_voice`
 *                             workspace helper registered server-side — see
 *                             `agent_utilities.server.webui_voice_delegation`).
 *   - `error`               — anything else: no microphone hardware, a network
 *                             failure, a non-2xx response, a malformed reply.
 * `idle`/`requesting-permission`/`recording`/`transcribing` are the happy-path
 * states in between.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { apiPostForm } from '@/lib/gateway'
import { z } from 'zod'

export type VoiceDictationState =
  | 'unsupported'
  | 'idle'
  | 'requesting-permission'
  | 'recording'
  | 'transcribing'
  | 'permission-denied'
  | 'backend-unavailable'
  | 'error'

export interface UseVoiceDictationOptions {
  /** Called once per successful upload with the (possibly empty) transcript. */
  onTranscript: (text: string) => void
}

export interface UseVoiceDictationResult {
  state: VoiceDictationState
  /** Human-readable detail for the current state; empty on the happy path. */
  message: string
  /** Start requesting mic permission and, once granted, recording. No-op when unsupported or already active. */
  start: () => void
  /** Stop recording and upload the captured clip. No-op unless currently recording. */
  stop: () => void
}

const TranscribeResponseSchema = z.object({ text: z.string() })

/** Candidate `MediaRecorder` mime types, most-preferred first. The backend
 * route accepts any `audio/*` (or `video/webm`) content type, so the first
 * one this browser actually supports is used verbatim. */
const CANDIDATE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

function isCaptureSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof MediaRecorder === 'undefined') return false
  // lib.dom types `navigator.mediaDevices` as always-present, but MDN documents it as
  // genuinely absent in insecure (non-HTTPS) contexts and very old browsers — cast to
  // the honestly-nullable type so this real runtime check isn't flagged as redundant.
  const mediaDevices = navigator.mediaDevices as MediaDevices | undefined
  return typeof mediaDevices?.getUserMedia === 'function'
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

function isPermissionDenied(err: unknown): boolean {
  const name = err instanceof DOMException ? err.name : ''
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError'
}

export function useVoiceDictation({ onTranscript }: UseVoiceDictationOptions): UseVoiceDictationResult {
  const supported = useMemo(isCaptureSupported, [])
  const [state, setState] = useState<VoiceDictationState>(supported ? 'idle' : 'unsupported')
  const [message, setMessage] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop()
    })
    streamRef.current = null
    recorderRef.current = null
  }, [])

  const upload = useCallback(
    async (blob: Blob) => {
      setState('transcribing')
      const form = new FormData()
      form.append('file', blob, 'dictation.webm')
      const result = await apiPostForm('/enhanced/voice/transcribe', form, TranscribeResponseSchema)

      if (result.unavailable) {
        setState('backend-unavailable')
        setMessage('Voice transcription is not enabled on this server yet.')
        return
      }
      if (!result.ok || !result.data) {
        setState('error')
        setMessage(result.error ?? 'Transcription failed.')
        return
      }
      setState('idle')
      setMessage('')
      onTranscript(result.data.text)
    },
    [onTranscript],
  )

  const start = useCallback(() => {
    if (!supported || state === 'requesting-permission' || state === 'recording' || state === 'transcribing') return
    setState('requesting-permission')
    setMessage('')

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream
        chunksRef.current = []
        const mimeType = pickMimeType()
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        recorderRef.current = recorder

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        }
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          chunksRef.current = []
          releaseStream()
          void upload(blob)
        }
        recorder.onerror = () => {
          releaseStream()
          setState('error')
          setMessage('Recording failed unexpectedly.')
        }

        recorder.start()
        setState('recording')
      })
      .catch((err: unknown) => {
        if (isPermissionDenied(err)) {
          setState('permission-denied')
          setMessage('Microphone access was denied. Allow microphone access in your browser settings to dictate.')
          return
        }
        setState('error')
        setMessage(err instanceof Error ? err.message : 'Could not access the microphone.')
      })
  }, [state, supported, releaseStream, upload])

  const stop = useCallback(() => {
    if (state !== 'recording') return
    recorderRef.current?.stop()
  }, [state])

  return { state, message, start, stop }
}
