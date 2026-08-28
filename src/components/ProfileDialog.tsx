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

/** Read an image file into a data URL and persist it as the avatar override,
 * toasting the outcome. Split out of the change handler so the handler
 * itself stays a single guard clause. */
function readAndStoreAvatar(userKey: string, file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : null
    if (!dataUrl) {
      toast.error('Could not read that image')
      return
    }
    const result = setAvatarOverride(userKey, dataUrl)
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

/** Avatar-override upload/reset, kept out of the dialog's own render body. */
function useAvatarOverride(userKey: string) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file')
      return
    }
    readAndStoreAvatar(userKey, file)
  }

  const handleRemoveAvatarOverride = () => {
    setAvatarOverride(userKey, null)
    toast.success('Reverted to your identity provider picture')
  }

  return { fileInputRef, handleAvatarFile, handleRemoveAvatarOverride }
}

/** Nickname-override draft/save/reset, kept out of the dialog's own render body. */
function useNicknameOverride(userKey: string, open: boolean, persistedNickname: string | null) {
  const [nicknameDraft, setNicknameDraft] = useState('')

  // Reseed the draft from the persisted override every time the dialog opens
  // (or the persisted value itself changes), so a Cancel after typing doesn't
  // leave stale text for next time.
  useEffect(() => {
    if (open) setNicknameDraft(persistedNickname ?? '')
  }, [open, persistedNickname])

  const handleSaveNickname = () => {
    setNicknameOverride(userKey, nicknameDraft)
    toast.success('Local nickname saved (this browser only)')
  }

  const handleResetNickname = () => {
    setNicknameOverride(userKey, null)
    setNicknameDraft('')
    toast.success('Reverted to your account name')
  }

  return { nicknameDraft, setNicknameDraft, handleSaveNickname, handleResetNickname }
}

function AvatarSection({
  avatarSrc,
  effectiveDisplayName,
  avatarOverrideSet,
  avatar,
}: {
  avatarSrc: string | undefined
  effectiveDisplayName: string
  avatarOverrideSet: boolean
  avatar: ReturnType<typeof useAvatarOverride>
}) {
  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16 ring-1 ring-border">
        <AvatarImage src={avatarSrc} alt="" />
        <AvatarFallback className="text-lg">{initialsOf(effectiveDisplayName)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <input
            ref={avatar.fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={avatar.handleAvatarFile}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => avatar.fileInputRef.current?.click()}>
            <Camera className="size-4 mr-1" />
            Upload picture
          </Button>
          {avatarOverrideSet && (
            <Button type="button" variant="ghost" size="sm" onClick={avatar.handleRemoveAvatarOverride}>
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
  )
}

function NicknameSection({
  accountName,
  userKey,
  nicknameOverrideSet,
  nickname,
}: {
  accountName: string | null
  userKey: string
  nicknameOverrideSet: boolean
  nickname: ReturnType<typeof useNicknameOverride>
}) {
  return (
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
          value={nickname.nicknameDraft}
          onChange={(e) => {
            nickname.setNicknameDraft(e.target.value)
          }}
          placeholder={accountName ?? userKey}
        />
        <Button type="button" size="sm" onClick={nickname.handleSaveNickname}>
          Save
        </Button>
        {nicknameOverrideSet && (
          <Button type="button" variant="ghost" size="sm" onClick={nickname.handleResetNickname}>
            Reset
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        How you're addressed in this UI. Your Keycloak account name is unaffected.
      </p>
    </div>
  )
}

function AccountSection({
  accountName,
  accountEmail,
  identity,
}: {
  accountName: string | null
  accountEmail: string | null
  identity: Identity
}) {
  return (
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
  )
}

function deriveAccountName(identity: Identity): string | null {
  const claims = identity.raw
  return claims?.name ?? claims?.username ?? null
}

function deriveAvatarSrc(identity: Identity, override: { avatarDataUrl: string | null }): string | undefined {
  return override.avatarDataUrl ?? identity.raw?.picture ?? undefined
}

function deriveAccountFields(identity: Identity, override: { nickname: string | null; avatarDataUrl: string | null }) {
  const accountName = deriveAccountName(identity)
  return {
    accountName,
    accountEmail: identity.raw?.email ?? null,
    effectiveDisplayName: override.nickname ?? accountName ?? identity.userKey,
    avatarSrc: deriveAvatarSrc(identity, override),
  }
}

export function ProfileDialog({ open, onOpenChange, identity }: ProfileDialogProps) {
  const override = useProfileOverride(identity.userKey)
  const avatar = useAvatarOverride(identity.userKey)
  const nickname = useNicknameOverride(identity.userKey, open, override.nickname)
  const { accountName, accountEmail, effectiveDisplayName, avatarSrc } = deriveAccountFields(identity, override)

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
          <AvatarSection
            avatarSrc={avatarSrc}
            effectiveDisplayName={effectiveDisplayName}
            avatarOverrideSet={!!override.avatarDataUrl}
            avatar={avatar}
          />
          <NicknameSection
            accountName={accountName}
            userKey={identity.userKey}
            nicknameOverrideSet={!!override.nickname}
            nickname={nickname}
          />
          <AccountSection accountName={accountName} accountEmail={accountEmail} identity={identity} />
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
