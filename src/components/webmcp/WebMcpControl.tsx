import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WebMcpControlChannel, WebMcpChannelView } from '@/lib/webmcp/channel'

export interface WebMcpControlProps {
  readonly channel: Pick<
    WebMcpControlChannel,
    'respondProposal' | 'arm' | 'confirm' | 'deny' | 'getView' | 'revoke' | 'subscribe'
  >
  readonly placement?: 'floating' | 'workspace'
  readonly collapsible?: boolean
  readonly visible: boolean
  readonly isAttendedGesture?: (event: MouseEvent<HTMLButtonElement>) => boolean
}

function scopeSummary(view: WebMcpChannelView): string {
  if (view.toolIds.length === 0) return 'No browser tools are registered.'
  return `${view.toolIds.length} local browser tool${view.toolIds.length === 1 ? '' : 's'}`
}

/** Visible attended control and exact-request mutation confirmation surface. */
function browserTrustedGesture(event: MouseEvent<HTMLButtonElement>): boolean {
  return event.nativeEvent.isTrusted
}

function panelClass(placement: 'floating' | 'workspace'): string {
  return placement === 'workspace'
    ? 'min-w-0 rounded-lg border bg-background p-3 text-sm'
    : 'fixed top-16 right-3 z-40 max-w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border bg-background/95 p-3 text-sm shadow-lg backdrop-blur'
}

function ControlFrame({
  collapsible,
  view,
  children,
}: {
  collapsible: boolean
  view: WebMcpChannelView
  children: ReactNode
}) {
  if (!collapsible) return <>{children}</>
  return (
    <details className="min-w-0 border-b bg-background">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
        Browser control settings · {view.status}
        {view.message ? ' · attention needed' : ''}
      </summary>
      {children}
    </details>
  )
}

export function WebMcpControl({
  channel,
  visible,
  placement = 'floating',
  collapsible = false,
  isAttendedGesture = browserTrustedGesture,
}: WebMcpControlProps) {
  const view = useSyncExternalStore(
    channel.subscribe.bind(channel),
    channel.getView.bind(channel),
    channel.getView.bind(channel),
  )
  const confirmation = view.pendingConfirmation
  if (!visible) return null

  const controls = (
    <aside className={panelClass(placement)} aria-label="Remote browser control">
      <div className="flex items-center gap-2 font-medium">
        <ShieldCheck aria-hidden="true" className="size-4" />
        Browser control
      </div>
      {view.status === 'armed' || view.status === 'connected' ? (
        <div className="mt-2 space-y-2">
          <p role="status" className="text-xs text-muted-foreground">
            {view.status === 'armed'
              ? `Armed for ${scopeSummary(view)} in this visible page.`
              : `Connected for ${scopeSummary(view)}; Arbora validation is pending.`}
          </p>
          {view.expiresAt !== null && (
            <p className="text-xs text-muted-foreground">
              Attended authorization expires at{' '}
              <time dateTime={new Date(view.expiresAt * 1_000).toISOString()}>
                {new Date(view.expiresAt * 1_000).toLocaleTimeString()}
              </time>
              .
            </p>
          )}
          <ul className="sr-only" aria-label="Armed browser tools">
            {view.toolIds.map((toolId) => (
              <li key={toolId}>{toolId}</li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              channel.revoke()
            }}
          >
            Revoke browser control
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Allow Arbora to request only the registered tools in this page. Control ends on page or identity change.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={view.status === 'connecting'}
            onClick={(event) => {
              if (!isAttendedGesture(event)) return
              void channel.arm()
            }}
          >
            {view.status === 'connecting' ? 'Arming…' : 'Arm browser control'}
          </Button>
        </div>
      )}
      {view.message && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {view.message}
        </p>
      )}
    </aside>
  )

  return (
    <>
      <ControlFrame collapsible={collapsible} view={view}>
        {controls}
      </ControlFrame>

      <ProposalReview
        channel={channel}
        proposal={view.pendingProposal}
        blocked={confirmation !== null}
        isAttendedGesture={isAttendedGesture}
      />

      <Dialog open={confirmation !== null}>
        <DialogContent showCloseButton={false} aria-describedby="webmcp-confirmation-description">
          <DialogHeader>
            <DialogTitle>Confirm browser action</DialogTitle>
            <DialogDescription id="webmcp-confirmation-description">
              Arbora is requesting one local UI change. The approval applies only to this call, tool version, schema,
              and argument digest.
            </DialogDescription>
          </DialogHeader>
          {confirmation && (
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="font-medium">Tool</dt>
                <dd>{confirmation.toolTitle}</dd>
              </div>
              <div>
                <dt className="font-medium">Tool ID and version</dt>
                <dd className="break-all font-mono text-xs">
                  {confirmation.toolId}@{confirmation.toolVersion}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Schema digest</dt>
                <dd className="break-all font-mono text-xs">{confirmation.schemaDigest}</dd>
              </div>
              <div>
                <dt className="font-medium">Argument digest</dt>
                <dd className="break-all font-mono text-xs">{confirmation.argumentDigest}</dd>
              </div>
            </dl>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirmation) channel.deny(confirmation.callId)
              }}
            >
              Deny
            </Button>
            <Button
              type="button"
              onClick={(event) => {
                if (confirmation && isAttendedGesture(event)) channel.confirm(confirmation.callId)
              }}
            >
              Confirm this action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProposalReview({
  channel,
  proposal,
  blocked,
  isAttendedGesture,
}: {
  readonly channel: WebMcpControlProps['channel']
  readonly proposal: WebMcpChannelView['pendingProposal']
  readonly blocked: boolean
  readonly isAttendedGesture: (event: MouseEvent<HTMLButtonElement>) => boolean
}) {
  return (
    <Dialog open={proposal !== null && !blocked}>
      <DialogContent
        showCloseButton={false}
        aria-describedby="webmcp-proposal-description"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto [overflow-wrap:anywhere]"
      >
        <DialogHeader>
          <DialogTitle>Review agent browser request</DialogTitle>
          <DialogDescription id="webmcp-proposal-description">
            Accepting lets Arbora evaluate this request. Changes still require a separate exact-action confirmation.
          </DialogDescription>
        </DialogHeader>
        {proposal && (
          <dl className="min-w-0">
            <dt>Tool</dt>
            <dd>
              {proposal.toolTitle} ({proposal.toolId})
            </dd>
            <dt>Requesting agent</dt>
            <dd>{proposal.requesterAgent}</dd>
            <dt>Agent run reference</dt>
            <dd>{proposal.requesterRunRef}</dd>
            <dt>Exact arguments</dt>
            <dd>
              <pre className="max-h-[40dvh] overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]" tabIndex={0}>
                {proposal.argumentsJson}
              </pre>
            </dd>
            <dt>Expires</dt>
            <dd>
              <time dateTime={new Date(proposal.expiresAt * 1_000).toISOString()}>
                {new Date(proposal.expiresAt * 1_000).toLocaleTimeString()}
              </time>
            </dd>
          </dl>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (proposal) channel.respondProposal(proposal.proposalId, false)
            }}
          >
            Decline request
          </Button>
          <Button
            type="button"
            onClick={(event) => {
              if (proposal && isAttendedGesture(event)) channel.respondProposal(proposal.proposalId, true)
            }}
          >
            Accept request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
