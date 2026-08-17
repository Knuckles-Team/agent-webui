/**
 * @file VoiceDictationButton.tsx
 * @description Microphone dictation control for the chat prompt toolbar.
 *
 * Records one clip via `getUserMedia`/`MediaRecorder`, uploads it whole to
 * agent-webui's `POST /api/enhanced/voice/transcribe` on stop, and calls
 * `onTranscript` with the resulting text — see `useVoiceDictation` for the
 * full state machine and why this is single-shot rather than streaming (no
 * streaming ASR backend exists to stream against today).
 *
 * Every non-happy-path state gets its OWN icon, its own color, and its own
 * tooltip copy — never a shared "something's wrong" mic-with-a-slash for
 * every failure mode. Rendering "no permission", "unsupported", "backend
 * unavailable" and "a genuine error" identically is exactly the kind of
 * silent-failure bug this program has already spent weeks misdiagnosing.
 */
import { AlertTriangle, Ban, CloudOff, Loader2, Mic, MicOff } from 'lucide-react'
import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useVoiceDictation, type VoiceDictationState } from '@/hooks/useVoiceDictation'

export interface VoiceDictationButtonProps {
  /** Called with the transcribed text once an upload completes successfully. */
  onTranscript: (text: string) => void
  className?: string
}

const STATE_COPY: Record<VoiceDictationState, string> = {
  unsupported: "Voice input isn't supported in this browser.",
  idle: 'Dictate your message',
  'requesting-permission': 'Requesting microphone access…',
  recording: 'Recording — click to stop and transcribe',
  transcribing: 'Transcribing…',
  'permission-denied': 'Microphone access was denied. Click to try again.',
  'backend-unavailable': 'Voice transcription is not enabled on this server yet.',
  error: 'Could not transcribe that clip. Click to try again.',
}

export default function VoiceDictationButton({ onTranscript, className }: VoiceDictationButtonProps) {
  const { state, message, start, stop } = useVoiceDictation({ onTranscript })

  const onClick = () => {
    if (state === 'recording') {
      stop()
      return
    }
    if (state === 'idle' || state === 'permission-denied' || state === 'error') {
      start()
    }
  }

  const disabled = state === 'unsupported' || state === 'requesting-permission' || state === 'transcribing'
  const tooltip = message || STATE_COPY[state]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton
          variant="outline"
          aria-label={STATE_COPY[state]}
          aria-live="polite"
          data-voice-state={state}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            state === 'recording' && 'text-red-500',
            state === 'permission-denied' && 'text-amber-500',
            state === 'backend-unavailable' && 'text-muted-foreground/60',
            state === 'error' && 'text-destructive',
            state === 'unsupported' && 'text-muted-foreground/40',
            className,
          )}
        >
          <VoiceStateIcon state={state} />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function VoiceStateIcon({ state }: { state: VoiceDictationState }) {
  switch (state) {
    case 'unsupported':
      return <Ban className="size-4" />
    case 'requesting-permission':
    case 'transcribing':
      return <Loader2 className="size-4 animate-spin" />
    case 'recording':
      return <Mic className="size-4 animate-pulse" />
    case 'permission-denied':
      return <MicOff className="size-4" />
    case 'backend-unavailable':
      return <CloudOff className="size-4" />
    case 'error':
      return <AlertTriangle className="size-4" />
    case 'idle':
    default:
      return <Mic className="size-4" />
  }
}
