import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VoiceDictationButton from '../VoiceDictationButton'
import type { VoiceDictationState } from '@/hooks/useVoiceDictation'

const hookState = vi.hoisted(() => ({
  state: 'idle' as VoiceDictationState,
  message: '',
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@/hooks/useVoiceDictation', () => ({
  useVoiceDictation: () => hookState,
}))

describe('VoiceDictationButton', () => {
  beforeEach(() => {
    hookState.state = 'idle'
    hookState.message = ''
    hookState.start = vi.fn()
    hookState.stop = vi.fn()
  })

  it('is disabled and non-interactive when capture is unsupported', () => {
    hookState.state = 'unsupported'
    render(<VoiceDictationButton onTranscript={vi.fn()} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('starts recording on click while idle', async () => {
    render(<VoiceDictationButton onTranscript={vi.fn()} />)
    await userEvent.click(screen.getByRole('button'))
    expect(hookState.start).toHaveBeenCalledTimes(1)
    expect(hookState.stop).not.toHaveBeenCalled()
  })

  it('stops recording on click while recording, never restarts', async () => {
    hookState.state = 'recording'
    render(<VoiceDictationButton onTranscript={vi.fn()} />)
    await userEvent.click(screen.getByRole('button'))
    expect(hookState.stop).toHaveBeenCalledTimes(1)
    expect(hookState.start).not.toHaveBeenCalled()
  })

  it.each([
    ['unsupported', "Voice input isn't supported in this browser."],
    ['permission-denied', 'Microphone access was denied. Click to try again.'],
    ['backend-unavailable', 'Voice transcription is not enabled on this server yet.'],
    ['error', 'Could not transcribe that clip. Click to try again.'],
  ] as const)('renders a distinct label for %s', (state, expected) => {
    hookState.state = state
    render(<VoiceDictationButton onTranscript={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', expected)
  })

  it('every non-happy-path state renders a visibly distinct label from every other', () => {
    const states: VoiceDictationState[] = ['unsupported', 'permission-denied', 'backend-unavailable', 'error']
    const labels = states.map((state) => {
      hookState.state = state
      const { unmount } = render(<VoiceDictationButton onTranscript={vi.fn()} />)
      const label = screen.getByRole('button').getAttribute('aria-label')
      unmount()
      return label
    })
    expect(new Set(labels).size).toBe(states.length)
  })

  it('stays enabled (retryable) in every recoverable failure state', () => {
    for (const state of ['permission-denied', 'error'] as const) {
      hookState.state = state
      const { unmount } = render(<VoiceDictationButton onTranscript={vi.fn()} />)
      expect(screen.getByRole('button')).toBeEnabled()
      unmount()
    }
  })
})
