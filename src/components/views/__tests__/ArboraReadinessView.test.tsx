// spec: WEBUI-APPS-R049.1.2
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import ArboraReadinessView from '@/components/views/ArboraReadinessView'
import { focusReadinessOnArrival, resolveOperateReadinessAlias } from '@/lib/operate-compatibility'

const access = vi.hoisted(() => ({ loading: false, role: 'reader', needsSignIn: false }))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({ loading: access.loading, identity: { role: access.role, needsSignIn: access.needsSignIn } }),
}))
beforeEach(() => {
  access.loading = false
  access.role = 'reader'
  access.needsSignIn = false
  window.history.replaceState({}, '', '/arbora-readiness')
})
it('replaces the compatibility address with typed Operate state without a history loop', async () => {
  const length = window.history.length
  render(
    <StrictMode>
      <ArboraReadinessView />
    </StrictMode>,
  )
  await waitFor(() => {
    expect(window.location.pathname).toBe('/workspace/operate')
  })
  expect(window.history.length).toBe(length)
  expect(window.history.state).toEqual({ operateArrival: 'readiness' })
  expect(screen.queryByText('Arbora Readiness')).not.toBeInTheDocument()
})
it('defers navigation while identity is loading', () => {
  access.loading = true
  render(<ArboraReadinessView />)
  expect(screen.getByRole('status')).toHaveTextContent('Checking readiness access')
  expect(window.location.pathname).toBe('/arbora-readiness')
})
it('retains denial without navigating', () => {
  access.needsSignIn = true
  render(<ArboraReadinessView />)
  expect(screen.getByRole('alert')).toHaveTextContent('not available for this identity')
  expect(window.location.pathname).toBe('/arbora-readiness')
})
it('rejects malformed compatibility state', () => {
  window.history.replaceState({}, '', '/arbora-readiness?unknown=value')
  render(<ArboraReadinessView />)
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid readiness destination')
})
it.each([
  '/integrations',
  '//other.invalid/arbora-readiness',
  '/arbora-readiness#other',
  '/arbora-readiness?check=engine',
])('does not alias %s', (path) => {
  expect(resolveOperateReadinessAlias(path)).toBeNull()
})
it('focuses the contextual heading only for a readiness arrival', () => {
  const heading = document.createElement('h2')
  heading.tabIndex = -1
  document.body.append(heading)
  focusReadinessOnArrival(heading)
  expect(document.activeElement).not.toBe(heading)
  window.history.replaceState({ operateArrival: 'readiness' }, '', '/workspace/operate')
  focusReadinessOnArrival(heading)
  expect(document.activeElement).toBe(heading)
  heading.remove()
})
