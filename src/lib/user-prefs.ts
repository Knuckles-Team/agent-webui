/**
 * @file user-prefs.ts
 * @description Generic, reusable per-user `localStorage` preference primitive
 * (R9: "dashboard layout, preferences ... per user").
 *
 * This is the same namespacing discipline `chat-store.ts` applies to chat
 * sessions, factored out so any OTHER per-user surface (dashboard panel
 * layout, per-view display settings, ...) can adopt it without re-deriving
 * the namespace-key / migration / same-tab-notification logic itself. It
 * does not migrate any existing view's storage on its own — views outside
 * this lane's ownership (`src/components/views/**`) should switch their own
 * `localStorage` calls to {@link userPrefKey} / {@link useUserPreference}
 * when convenient; `theme-provider.tsx` is the reference adopter.
 */
import { useCallback, useEffect, useState } from 'react'

/** Fired whenever this module writes a preference, for same-tab listeners. */
export const USER_PREF_CHANGED_EVENT = 'user-prefs:changed'

/** The namespaced localStorage key for preference `name` under `userKey`.
 * Exposed so a caller that wants direct `localStorage` access (rather than
 * the hook) still gets the same namespace `chat-store.ts` and `auth.ts` use. */
export function userPrefKey(userKey: string, name: string): string {
  return `pref:${userKey}:${name}`
}

function readPref<T>(userKey: string, name: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(userPrefKey(userKey, name))
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writePref(userKey: string, name: string, value: unknown): void {
  try {
    window.localStorage.setItem(userPrefKey(userKey, name), JSON.stringify(value))
  } catch {
    // Storage may be disabled (private mode, quota) — non-fatal.
  }
  window.dispatchEvent(new Event(USER_PREF_CHANGED_EVENT))
}

/**
 * A `useState`-shaped hook for one namespaced preference. Re-reads when
 * `userKey` changes (e.g. identity resolves after the initial unauthenticated
 * render) and stays in sync with same-tab writes via {@link USER_PREF_CHANGED_EVENT}
 * and cross-tab writes via the native `storage` event.
 */
export function useUserPreference<T>(userKey: string, name: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(userKey, name, fallback))
  const key = userPrefKey(userKey, name)

  useEffect(() => {
    setValue(readPref(userKey, name, fallback))
    // Deliberately keyed on `userKey`/`name` only: `fallback` is read once per
    // mount/identity-change via closure, and is not itself state this effect
    // should re-run for — an inline default (e.g. `[]`) is a fresh reference
    // every render, which would turn this into a render loop if included.
  }, [userKey, name])

  useEffect(() => {
    const refresh = () => {
      setValue(readPref(userKey, name, fallback))
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) refresh()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener(USER_PREF_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(USER_PREF_CHANGED_EVENT, refresh)
    }
  }, [key, name, userKey, fallback])

  const update = useCallback(
    (next: T) => {
      writePref(userKey, name, next)
      setValue(next)
    },
    [userKey, name],
  )

  return [value, update]
}
