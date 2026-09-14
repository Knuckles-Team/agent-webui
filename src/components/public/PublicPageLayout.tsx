import type { ReactNode } from 'react'
import { trackAnalyticsEvent } from '@/lib/analytics'
import { MobileCta } from '@/components/MobileCta'
import { getRoutePageMetadata, routeById, type RouteDef } from '@/lib/nav-registry'
import { getSiteConfig } from '@/lib/site-config'
import { keepMobileFocusVisible, MOBILE_SURFACE, mobileSurfaceStyle } from '@/components/mobile-surface'

interface PublicPageLayoutProps {
  route: RouteDef
  eyebrow?: string
  title: string
  description?: string
  children: ReactNode
}

function publicRoute(id: string): RouteDef | null {
  return routeById(id)
}

/** One accessible shell for 404, legal, contact, and confirmation pages. */
export function PublicPageLayout({ route, eyebrow, title, description, children }: PublicPageLayoutProps) {
  const config = getSiteConfig()
  const privacy = publicRoute('public.privacy')
  const terms = publicRoute('public.terms')
  const contact = publicRoute('public.contact')
  const cta = getRoutePageMetadata(route).cta

  return (
    <div className="min-h-screen bg-background text-foreground" style={mobileSurfaceStyle}>
      <header className="border-b px-4 py-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
          <a href="/" className="font-semibold tracking-tight" aria-label={`${config.siteName} home`}>
            {config.siteName}
          </a>
          <nav aria-label="Public navigation" className="flex items-center gap-3 text-sm">
            {contact && (
              <a href={contact.path} className="text-muted-foreground underline-offset-4 hover:underline">
                Contact
              </a>
            )}
            {privacy && (
              <a
                href={privacy.path}
                className="hidden text-muted-foreground underline-offset-4 hover:underline sm:inline"
              >
                Privacy
              </a>
            )}
            {terms && (
              <a
                href={terms.path}
                className="hidden text-muted-foreground underline-offset-4 hover:underline sm:inline"
              >
                Terms
              </a>
            )}
          </nav>
        </div>
      </header>
      <main
        className="mx-auto w-full max-w-5xl px-4 py-10 pb-[var(--agent-webui-mobile-cta-occupied-height)] sm:px-8 sm:py-16"
        style={{ scrollPaddingBottom: MOBILE_SURFACE.ctaOccupiedHeight }}
        onFocusCapture={keepMobileFocusVisible}
      >
        <article className="mx-auto max-w-3xl">
          {eyebrow && <p className="mb-3 text-sm font-medium uppercase tracking-wide text-primary">{eyebrow}</p>}
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {description && <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>}
          {cta && (
            <a
              href={cta.target}
              className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground"
              onClick={() => {
                trackAnalyticsEvent({ name: cta.eventName, route: route.id, cta: cta.label })
              }}
            >
              {cta.label}
            </a>
          )}
          <div className="mt-8">{children}</div>
        </article>
      </main>
      <footer className="border-t px-4 py-6 text-sm text-muted-foreground sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>{config.legalOwner ?? 'Service owner not configured'}</span>
          <span>{config.contactAddress ?? 'Contact address not configured for this deployment.'}</span>
        </div>
      </footer>
      <MobileCta route={route} />
    </div>
  )
}
