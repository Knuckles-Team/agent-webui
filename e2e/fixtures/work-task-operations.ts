// Synthetic envelopes for UI-only journeys, never installed-provider evidence.
export const taskReadFixture = 'synthetic-task-read'
const meta = { registry_digest: 'synthetic-task-read', api_version: 'v1' }
export const operation = (value: unknown) => ({ ok: true, result: { value }, meta })
export const taskPage = (tasks: unknown[]) => operation({ tasks, nextCursor: null })
export const refusal = () => ({
  ok: false,
  error: { code: 'ACCESS_DENIED', source: 'arbora', message: 'Denied', retryable: false },
  meta,
})
