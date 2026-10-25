import { toast } from 'sonner'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsentBanner, PrivacyConsentSettings } from '@/components/ConsentBanner'
import { WorkspaceAppearance } from '@/components/workspace/WorkspaceAppearance'
import {
  CONSENT_DISMISSED_KEY,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  readConsent,
  useConsent,
  writeConsent,
} from '@/lib/consent'

const { getSiteConfigMock } = vi.hoisted(() => ({ getSiteConfigMock: vi.fn() }))
vi.mock('@/lib/site-config', () => ({ getSiteConfig: getSiteConfigMock }))

function AnalyticsState() {
  const { record } = useConsent()
  return <output aria-label="Analytics consent">{record?.choice ?? 'unset'}</output>
}

// spec: WEBUI-APPS-R046.2.1
// Narrow consent lifecycle regression; full mobile/navigation acceptance remains open.
describe('ConsentBanner lifecycle', () => {
  beforeEach(() => {
    getSiteConfigMock.mockReturnValue({ analytics: null, contactAddress: null })
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    // Clear any intentionally tested page-lifetime storage fallback.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: window.localStorage }))
    })
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('removes every automatic control after an explicit decision and a reload-like remount', () => {
    const view = render(<ConsentBanner placement="workspace" />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline optional' }))
    expect(view.container).toBeEmptyDOMElement()
    expect(readConsent()?.choice).toBe('denied')
    view.unmount()
    render(<ConsentBanner placement="workspace" />)
    expect(screen.queryByRole('complementary', { name: 'Privacy consent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open privacy settings' })).not.toBeInTheDocument()
  })

  it('returns focus to the workspace home after dismissal', () => {
    render(
      <>
        <a id="workspace-home" href="/">
          Arbora
        </a>
        <ConsentBanner placement="workspace" />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByRole('link', { name: 'Arbora' })).toHaveFocus()
  })

  it('persists dismissal separately from consent across navigation and remount', () => {
    const view = render(<ConsentBanner placement="workspace" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(readConsent()).toBeNull()
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(CONSENT_DISMISSED_KEY)).toBe(CONSENT_VERSION)
    expect(view.container).toBeEmptyDOMElement()
    window.history.pushState({}, '', '/chat')
    view.rerender(<ConsentBanner placement="workspace" />)
    expect(view.container).toBeEmptyDOMElement()
    view.unmount()
    render(<ConsentBanner />)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('keeps explicit Privacy management available after dismissal and supports revoke', () => {
    getSiteConfigMock.mockReturnValue({ analytics: { provider: 'custom' }, contactAddress: null })
    render(
      <>
        <ConsentBanner placement="workspace" />
        <PrivacyConsentSettings />
        <AnalyticsState />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByLabelText('Analytics consent')).toHaveTextContent('unset')
    fireEvent.click(screen.getByRole('button', { name: 'Allow analytics' }))
    expect(screen.getByLabelText('Analytics consent')).toHaveTextContent('granted')
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(screen.getByRole('button', { name: 'Disable optional' })).toHaveFocus()
    expect(screen.getByLabelText('Analytics consent')).toHaveTextContent('denied')
    expect(screen.queryByRole('complementary', { name: 'Privacy consent' })).not.toBeInTheDocument()
  })

  it('keeps choices bounded in normal flow without automatically consenting', () => {
    render(<ConsentBanner placement="workspace" />)
    const prompt = screen.getByRole('complementary', { name: 'Privacy consent' })
    expect(prompt).toHaveClass('relative', 'shrink-0', 'overflow-y-auto', 'max-h-[35dvh]')
    expect(prompt).not.toHaveClass('fixed')
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Decline optional' })).toBeEnabled()
    expect(readConsent()).toBeNull()
  })

  it('retains public safe-area placement before a decision', () => {
    render(<ConsentBanner />)
    expect(screen.getByRole('complementary', { name: 'Privacy consent' })).toHaveStyle({
      '--agent-webui-mobile-safe-area-bottom': 'env(safe-area-inset-bottom, 0px)',
    })
    expect(screen.getByRole('complementary', { name: 'Privacy consent' })).toHaveClass('top-3')
  })

  it('shows configured contact information and truthful unavailable analytics', () => {
    getSiteConfigMock.mockReturnValue({ analytics: null, contactAddress: '42 Reviewed Way, Example City' })
    render(<ConsentBanner />)
    expect(screen.getByText('Privacy contact: 42 Reviewed Way, Example City')).toBeInTheDocument()
    expect(screen.getByText(/not configured for this deployment/)).toBeInTheDocument()
  })

  it('re-prompts for an outdated policy or malformed decision rather than inventing consent', () => {
    window.localStorage.setItem(CONSENT_DISMISSED_KEY, 'old-policy')
    window.localStorage.setItem(CONSENT_STORAGE_KEY, '{broken')
    render(<ConsentBanner />)
    expect(screen.getByRole('button', { name: 'Decline optional' })).toBeEnabled()
    expect(readConsent()).toBeNull()
  })

  it('retains storage-blocked choices for all mounted consumers and route remounts', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    const view = render(
      <>
        <ConsentBanner placement="workspace" />
        <AnalyticsState />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Decline optional' }))
    expect(screen.getByLabelText('Analytics consent')).toHaveTextContent('denied')
    view.unmount()
    render(
      <>
        <ConsentBanner placement="workspace" />
        <AnalyticsState />
      </>,
    )
    expect(screen.queryByRole('complementary', { name: 'Privacy consent' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Analytics consent')).toHaveTextContent('denied')
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull()
  })

  it('retains storage-blocked dismissal without granting consent', () => {
    const warning = vi.spyOn(toast, 'warning')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    const view = render(<ConsentBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('reload may ask again'))
    view.unmount()
    render(<ConsentBanner />)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(readConsent()).toBeNull()
  })

  it('does not resurrect a persisted grant when session storage changes after failed revocation', () => {
    writeConsent('granted')
    getSiteConfigMock.mockReturnValue({ analytics: { provider: 'custom' }, contactAddress: null })
    render(
      <>
        <PrivacyConsentSettings />
        <AnalyticsState />
      </>,
    )
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(readConsent()?.choice).toBe('denied')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: window.sessionStorage }))
    })
    expect(readConsent()?.choice).toBe('denied')
    expect(screen.getByLabelText('Analytics consent')).toHaveTextContent('denied')
  })

  it('reflects a cross-tab revocation in all subscribers', () => {
    writeConsent('granted')
    render(<AnalyticsState />)
    act(() => {
      window.localStorage.setItem(
        CONSENT_STORAGE_KEY,
        JSON.stringify({ version: CONSENT_VERSION, choice: 'denied', decidedAt: '2026-10-23T00:00:00Z' }),
      )
      window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_STORAGE_KEY, storageArea: window.localStorage }))
    })
    expect(screen.getByLabelText('Analytics consent')).toHaveTextContent('denied')
  })
})

// spec: WEBUI-APPS-R049.2.1, WEBUI-APPS-R046.2.1
it('keeps allow, disable and revoke in explicit Settings without changing the stored choice on open', () => {
  getSiteConfigMock.mockReturnValue({ analytics: { provider: 'fixture' }, contactAddress: null })
  window.localStorage.clear()
  render(<WorkspaceAppearance />)
  expect(screen.getByRole('button', { name: 'Allow analytics' })).not.toBeVisible()
  fireEvent.click(screen.getByText('Settings'))
  expect(readConsent()).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Allow analytics' }))
  expect(readConsent()?.choice).toBe('granted')
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  expect(readConsent()?.choice).toBe('denied')
  expect(screen.getByRole('button', { name: 'Disable optional' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Disable optional' }), { key: 'Escape' })
  expect(screen.getByText('Settings')).toHaveFocus()
  expect(screen.getByText('Settings').closest('details')).not.toHaveAttribute('open')
  expect(readConsent()?.choice).toBe('denied')
})
