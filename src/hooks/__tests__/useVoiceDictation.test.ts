import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useVoiceDictation } from '../useVoiceDictation'

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true)
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  mimeType = 'audio/webm'
  start = vi.fn()
  stop = vi.fn(() => {
    this.ondataavailable?.({ data: new Blob(['clip'], { type: 'audio/webm' }) })
    this.onstop?.()
  })
  stream: unknown
  options: unknown
  constructor(stream: unknown, options?: unknown) {
    this.stream = stream
    this.options = options
  }
}

function fakeStream() {
  const stop = vi.fn()
  return { getTracks: () => [{ stop }] } as unknown as MediaStream
}

function installCaptureSupport() {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  })
  // @ts-expect-error -- test double, not the real MediaRecorder
  global.MediaRecorder = FakeMediaRecorder
}

describe('useVoiceDictation', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(global.navigator, 'mediaDevices')
  const originalMediaRecorder = (global as { MediaRecorder?: unknown }).MediaRecorder

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalMediaDevices) {
      Object.defineProperty(global.navigator, 'mediaDevices', originalMediaDevices)
    } else {
      // @ts-expect-error -- restoring jsdom's undefined baseline
      delete global.navigator.mediaDevices
    }
    // @ts-expect-error -- restoring jsdom's undefined baseline
    global.MediaRecorder = originalMediaRecorder
  })

  it('reports unsupported when the browser has no capture APIs, and start() is a no-op', () => {
    // @ts-expect-error -- simulate a browser with no mediaDevices at all
    delete global.navigator.mediaDevices
    // @ts-expect-error -- simulate a browser with no MediaRecorder at all
    delete global.MediaRecorder

    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceDictation({ onTranscript }))

    expect(result.current.state).toBe('unsupported')
    act(() => {
      result.current.start()
    })
    expect(result.current.state).toBe('unsupported')
  })

  it('records and uploads, landing back on idle with the transcript on success', async () => {
    installCaptureSupport()
    const stream = fakeStream()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(stream)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ text: 'hello world' }),
      text: () => Promise.resolve('{"text":"hello world"}'),
    })

    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceDictation({ onTranscript }))

    expect(result.current.state).toBe('idle')
    act(() => {
      result.current.start()
    })
    expect(result.current.state).toBe('requesting-permission')

    await waitFor(() => {
      expect(result.current.state).toBe('recording')
    })

    act(() => {
      result.current.stop()
    })

    await waitFor(() => {
      expect(result.current.state).toBe('idle')
    })
    expect(onTranscript).toHaveBeenCalledWith('hello world')
  })

  it('reports permission-denied distinctly from a generic error', async () => {
    installCaptureSupport()
    const denied = new DOMException('denied', 'NotAllowedError')
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(denied)

    const { result } = renderHook(() => useVoiceDictation({ onTranscript: vi.fn() }))
    act(() => {
      result.current.start()
    })

    await waitFor(() => {
      expect(result.current.state).toBe('permission-denied')
    })
    expect(result.current.message).toMatch(/denied/i)
  })

  it('reports backend-unavailable distinctly on a 501, without fabricating a transcript', async () => {
    installCaptureSupport()
    const stream = fakeStream()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(stream)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 501,
      json: () => Promise.resolve({ detail: 'Capability is not available' }),
      text: () => Promise.resolve('{"detail":"Capability is not available"}'),
    })

    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceDictation({ onTranscript }))
    act(() => {
      result.current.start()
    })
    await waitFor(() => {
      expect(result.current.state).toBe('recording')
    })
    act(() => {
      result.current.stop()
    })

    await waitFor(() => {
      expect(result.current.state).toBe('backend-unavailable')
    })
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('reports a genuine error distinctly on a 500', async () => {
    installCaptureSupport()
    const stream = fakeStream()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(stream)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'Transcription failed' }),
      text: () => Promise.resolve('Transcription failed'),
    })

    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceDictation({ onTranscript }))
    act(() => {
      result.current.start()
    })
    await waitFor(() => {
      expect(result.current.state).toBe('recording')
    })
    act(() => {
      result.current.stop()
    })

    await waitFor(() => {
      expect(result.current.state).toBe('error')
    })
    expect(onTranscript).not.toHaveBeenCalled()
  })
})
