import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHead } from '@/components/PageHead'
import { NOT_FOUND_ROUTE, routeById } from '@/lib/nav-registry'

describe('PageHead', () => {
  it('updates title, description, robots, canonical, and removes private share image data', async () => {
    const route = routeById('public.privacy')
    expect(route).toBeDefined()
    const { unmount } = render(<PageHead route={route!} pathname="/privacy" />)
    await waitFor(() => {
      expect(document.title).toContain('Privacy policy')
    })
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toContain('reviewed privacy')
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex,nofollow')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain('/privacy')
    unmount()

    render(<PageHead route={NOT_FOUND_ROUTE} pathname="/private" />)
    await waitFor(() => {
      expect(document.title).toContain('Page not found')
    })
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex,nofollow')
    expect(document.querySelector('meta[property="og:image"]')).toBeNull()
  })

  it('updates existing static tags and leaves one tag per head field during route changes', async () => {
    document.head.innerHTML = `
      <meta name="description" content="static description">
      <meta name="description" content="duplicate description">
      <meta name="robots" content="index,follow">
      <meta name="robots" content="index,follow duplicate">
      <meta property="og:title" content="static title">
      <meta property="og:title" content="duplicate title">
      <meta name="twitter:card" content="summary">
      <meta name="twitter:card" content="summary duplicate">
      <link rel="canonical" href="http://localhost/static">
      <link rel="canonical" href="http://localhost/duplicate">
      <link rel="icon" type="image/svg+xml" href="/favicon.svg">
      <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
      <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
      <link rel="shortcut icon" href="/favicon.ico">
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
      <link rel="manifest" href="/site.webmanifest">
    `
    const privacy = routeById('public.privacy')
    const terms = routeById('public.terms')
    expect(privacy).toBeDefined()
    expect(terms).toBeDefined()
    const { rerender } = render(<PageHead route={privacy!} pathname="/privacy" />)
    await waitFor(() => {
      expect(document.title).toContain('Privacy policy')
    })
    rerender(<PageHead route={terms!} pathname="/terms" />)
    await waitFor(() => {
      expect(document.title).toContain('Terms and conditions')
    })

    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1)
    expect(document.querySelectorAll('meta[property="og:title"]')).toHaveLength(1)
    expect(document.querySelectorAll('meta[name="twitter:card"]')).toHaveLength(1)
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain('/terms')
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(4)
    expect(document.querySelectorAll('link[rel="shortcut icon"]')).toHaveLength(1)
    expect(document.querySelectorAll('link[rel="apple-touch-icon"]')).toHaveLength(1)
    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1)
  })
})
