import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResponsiveLimitation, findMobileAlternative } from '@/components/ResponsiveLimitation'
import { ROUTES } from '@/lib/nav-registry'

function route(id: string) {
  const match = ROUTES.find((candidate) => candidate.id === id)
  if (!match) throw new Error(`missing test route ${id}`)
  return match
}

describe('ResponsiveLimitation', () => {
  it('provides a safe registered alternative for every unsupported route', () => {
    const unsupported = ROUTES.filter((candidate) => candidate.mobile === 'unsupported')
    expect(unsupported.length).toBeGreaterThan(0)
    for (const candidate of unsupported) {
      const alternative = findMobileAlternative(candidate)
      expect(alternative, `${candidate.id} needs a mobile alternative`).not.toBeNull()
      expect(alternative?.mobile).not.toBe('unsupported')
      expect(ROUTES).toContain(alternative)
    }
  })

  it('blocks an unsupported route on mobile and links to the registered alternative', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390, writable: true })
    render(
      <ResponsiveLimitation route={route('control-plane.workflows')}>
        <div data-testid="desktop-route">desktop route body</div>
      </ResponsiveLimitation>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /needs a larger screen/i })).toBeInTheDocument()
    })
    expect(screen.queryByTestId('desktop-route')).not.toBeInTheDocument()
    const alternative = findMobileAlternative(route('control-plane.workflows'))
    expect(screen.getByRole('link', { name: `Open ${alternative?.label}` })).toHaveAttribute('href', alternative?.path)
  })

  it('keeps the route body on a desktop viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280, writable: true })
    render(
      <ResponsiveLimitation route={route('control-plane.workflows')}>
        <div data-testid="desktop-route">desktop route body</div>
      </ResponsiveLimitation>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('desktop-route')).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /needs a larger screen/i })).not.toBeInTheDocument()
  })
})
