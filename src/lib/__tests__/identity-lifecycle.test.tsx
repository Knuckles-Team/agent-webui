import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { invoke } from '@/lib/arbora-api/invoke'
import { signOut } from '@/lib/auth-api'
import { currentCsrfToken } from '@/lib/csrf'
import { useIdentity } from '@/lib/auth'
import { IDENTITY_STORAGE_KEY, invalidateIdentity } from '@/lib/identity-events'

const signedIn = (expires = Date.now() / 1000 + 300) => ({
  authenticated: true,
  subject: 'fixture-user',
  roles: [],
  webui_role: 'user',
  mode: 'external',
  expires_at: expires,
  csrf_token: 'fixture-csrf',
})
function Probe({ name = 'identity' }: { name?: string }) {
  const { identity, loading } = useIdentity()
  return (
    <output data-testid={name}>
      {loading ? 'loading' : `${identity.needsSignIn}:${identity.userKey}:${identity.role}`}
    </output>
  )
}
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('mounted identity lifecycle', () => {
  it('shares initial and focus reads and renders refused sessions in every consumer', async () => {
    const next = deferred()
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(signedIn())).mockReturnValueOnce(next.promise)
    vi.stubGlobal('fetch', fetcher)
    render(
      <>
        <Probe />
        <Probe name="second" />
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    act(() => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await act(async () => {
      next.resolve(Response.json({ authenticated: false }))
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    expect(screen.getByTestId('second')).toHaveTextContent('true:local:reader')
  })

  it('retires displayed authority immediately on 401 and ignores an older successful read', async () => {
    const stale = deferred()
    const current = deferred()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(signedIn()))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise)
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user'))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    act(() => {
      invalidateIdentity()
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    await act(async () => {
      stale.resolve(Response.json(signedIn()))
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    expect(fetcher).toHaveBeenCalledTimes(3)
    await act(async () => {
      current.resolve(Response.json({ authenticated: false }))
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
  })

  it('renews at the bounded expiry deadline without remounting or inventing a new mode', async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(signedIn(Date.now() / 1000 + 2)))
      .mockResolvedValueOnce(Response.json(signedIn(Date.now() / 1000 + 300)))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user')
  })

  it('revalidates cross-tab hints without trusting their contents and reconnects after failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(signedIn()))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json(signedIn()))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user'))
    await act(async () =>
      window.dispatchEvent(new StorageEvent('storage', { key: IDENTITY_STORAGE_KEY, newValue: 'untrusted-hint' })),
    )
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('bounds a hung session read, clears authority, and recovers on reconnect', async () => {
    vi.useFakeTimers()
    const stale = deferred()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(signedIn()))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(Response.json(signedIn()))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true)
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user')
    await act(async () => {
      stale.resolve(Response.json({ authenticated: false }))
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user')
  })

  it.each([
    { name: 'operation', run: () => invoke('fixture.read', {}, z.unknown()) },
    { name: 'broker mutation', run: signOut },
  ])('retires mounted authority when $name session preflight refuses', async ({ run }) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(signedIn()))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ authenticated: false }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user'))
    await act(async () => {
      await expect(run()).rejects.toThrow(/session.*unavailable/)
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    expect(fetcher.mock.calls.every(([path]) => path === '/auth/session')).toBe(true)
  })

  it.each([
    { name: 'signed out', reply: () => Response.json({ authenticated: false }) },
    { name: 'missing token', reply: () => Response.json({ authenticated: true }) },
    { name: 'empty token', reply: () => Response.json({ csrf_token: '' }) },
    { name: 'invalid token type', reply: () => Response.json({ csrf_token: 3 }) },
    { name: 'null body', reply: () => Response.json(null) },
    { name: 'invalid JSON', reply: () => new Response('not JSON') },
  ])('retires mounted identity and CSRF for a 200 broker preflight with $name', async ({ reply }) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(signedIn()))
      .mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(Response.json({ authenticated: false }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user'))
    expect(currentCsrfToken()).toBe('fixture-csrf')
    await act(async () => {
      await expect(signOut()).rejects.toThrow()
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    expect(currentCsrfToken()).toBeNull()
    expect(fetcher.mock.calls.every(([path]) => path === '/auth/session')).toBe(true)
  })

  it('reconciles another tab logout after an earlier read raced its completion', async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(signedIn()))
      .mockResolvedValueOnce(Response.json(signedIn()))
      .mockResolvedValueOnce(Response.json({ authenticated: false }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('keeps explicit none mode and does not schedule authenticated renewal for it', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...signedIn(), mode: 'none', subject: 'anonymous' }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('identity')).toHaveTextContent('false:anonymous:user')
  })

  it('still invalidates locally when browser storage is unavailable', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(signedIn()))
      .mockResolvedValueOnce(Response.json({ authenticated: false }))
    vi.stubGlobal('fetch', fetcher)
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('false:fixture-user:user'))
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    await act(async () => {
      invalidateIdentity()
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('true:local:reader')
    failure.mockRestore()
  })
})
