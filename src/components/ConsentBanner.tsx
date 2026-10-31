import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConsent, consentStorageUnavailable, type ConsentRecord } from '@/lib/consent'
import { getSiteConfig, type SiteConfig } from '@/lib/site-config'
import { MOBILE_SURFACE, mobileSurfaceStyle } from './mobile-surface'

/** Consent UI shared by every route; analytics never initializes from this component. */

interface ConsentActionsProps {
  record: ConsentRecord | null
  analyticsConfigured: boolean
  onChoose: (choice: 'granted' | 'denied') => void
  onRevoke: () => void
  onClose: () => void
}

function ConsentActions({ record, analyticsConfigured, onChoose, onRevoke, onClose }: ConsentActionsProps) {
  return (
    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
      {!record && (
        <Button
          type="button"
          size="sm"
          className="min-h-[var(--overstory-mobile-cta-button-height)]"
          onClick={() => {
            onChoose('granted')
          }}
        >
          Accept
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-[var(--overstory-mobile-cta-button-height)]"
        onClick={() => {
          onChoose('denied')
        }}
      >
        {record ? 'Disable optional' : 'Decline optional'}
      </Button>
      {analyticsConfigured && (
        <Button
          type="button"
          size="sm"
          className="min-h-[var(--overstory-mobile-cta-button-height)]"
          onClick={() => {
            onChoose('granted')
          }}
        >
          Allow analytics
        </Button>
      )}
      {record && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-[var(--overstory-mobile-cta-button-height)]"
          onClick={onRevoke}
        >
          Revoke
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-[var(--overstory-mobile-cta-button-height)]"
        onClick={onClose}
      >
        Dismiss
      </Button>
    </div>
  )
}

function analyticsCopy(analyticsConfigured: boolean): { label: string; detail: string } {
  if (analyticsConfigured) {
    return {
      label: 'Optional product analytics ',
      detail: 'starts only after you choose Allow, and can be revoked here.',
    }
  }
  return {
    label: 'Optional analytics ',
    detail: 'is not configured for this deployment and is currently disabled.',
  }
}

interface ConsentPromptProps {
  placement: 'floating' | 'workspace'
  config: SiteConfig
  record: ConsentRecord | null
  settingsOpen: boolean
  analyticsConfigured: boolean
  onChoose: (choice: 'granted' | 'denied') => void
  onRevoke: () => void
  onClose: () => void
}

function ConsentPrompt({
  placement,
  config,
  record,
  settingsOpen,
  analyticsConfigured,
  onChoose,
  onRevoke,
  onClose,
}: ConsentPromptProps) {
  const copy = analyticsCopy(analyticsConfigured)
  return (
    <aside
      // Workspace consent participates in flex layout instead of intercepting
      // navigation or the chat composer. Its own overflow preserves all choices.
      className={
        placement === 'workspace'
          ? 'relative min-h-0 max-h-[35dvh] shrink-0 overflow-y-auto border-b bg-background p-3'
          : 'fixed inset-x-3 top-3 mx-auto max-w-2xl overflow-y-auto rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur'
      }
      style={
        placement === 'workspace'
          ? mobileSurfaceStyle
          : {
              ...mobileSurfaceStyle,
              maxHeight: 'calc(100dvh - 1.5rem - var(--overstory-mobile-safe-area-bottom))',
              zIndex: MOBILE_SURFACE.consentZIndex,
            }
      }
      data-mobile-surface="consent"
      aria-label="Privacy consent"
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 text-sm">
          <h2 className="font-semibold">Privacy choices</h2>
          <p className="text-muted-foreground">
            Strictly necessary session behavior stays available. {copy.label}
            {copy.detail}
          </p>
          <address className="not-italic whitespace-pre-line text-xs text-muted-foreground">
            {config.contactAddress
              ? `Privacy contact: ${config.contactAddress}`
              : 'Contact address not configured for this deployment.'}
          </address>
        </div>
        <ConsentActions
          record={record}
          analyticsConfigured={analyticsConfigured}
          onChoose={onChoose}
          onRevoke={onRevoke}
          onClose={onClose}
        />
      </div>
      {settingsOpen && (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          You can change this choice at any time on the Privacy page. Product analytics is separate from server-side
          Langfuse and RunTrace observability.
        </p>
      )}
    </aside>
  )
}

function reportStorageFailure() {
  if (consentStorageUnavailable()) {
    toast.warning(
      'Privacy settings apply in this tab only. Browser storage is unavailable, so a reload may ask again.',
    )
  }
}

/** Automatic prompts disappear after a choice or dismissal; management lives on /privacy. */
export function ConsentBanner({ placement = 'floating' }: { placement?: 'floating' | 'workspace' }) {
  const { record, dismissed, choose, revoke, dismiss } = useConsent()
  const config = getSiteConfig()
  const finish = () => {
    reportStorageFailure()
    if (placement === 'workspace') document.getElementById('workspace-home')?.focus()
  }
  if (record || dismissed) return null

  return (
    <ConsentPrompt
      placement={placement}
      config={config}
      record={record}
      settingsOpen={false}
      analyticsConfigured={config.analytics !== null}
      onChoose={(choice) => {
        choose(choice)
        finish()
      }}
      onRevoke={() => {
        revoke()
        finish()
      }}
      onClose={() => {
        dismiss()
        finish()
      }}
    />
  )
}

/** Explicit, always reachable management, independent of automatic prompt dismissal. */
export function PrivacyConsentSettings() {
  const disableButton = useRef<HTMLButtonElement>(null)
  const { record, choose, revoke } = useConsent()
  const config = getSiteConfig()
  return (
    <section aria-label="Privacy settings" className="space-y-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Privacy settings</h2>
      <p className="text-sm">Optional analytics: {record?.choice === 'granted' ? 'allowed' : 'not allowed'}.</p>
      <p className="text-sm text-muted-foreground">
        Optional analytics stays off unless you allow it. You can change your choice here at any time.
      </p>
      {config.analytics === null && <p className="text-sm">Analytics is not configured for this deployment.</p>}
      <div className="flex flex-wrap gap-2">
        {config.analytics !== null && (
          <Button
            className="min-h-11"
            onClick={() => {
              choose('granted')
              reportStorageFailure()
            }}
          >
            Allow analytics
          </Button>
        )}
        <Button
          ref={disableButton}
          variant="outline"
          className="min-h-11"
          onClick={() => {
            choose('denied')
            reportStorageFailure()
          }}
        >
          Disable optional
        </Button>
        {record?.choice === 'granted' && (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              revoke()
              reportStorageFailure()
              disableButton.current?.focus()
            }}
          >
            Revoke
          </Button>
        )}
      </div>
    </section>
  )
}
