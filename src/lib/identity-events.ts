/** Identity hints carry no authority or credentials; the server decides the next state. */
export const IDENTITY_INVALIDATED = 'arbora:identity-invalidated'
export const IDENTITY_STORAGE_KEY = 'arbora:identity-changed'

export function invalidateIdentity(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(IDENTITY_INVALIDATED))
  try {
    window.localStorage.setItem(IDENTITY_STORAGE_KEY, crypto.randomUUID())
  } catch {
    // Same-tab invalidation and focus revalidation still work without storage.
  }
}

export function observeIdentityStatus(status: number): void {
  if (status === 401) invalidateIdentity()
}
