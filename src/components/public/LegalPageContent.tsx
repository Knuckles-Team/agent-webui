import type { SiteConfig } from '@/lib/site-config'

export function LegalPageContent({ config, text }: { config: SiteConfig; text: string | null }) {
  if (!config.legalOwner || !config.contactAddress || !config.legalEffectiveDate || !config.legalRevision || !text) {
    return (
      <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-5 text-sm">
        <p>
          Reviewed legal content and a real contact identity are not configured for this deployment. This page makes no
          legal claim until the owner supplies the reviewed document and release validation passes.
        </p>
        <address className="mt-3 not-italic">
          {config.contactAddress
            ? `Contact address supplied for this deployment: ${config.contactAddress}`
            : 'Contact address not configured for this deployment.'}
        </address>
      </div>
    )
  }
  return (
    <div className="space-y-6 text-sm leading-7">
      <dl className="grid gap-2 rounded-lg border bg-card p-5 sm:grid-cols-2">
        <div>
          <dt className="font-medium">Owner</dt>
          <dd className="text-muted-foreground">{config.legalOwner}</dd>
        </div>
        <div>
          <dt className="font-medium">Effective</dt>
          <dd className="text-muted-foreground">{config.legalEffectiveDate}</dd>
        </div>
        <div>
          <dt className="font-medium">Revision</dt>
          <dd className="text-muted-foreground">{config.legalRevision}</dd>
        </div>
        <div>
          <dt className="font-medium">Contact</dt>
          <dd className="whitespace-pre-line text-muted-foreground">{config.contactAddress}</dd>
        </div>
      </dl>
      <div className="space-y-4">
        {text.split(/\n{2,}/).map((paragraph, index) => (
          <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
        ))}
      </div>
    </div>
  )
}
