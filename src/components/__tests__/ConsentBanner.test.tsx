import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteConfig } from '@/lib/site-config'

import { ConsentBanner } from '@/components/ConsentBanner'
import { CONSENT_STORAGE_KEY, writeConsent } from '@/lib/consent'

const { getSiteConfigMock } = vi.hoisted(() => ({
  getSiteConfigMock: vi.fn(),
}))

vi.mock('@/lib/site-config', () => ({ getSiteConfig: getSiteConfigMock }))

describe('ConsentBanner', () => {
  beforeEach(() => {
    getSiteConfigMock.mockReturnValue({ analytics: null, contactAddress: null } as Pick<
      SiteConfig,
      'analytics' | 'contactAddress'
    >)
  })

  afterEach(() => {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY)
  })

  it('provides a close path after an existing decision opens settings', () => {
    writeConsent('denied', '2026-09-14T00:00:00.000Z')
    render(<ConsentBanner />)

    fireEvent.click(screen.getByRole('button', { name: 'Open privacy settings' }))
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Open privacy settings' })).toBeInTheDocument()
  })

  it('shows the configured contact address and a truthful unavailable state', () => {
    getSiteConfigMock.mockReturnValue({ analytics: null, contactAddress: '42 Reviewed Way, Example City' })
    render(<ConsentBanner />)
    expect(screen.getByText('Privacy contact: 42 Reviewed Way, Example City')).toBeInTheDocument()

    getSiteConfigMock.mockReturnValue({ analytics: null, contactAddress: null })
    window.localStorage.removeItem(CONSENT_STORAGE_KEY)
    render(<ConsentBanner />)
    expect(screen.getByText('Contact address not configured for this deployment.')).toBeInTheDocument()
  })

  it('uses the shared safe-area stack contract for the consent surface', () => {
    render(<ConsentBanner />)
    const consent = document.querySelector('[data-mobile-surface="consent"]')
    expect(consent).toHaveStyle({
      '--agent-webui-mobile-safe-area-bottom': 'env(safe-area-inset-bottom, 0px)',
    })
    // Top-anchored, not bottom-anchored: the chat input is a sticky-bottom
    // element on this same screen, so this surface must never share that
    // region or it will overlay/block the chat input.
    expect(consent).toHaveClass('top-3')
    expect(consent).not.toHaveClass('bottom-[var(--agent-webui-mobile-consent-bottom)]')
  })

  it('accepting consent dismisses the prompt permanently, including after reload', () => {
    const { unmount } = render(<ConsentBanner />)

    expect(screen.getByText('Privacy choices')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    // Dismissed: the full prompt is gone, replaced by the small settings pill.
    expect(screen.queryByText('Privacy choices')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open privacy settings' })).toBeInTheDocument()

    // Recorded under the existing consent storage key.
    const stored = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? 'null')
    expect(stored?.choice).toBe('granted')

    // Stays dismissed after a reload (new mount reading from storage).
    unmount()
    render(<ConsentBanner />)
    expect(screen.queryByText('Privacy choices')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open privacy settings' })).toBeInTheDocument()
  })
})
