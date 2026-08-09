/**
 * @file profile-store.ts
 * @description Local-only profile overrides (W-17): a display avatar and a
 * nickname the operator can set for THIS browser.
 *
 * These are deliberately NOT synced anywhere. The account's real identity —
 * display name, email, and (if Keycloak has one) a picture — comes from the
 * signed-in session's IdP claims (`useIdentity()` / `AuthSession` in
 * `auth.ts`) and is read-only in this app: there is no Keycloak Admin API
 * credential wired into agent-webui, so a "Save" here could never actually
 * change the account, and pretending it did would misinform the operator
 * about what happened when they next look at Keycloak. What CAN honestly be
 * offered is a local override that changes only how this browser renders
 * their identity — same trade-off `chat-store.ts` already made for
 * conversation history, applied to profile chrome.
 *
 * Namespaced per-user by `userKey` (from `useIdentity()`), matching every
 * other local-only store in this app.
 */
import { useEffect, useState } from 'react'

/** Fired whenever this module writes an override, for same-tab listeners (the
 * native `storage` event only fires in OTHER tabs/windows). */
export const PROFILE_OVERRIDE_CHANGED_EVENT = 'profile-store:override-changed'

/** Reject an avatar data URL larger than this -- localStorage is typically
 * capped around 5MB per origin and is shared with chat history; this keeps
 * one avatar from crowding everything else out. */
export const MAX_AVATAR_DATA_URL_LENGTH = 200_000

export interface ProfileOverride {
  /** Data URL of a locally-chosen avatar image, or null to fall back to the
   *  IdP `picture` claim (or initials) instead. */
  avatarDataUrl: string | null
  /** A local display nickname, or null to fall back to the IdP `name` /
   *  `preferred_username` claim instead. */
  nickname: string | null
}

const EMPTY_OVERRIDE: ProfileOverride = { avatarDataUrl: null, nickname: null }

function storageKey(userKey: string): string {
  return `profile:${userKey}:override`
}

export function readProfileOverride(userKey: string): ProfileOverride {
  try {
    const raw = window.localStorage.getItem(storageKey(userKey))
    if (!raw) return EMPTY_OVERRIDE
    const parsed = JSON.parse(raw) as Partial<ProfileOverride>
    return {
      avatarDataUrl: typeof parsed.avatarDataUrl === 'string' ? parsed.avatarDataUrl : null,
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : null,
    }
  } catch {
    return EMPTY_OVERRIDE
  }
}

function writeProfileOverride(userKey: string, override: ProfileOverride): void {
  try {
    if (!override.avatarDataUrl && !override.nickname) {
      window.localStorage.removeItem(storageKey(userKey))
    } else {
      window.localStorage.setItem(storageKey(userKey), JSON.stringify(override))
    }
  } catch {
    // Storage may be disabled (private mode, quota) -- non-fatal, matches the
    // existing best-effort persistence contract chat-store.ts uses.
  }
  window.dispatchEvent(new Event(PROFILE_OVERRIDE_CHANGED_EVENT))
}

/** Set (or clear, with `null`) the local avatar override. Rejects an
 * oversized data URL rather than silently truncating an image. */
export function setAvatarOverride(userKey: string, dataUrl: string | null): { ok: boolean; error?: string } {
  if (dataUrl && dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return { ok: false, error: 'Image is too large for a local avatar (max ~150KB).' }
  }
  const current = readProfileOverride(userKey)
  writeProfileOverride(userKey, { ...current, avatarDataUrl: dataUrl })
  return { ok: true }
}

/** Set (or clear, with `null`) the local nickname override. */
export function setNicknameOverride(userKey: string, nickname: string | null): void {
  const current = readProfileOverride(userKey)
  const trimmed = nickname?.trim()
  writeProfileOverride(userKey, { ...current, nickname: trimmed && trimmed.length > 0 ? trimmed : null })
}

/** The ONE hook profile UI should read overrides through, kept live across
 * same-tab writes and other-tab `storage` events. */
export function useProfileOverride(userKey: string): ProfileOverride {
  const [override, setOverride] = useState<ProfileOverride>(() => readProfileOverride(userKey))

  useEffect(() => {
    setOverride(readProfileOverride(userKey))
  }, [userKey])

  useEffect(() => {
    const refresh = () => {
      setOverride(readProfileOverride(userKey))
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey(userKey)) refresh()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener(PROFILE_OVERRIDE_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(PROFILE_OVERRIDE_CHANGED_EVENT, refresh)
    }
  }, [userKey])

  return override
}
