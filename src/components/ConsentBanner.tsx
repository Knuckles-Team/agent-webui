import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useConsent, type ConsentRecord } from '@/lib/consent'
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-[var(--agent-webui-mobile-cta-button-height)]"
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
          className="min-h-[var(--agent-webui-mobile-cta-button-height)]"
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
          className="min-h-[var(--agent-webui-mobile-cta-button-height)]"
          onClick={onRevoke}
        >
          Revoke
        </Button>
      )}
      {record && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-[var(--agent-webui-mobile-cta-button-height)]"
          onClick={onClose}
        >
          Close
        </Button>
      )}
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
  config: SiteConfig
  record: ConsentRecord | null
  settingsOpen: boolean
  analyticsConfigured: boolean
  onChoose: (choice: 'granted' | 'denied') => void
  onRevoke: () => void
  onClose: () => void
}

function ConsentPrompt({
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
      className="fixed inset-x-3 bottom-[var(--agent-webui-mobile-consent-bottom)] mx-auto max-w-2xl overflow-y-auto rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur md:bottom-3"
      style={{
        ...mobileSurfaceStyle,
        maxHeight: MOBILE_SURFACE.consentMaxHeight,
        zIndex: MOBILE_SURFACE.consentZIndex,
      }}
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
          You can change this choice at any time with the Privacy settings button. Product analytics is separate from
          server-side Langfuse and RunTrace observability.
        </p>
      )}
    </aside>
  )
}

function PrivacySettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="fixed bottom-[var(--agent-webui-mobile-consent-bottom)] left-3 rounded-full border bg-background/95 px-3 py-2 text-xs shadow-md backdrop-blur md:bottom-3"
      style={{ ...mobileSurfaceStyle, zIndex: MOBILE_SURFACE.consentZIndex }}
      data-mobile-surface="consent"
      onClick={onOpen}
      aria-label="Open privacy settings"
    >
      Privacy settings
    </button>
  )
}

export function ConsentBanner() {
  const { record, choose, revoke } = useConsent()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const config = getSiteConfig()
  const analyticsConfigured = config.analytics !== null

  const chooseAndClose = (choice: 'granted' | 'denied') => {
    choose(choice)
    setSettingsOpen(false)
  }

  const revokeAndClose = () => {
    revoke()
    setSettingsOpen(false)
  }

  const openSettings = () => {
    setSettingsOpen(true)
  }

  const closeSettings = () => {
    setSettingsOpen(false)
  }

  if (record && !settingsOpen) return <PrivacySettingsButton onOpen={openSettings} />

  return (
    <ConsentPrompt
      config={config}
      record={record}
      settingsOpen={settingsOpen}
      analyticsConfigured={analyticsConfigured}
      onChoose={chooseAndClose}
      onRevoke={revokeAndClose}
      onClose={closeSettings}
    />
  )
}
