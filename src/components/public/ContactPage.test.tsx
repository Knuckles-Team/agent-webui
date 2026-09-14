import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import ContactPage from './ContactPage'
import ThankYouPage from './ThankYouPage'
import { CONTACT_RECEIPT_KEY } from '@/lib/contact'

vi.mock('@/lib/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...original,
    useIdentity: () => ({
      identity: { userKey: 'test', role: 'admin', ssoConfigured: true, needsSignIn: false, raw: null },
      loading: false,
    }),
  }
})

const RECEIPT = 'contact_abcdefghijklmnop'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

async function fillForm(): Promise<void> {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Test Operator')
  await user.type(screen.getByRole('textbox', { name: 'Email' }), 'operator@example.test')
  await user.type(screen.getByRole('textbox', { name: 'Subject' }), 'A bounded question')
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Please confirm this synthetic submission.')
}

afterEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('contact submission flow', () => {
  it('stores a bounded receipt and navigates only after confirmed delivery', async () => {
    let resolveRequest: ((value: Response) => void) | undefined
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve
        }),
    )
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/contact')
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findByRole('heading', { name: 'Contact the service owner' })
    await fillForm()

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/waiting for delivery confirmation/i)
    expect(window.location.pathname).toBe('/contact')
    if (resolveRequest) resolveRequest(response({ receipt: RECEIPT }))
    await waitFor(() => {
      expect(window.location.pathname).toBe('/thank-you')
    })
    expect(await screen.findByRole('heading', { name: 'Thank you' })).toBeVisible()
    expect(window.sessionStorage.getItem(CONTACT_RECEIPT_KEY)).toBe(RECEIPT)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/contact',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toEqual(
      expect.objectContaining({ idempotency_key: expect.stringMatching(/^contactreq_[a-f0-9]{32}$/) }),
    )
  })

  it('coalesces duplicate clicks and reuses the durable fence key on retry', async () => {
    let attempt = 0
    let resolveRequest: ((value: Response) => void) | undefined
    global.fetch = vi.fn(() => {
      attempt += 1
      if (attempt === 1) return Promise.resolve(response({}, 503))
      return new Promise<Response>((resolve) => {
        resolveRequest = resolve
      })
    })
    const user = userEvent.setup()
    render(<ContactPage />)
    await fillForm()

    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await user.click(screen.getByRole('button', { name: 'Sending…' }))

    expect(global.fetch).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body))
    const secondBody = JSON.parse(String(vi.mocked(global.fetch).mock.calls[1]?.[1]?.body))
    expect(firstBody.idempotency_key).toBe(secondBody.idempotency_key)
    if (resolveRequest) resolveRequest(response({ receipt: RECEIPT }))
    await waitFor(() => {
      expect(window.location.pathname).toBe('/thank-you')
    })
  })

  it('aborts the request and does not navigate after unmount', async () => {
    let observedSignal: AbortSignal | undefined
    global.fetch = vi.fn((_input, init) => {
      observedSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })
    const user = userEvent.setup()
    const view = render(<ContactPage />)
    await fillForm()

    await user.click(screen.getByRole('button', { name: 'Send message' }))
    view.unmount()

    expect(observedSignal?.aborted).toBe(true)
    expect(window.location.pathname).toBe('/')
    expect(window.sessionStorage.getItem(CONTACT_RECEIPT_KEY)).toBeNull()
  })

  it('preserves every field and shows a sanitized alert when delivery is refused', async () => {
    global.fetch = vi.fn().mockResolvedValue(response({ detail: 'provider secret' }, 503))
    const user = userEvent.setup()
    render(<ContactPage />)
    await fillForm()

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your message could not be confirmed.')
    expect(alert).not.toHaveTextContent('provider secret')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Test Operator')
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('operator@example.test')
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('A bounded question')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Please confirm this synthetic submission.')
    expect(window.location.pathname).toBe('/')
    expect(window.sessionStorage.getItem(CONTACT_RECEIPT_KEY)).toBeNull()
  })

  it('marks invalid fields and connects each message to its control', async () => {
    const user = userEvent.setup()
    render(<ContactPage />)

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Review the highlighted fields')
    for (const name of ['Name', 'Email', 'Subject', 'Message']) {
      const input = screen.getByRole('textbox', { name })
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAttribute('aria-describedby')
      expect(document.getElementById(input.getAttribute('aria-describedby')!)).toBeVisible()
    }
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does not present a stale short value as a confirmed receipt', () => {
    window.sessionStorage.setItem(CONTACT_RECEIPT_KEY, 'x')

    render(<ThankYouPage />)

    expect(screen.getByText('No confirmed receipt in this browser')).toBeInTheDocument()
    expect(screen.queryByText('Confirmed receipt')).not.toBeInTheDocument()
  })
})
