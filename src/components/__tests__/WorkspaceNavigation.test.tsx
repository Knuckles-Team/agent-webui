// spec: OVERSTORY-APPS-R046.1
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '@/lib/nav-registry'
import { WorkspaceNavigation } from '../WorkspaceNavigation'
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => <button>Sidebar</button> }))
vi.mock('@/lib/apps/catalog', () => ({
  useAppAvailability: () => ({ loading: false, available: new Set(), reasons: new Map() }),
}))
afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

function mount() {
  return render(
    <WorkspaceNavigation route={ROUTES.find((route) => route.id === 'chat.console')!} currentRole="user" />,
  )
}

describe('workspace branch navigator', () => {
  it('shows Overstory without changing the home destination', () => {
    mount()
    expect(screen.getByRole('link', { name: 'Overstory' })).toHaveAttribute('href', '/')
  })
  it('keeps branch and list navigation on the same registered destinations', () => {
    mount()
    fireEvent.click(screen.getByText('Explore branches'))
    const before = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(before)
    expect(screen.queryByRole('link', { name: 'Workflows' })).not.toBeInTheDocument()
  })
  it('filters, navigates and restores disclosure focus', () => {
    mount()
    const trigger = screen.getByText('Explore branches')
    fireEvent.click(trigger)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Object Explorer' } })
    fireEvent.click(screen.getByRole('link', { name: 'Object Explorer' }))
    expect(window.location.pathname).toBe('/explorer')
    expect(trigger.closest('details')).not.toHaveAttribute('open')
    expect(trigger).toHaveFocus()
  })
  it('offers keyboard Escape without a focus trap or route mutation', () => {
    mount()
    const trigger = screen.getByText('Explore branches')
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(trigger.closest('details')).not.toHaveAttribute('open')
    expect(trigger).toHaveFocus()
    expect(window.location.pathname).toBe('/')
  })
})

// spec: OVERSTORY-APPS-R046.2.1
it('opens privacy management inside Settings on retained routes without granting consent', () => {
  window.localStorage.removeItem('agent-webui.consent')
  mount()
  const settings = screen.getByText('Settings')
  expect(settings.closest('details')).not.toHaveAttribute('open')
  expect(screen.getByRole('region', { name: 'Privacy settings' })).not.toBeVisible()
  fireEvent.click(settings)
  expect(screen.getByRole('region', { name: 'Privacy settings' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Privacy policy and details' })).toHaveAttribute('href', '/privacy')
  expect(window.localStorage.getItem('agent-webui.consent')).toBeNull()
  expect(window.location.pathname).toBe('/')
})
