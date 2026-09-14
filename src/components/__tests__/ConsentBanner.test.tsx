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
      '--agent-webui-mobile-consent-bottom':
        'calc(var(--agent-webui-mobile-cta-occupied-height) + var(--agent-webui-mobile-surface-gap))',
    })
    expect(consent).toHaveClass('bottom-[var(--agent-webui-mobile-consent-bottom)]')
  })
})
