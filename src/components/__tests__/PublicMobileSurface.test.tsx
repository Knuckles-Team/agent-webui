import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileCta } from '@/components/MobileCta'
import { LegalPageContent } from '@/components/public/LegalPageContent'
import { PublicPageLayout } from '@/components/public/PublicPageLayout'
import { routeById } from '@/lib/nav-registry'
import type { SiteConfig } from '@/lib/site-config'

const CONFIG: SiteConfig = {
  siteName: 'Agent WebUI',
  canonicalOrigin: 'https://agents.example.invalid',
  indexableEnvironment: false,
  openGraphImagePath: '/og-image-v1.png',
  legalOwner: 'Reviewed Owner',
  contactAddress: '42 Reviewed Way\nExample City',
  contactEmail: 'owner@example.invalid',
  legalEffectiveDate: '2026-09-14',
  legalRevision: 'privacy-terms-1',
  privacyPolicyText: 'Reviewed privacy policy.',
  termsText: 'Reviewed terms.',
  analytics: null,
}

describe('public mobile surface contract', () => {
  it('reserves CTA space and scroll padding for focused controls', () => {
    const route = routeById('public.privacy')
    expect(route).toBeDefined()
    render(
      <PublicPageLayout route={route!} title="Privacy">
        <label>
          Contact
          <input aria-label="Contact" />
        </label>
      </PublicPageLayout>,
    )

    const main = screen.getByRole('main')
    expect(main).toHaveClass('pb-[var(--agent-webui-mobile-cta-occupied-height)]')
    expect(main).toHaveStyle({ scrollPaddingBottom: 'var(--agent-webui-mobile-cta-occupied-height)' })
    expect(document.querySelector('[data-mobile-surface="cta"]')).toHaveStyle({
      '--agent-webui-mobile-safe-area-bottom': 'env(safe-area-inset-bottom, 0px)',
    })
    expect(document.querySelector('[data-mobile-surface="cta"] a')).toHaveStyle({
      minHeight: 'var(--agent-webui-mobile-cta-button-height)',
    })
  })

  it('scrolls a focused mobile control clear of the sticky CTA', async () => {
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    render(
      <PublicPageLayout route={routeById('public.contact')!} title="Contact">
        <input aria-label="Contact form" />
      </PublicPageLayout>,
    )
    const input = screen.getByRole('textbox', { name: 'Contact form' })
    const scrollIntoView = vi.fn()
    Object.defineProperty(input, 'scrollIntoView', { configurable: true, value: scrollIntoView })

    try {
      input.focus()
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'auto' })
      })
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    }
  })

  it('keeps a configured contact address visible when legal copy is unavailable', () => {
    render(<LegalPageContent config={{ ...CONFIG, privacyPolicyText: null }} text={null} />)
    expect(screen.getByText(/Contact address supplied for this deployment: 42 Reviewed Way/)).toBeInTheDocument()
  })

  it('does not invent a contact address when configuration is missing', () => {
    render(<LegalPageContent config={{ ...CONFIG, contactAddress: null }} text={null} />)
    expect(screen.getByText('Contact address not configured for this deployment.')).toBeInTheDocument()
  })

  it('renders the shared CTA only for registered metadata with an action', () => {
    const route = routeById('public.contact')
    expect(route).toBeDefined()
    render(<MobileCta route={route!} />)
    expect(screen.getByRole('link', { name: 'Open Agent WebUI' })).toHaveAttribute('href', '/')
  })
})
