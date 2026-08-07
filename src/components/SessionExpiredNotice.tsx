/**
 * @file SessionExpiredNotice.tsx
 * @description The shared "your session ended, sign in again" state a view
 * renders when its data fetch throws {@link ApiError} with `status === 401`.
 *
 * D-WUI (2026-08-06): several views (`MemoryView`, `KnowledgeView`,
 * `PromptsView`) called `fetch()` directly and stored a non-2xx JSON error
 * envelope (`{"error": "..."}`) straight into state, which a later
 * `.filter()`/`.map()` then crashed on — one auth failure, a dozen broken
 * pages. The fix is at the chokepoint (`src/lib/api-validation.ts`): a
 * non-2xx response now always throws `ApiError` before it can reach a view as
 * data. This component is what a view renders when it catches that error
 * with `status === 401`, instead of a blank/empty state or a generic toast a
 * user cannot act on. Mirrors the same affordance `App.tsx`'s route guard
 * already shows for `identity.needsSignIn`.
 */
export function SessionExpiredNotice({
  message = 'Your session has expired.',
}: {
  message?: string
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
      <p className="text-sm text-muted-foreground mb-2">{message}</p>
      <a href="/auth/login" className="text-sm text-primary underline">
        Sign in
      </a>
    </div>
  )
}
