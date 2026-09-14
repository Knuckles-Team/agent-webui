import { PublicPageLayout } from './PublicPageLayout'
import { LegalPageContent } from './LegalPageContent'
import { routeById } from '@/lib/nav-registry'
import { getSiteConfig } from '@/lib/site-config'

export default function PrivacyPage() {
  const route = routeById('public.privacy')
  const config = getSiteConfig()
  if (!route) return null
  return (
    <PublicPageLayout
      route={route}
      eyebrow="Privacy"
      title="Privacy policy"
      description="The reviewed privacy policy for this deployment."
    >
      <LegalPageContent config={config} text={config.privacyPolicyText} />
    </PublicPageLayout>
  )
}
