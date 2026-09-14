import { PublicPageLayout } from './PublicPageLayout'
import { routeById } from '@/lib/nav-registry'
import { getSiteConfig } from '@/lib/site-config'

export default function ContactPage() {
  const route = routeById('public.contact')
  const config = getSiteConfig()
  if (!route) return null
  const configured = Boolean(config.contactAddress ?? config.contactEmail)
  return (
    <PublicPageLayout
      route={route}
      eyebrow="Contact"
      title="Contact the service owner"
      description="Contact details are shown only when supplied by the deployment owner."
    >
      <div className="rounded-lg border bg-card p-5">
        {configured ? (
          <div className="space-y-3 text-sm">
            {config.contactAddress && <p className="whitespace-pre-line">{config.contactAddress}</p>}
            {config.contactEmail && (
              <p>
                <a className="text-primary underline" href={`mailto:${config.contactEmail}`}>
                  {config.contactEmail}
                </a>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Contact address is not configured for this deployment.</p>
        )}
      </div>
    </PublicPageLayout>
  )
}
