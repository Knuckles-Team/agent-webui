import { useEffect, useState, type SyntheticEvent } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  connectionProfileRefSchema,
  safeSourceDisplayText,
  type ConnectSourceRequest,
  type SourceProvider,
} from '@/lib/atlas/sources/contracts'

export interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: SourceProvider | null
  submitting?: boolean
  error?: string | null
  initialProfileRef?: string
  onSubmit: (request: ConnectSourceRequest) => void
}

/**
 * Controlled dialog for associating a source with a server-side profile.
 * There are intentionally no endpoint, DSN, username, password, or token
 * controls in this component.
 */
export function ConnectionDialog({
  open,
  onOpenChange,
  provider,
  submitting = false,
  error = null,
  initialProfileRef = '',
  onSubmit,
}: ConnectionDialogProps) {
  const [profileRef, setProfileRef] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const safeError = safeSourceDisplayText(error)

  useEffect(() => {
    const parsed = connectionProfileRefSchema.safeParse(initialProfileRef.trim())
    setProfileRef(parsed.success ? parsed.data : '')
    setValidationError(null)
  }, [initialProfileRef, provider?.source_id, open])

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!provider) return
    const parsed = connectionProfileRefSchema.safeParse(profileRef.trim())
    if (!parsed.success) {
      setValidationError('Enter a controlled profile reference such as secret://sources/example.')
      return
    }
    setValidationError(null)
    onSubmit({ source_id: provider.source_id, connection_profile_ref: parsed.data })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="atlas-connection-dialog">
        <DialogHeader>
          <DialogTitle>Connect {provider?.label ?? 'source'}</DialogTitle>
          <DialogDescription>
            Atlas accepts a reference to a server-managed connection profile. Raw endpoints, credentials, and secret
            values are never submitted by this dialog.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="atlas-connection-profile-ref">
              Connection profile reference
            </label>
            <Input
              id="atlas-connection-profile-ref"
              name="connection_profile_ref"
              value={profileRef}
              onChange={(event) => {
                setProfileRef(event.target.value)
                setValidationError(null)
              }}
              placeholder="secret://sources/example"
              autoComplete="off"
              spellCheck={false}
              disabled={!provider || submitting}
              aria-invalid={validationError !== null}
              aria-describedby="atlas-connection-profile-help atlas-connection-profile-error"
              data-testid="atlas-connection-profile-ref"
            />
            <p id="atlas-connection-profile-help" className="text-muted-foreground text-xs">
              The profile is resolved by GraphOS at run time; only its opaque reference is kept in the UI request.
            </p>
            {validationError && (
              <p id="atlas-connection-profile-error" className="text-destructive text-xs" role="alert">
                {validationError}
              </p>
            )}
            {safeError && (
              <p className="text-destructive text-xs" role="alert" data-testid="atlas-connection-error">
                {safeError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false)
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!provider || submitting || profileRef.trim() === ''}>
              {submitting ? 'Connecting…' : 'Connect profile'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
