import { PublicPageLayout } from './PublicPageLayout'
import { LegalPageContent } from './LegalPageContent'
import { routeById } from '@/lib/nav-registry'
import { getSiteConfig } from '@/lib/site-config'

export default function TermsPage() {
  const route = routeById('public.terms')
  const config = getSiteConfig()
  if (!route) return null
  return (
    <PublicPageLayout route={route} eyebrow="Terms" title="Terms and conditions">
      <LegalPageContent config={config} text={config.termsText} />
    </PublicPageLayout>
  )
}
