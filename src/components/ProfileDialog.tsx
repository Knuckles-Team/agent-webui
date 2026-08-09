/**
 * @file ProfileDialog.tsx
 * @description The profile surface (W-17): avatar, display name, and email.
 *
 * **What is editable, and why.** This app has no Keycloak Admin API
 * credential wired in, so there is no way for a "Save" here to actually
 * change the signed-in account -- only the IdP (Keycloak) can do that. Rather
 * than render an input that silently discards what you type, or a fake
 * "Saved" toast for a field that never left the browser, the account fields
 * (display name, username, email, role) are shown READ-ONLY, sourced
 * verbatim from the session's OIDC claims (`useIdentity()` / `AuthSession` in
 * `lib/auth.ts` -> `agent/agent_webui/oidc_session.py::_handle_session`).
 *
 * What genuinely CAN be offered honestly is a LOCAL override -- an avatar and
 * a nickname stored only in this browser (`lib/profile-store.ts`), the same
 * trade-off `chat-store.ts` already makes for conversation history. Both are
 * clearly labeled as local-only in the UI below.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Camera, Mail, RotateCcw, ShieldCheck, User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import type { Identity } from '@/lib/auth'
import { setAvatarOverride, setNicknameOverride, useProfileOverride } from '@/lib/profile-store'

export interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  identity: Identity
}

/** Initials fallback when there is no avatar image at all (override or IdP). */
function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function ProfileDialog({ open, onOpenChange, identity }: ProfileDialogProps) {
  const override = useProfileOverride(identity.userKey)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [nicknameDraft, setNicknameDraft] = useState('')

  const claims = identity.raw
  const accountName = claims?.name ?? claims?.username ?? null
  const accountEmail = claims?.email ?? null
  const effectiveDisplayName = override.nickname ?? accountName ?? identity.userKey
  const avatarSrc = override.avatarDataUrl ?? claims?.picture ?? undefined

  // Reseed the draft from the persisted override every time the dialog opens
  // (or the persisted value itself changes), so a Cancel after typing doesn't
  // leave stale text for next time.
  useEffect(() => {
    if (open) setNicknameDraft(override.nickname ?? '')
  }, [open, override.nickname])

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null
      if (!dataUrl) {
        toast.error('Could not read that image')
        return
      }
      const result = setAvatarOverride(identity.userKey, dataUrl)
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save that image')
        return
      }
      toast.success('Local avatar updated (this browser only)')
    }
    reader.onerror = () => {
      toast.error('Could not read that image')
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveAvatarOverride = () => {
    setAvatarOverride(identity.userKey, null)
    toast.success('Reverted to your identity provider picture')
  }

  const handleSaveNickname = () => {
    setNicknameOverride(identity.userKey, nicknameDraft)
    toast.success('Local nickname saved (this browser only)')
  }

  const handleResetNickname = () => {
    setNicknameOverride(identity.userKey, null)
    setNicknameDraft('')
    toast.success('Reverted to your account name')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>
            Your avatar and nickname below are local to this browser. Your account name, email, and role come from your
            identity provider and cannot be changed here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Avatar -- locally editable */}
          <div className="flex items-center gap-4">
            <Avatar className="size-16 ring-1 ring-border">
              <AvatarImage src={avatarSrc} alt="" />
              <AvatarFallback className="text-lg">{initialsOf(effectiveDisplayName)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFile}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Camera className="size-4 mr-1" />
                  Upload picture
                </Button>
                {override.avatarDataUrl && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleRemoveAvatarOverride}>
                    <RotateCcw className="size-4 mr-1" />
                    Reset
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground max-w-64">
                Stored only in this browser — does not change your picture in Keycloak.
              </p>
            </div>
          </div>

          {/* Nickname -- locally editable */}
          <div className="space-y-1.5">
            <label htmlFor="profile-nickname" className="text-sm font-medium flex items-center gap-1.5">
              Local nickname
              <Badge variant="outline" className="text-[10px] font-normal">
                this browser only
              </Badge>
            </label>
            <div className="flex gap-2">
              <Input
                id="profile-nickname"
                value={nicknameDraft}
                onChange={(e) => {
                  setNicknameDraft(e.target.value)
                }}
                placeholder={accountName ?? identity.userKey}
              />
              <Button type="button" size="sm" onClick={handleSaveNickname}>
                Save
              </Button>
              {override.nickname && (
                <Button type="button" variant="ghost" size="sm" onClick={handleResetNickname}>
                  Reset
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              How you're addressed in this UI. Your Keycloak account name is unaffected.
            </p>
          </div>

          {/* Account -- read-only, from the IdP */}
          <div className="rounded-md border p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Account</span>
              <Badge variant="outline" className="text-[10px] font-normal">
                from your identity provider
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <User className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{accountName ?? 'Not provided by identity provider'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{accountEmail ?? 'Not provided by identity provider'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
              <span className="capitalize">{identity.role}</span>
              <span className="text-xs text-muted-foreground">webui role</span>
            </div>
            {!identity.ssoConfigured && (
              <p className="text-xs text-muted-foreground pt-1 border-t">
                Single sign-on is not configured for this deployment — this is the local single-operator profile.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
