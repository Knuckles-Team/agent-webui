/**
 * @file AuthModeBanner.tsx
 * @description The persistent warning an unsecured install shows on every
 * page. The text is the server's (`/auth/session` → `banner`, present only in
 * the `none` demo mode); the frontend adds nothing but the way out: claiming
 * the bootstrap administrator with `graph-os-identity claim`.
 */
import type { Identity } from '@/lib/auth'

export function AuthModeBanner({ identity }: { identity: Identity }) {
  const banner = identity.raw?.banner
  if (!banner) return null
  return (
    <div
      role="alert"
      data-testid="auth-mode-banner"
      className="flex shrink-0 items-center justify-center gap-3 bg-destructive px-4 py-2 text-sm font-medium text-white"
    >
      <span>{banner}</span>
      <span>
        Secure this install: <code className="font-mono">graph-os-identity claim</code>
      </span>
    </div>
  )
}
