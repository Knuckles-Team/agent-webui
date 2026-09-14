import { useEffect, useState } from 'react'
import { PublicPageLayout } from './PublicPageLayout'
import { routeById } from '@/lib/nav-registry'

const RECEIPT_KEY = 'agent-webui.confirmed-receipt'

function readBoundedReceipt(): string | null {
  try {
    const receipt = window.sessionStorage.getItem(RECEIPT_KEY)?.trim() ?? ''
    return /^[A-Za-z0-9_-]{1,64}$/.test(receipt) ? receipt : null
  } catch {
    return null
  }
}

export default function ThankYouPage() {
  const route = routeById('public.thank-you')
  const [receipt, setReceipt] = useState<string | null>(null)
  useEffect(() => {
    setReceipt(readBoundedReceipt())
  }, [])
  if (!route) return null
  return (
    <PublicPageLayout
      route={route}
      eyebrow="Submission received"
      title="Thank you"
      description={
        receipt
          ? 'The service confirmed your submission. Keep the bounded reference below if you need to discuss it with the service owner.'
          : 'This is the confirmation page. A delivery claim is shown only when this browser has a confirmed receipt.'
      }
    >
      <div className="rounded-lg border bg-card p-5">
        <p className="text-sm font-medium">{receipt ? 'Confirmed receipt' : 'No confirmed receipt in this browser'}</p>
        {receipt && <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{receipt}</p>}
      </div>
    </PublicPageLayout>
  )
}
