import type { CSSProperties, FocusEvent as ReactFocusEvent } from 'react'

/**
 * One contract for fixed mobile surfaces. Keep the viewport safe-area and
 * occupied-height values here so consent, CTA, and public-page content cannot
 * drift into separate bottom-offset calculations.
 */
export const MOBILE_SURFACE = {
  safeAreaBottom: 'var(--overstory-mobile-safe-area-bottom)',
  ctaButtonHeight: 'var(--overstory-mobile-cta-button-height)',
  ctaPadding: 'var(--overstory-mobile-cta-padding)',
  gap: 'var(--overstory-mobile-surface-gap)',
  ctaOccupiedHeight: 'var(--overstory-mobile-cta-occupied-height)',
  consentBottom: 'var(--overstory-mobile-consent-bottom)',
  consentMaxHeight: 'calc(100dvh - var(--overstory-mobile-consent-bottom) - var(--overstory-mobile-surface-gap))',
  breakpoint: 768,
  ctaZIndex: 40,
  consentZIndex: 50,
} as const

export type MobileSurfaceStyle = CSSProperties & Record<`--${string}`, string>

/** Shared CSS/env variables consumed by every fixed mobile surface. */
export const mobileSurfaceStyle: MobileSurfaceStyle = {
  '--overstory-mobile-safe-area-bottom': 'env(safe-area-inset-bottom, 0px)',
  '--overstory-mobile-cta-button-height': '2.75rem',
  '--overstory-mobile-cta-padding': '0.75rem',
  '--overstory-mobile-surface-gap': '0.5rem',
  '--overstory-mobile-cta-occupied-height':
    'calc(var(--overstory-mobile-cta-button-height) + (2 * var(--overstory-mobile-cta-padding)) + var(--overstory-mobile-safe-area-bottom))',
  '--overstory-mobile-consent-bottom':
    'calc(var(--overstory-mobile-cta-occupied-height) + var(--overstory-mobile-surface-gap))',
}

/** Keep a focused page control above the fixed CTA while the mobile keyboard opens. */
export function keepMobileFocusVisible(event: ReactFocusEvent<HTMLElement>): void {
  if (typeof window === 'undefined' || window.innerWidth >= MOBILE_SURFACE.breakpoint) return
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (!target.matches('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])')) return

  const keepVisible = () => {
    if (document.activeElement !== target) return
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
  }
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(keepVisible)
  } else {
    window.setTimeout(keepVisible, 0)
  }
}
