import { PublicPageLayout } from './PublicPageLayout'
import { routeById } from '@/lib/nav-registry'

export default function NotFoundPage() {
  const route = routeById('public.not-found')
  if (!route) return null
  return (
    <PublicPageLayout
      route={route}
      eyebrow="404"
      title="That page was not found"
      description="The address does not match a registered Agent WebUI route. Use the safe home link to continue."
    >
      <a
        href="/"
        className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground"
      >
        Open Agent WebUI
      </a>
    </PublicPageLayout>
  )
}
