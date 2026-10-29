// spec: OVERSTORY-DESIGN-R002
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '../theme-provider'
import { WorkspaceAppearance } from '../workspace/WorkspaceAppearance'

vi.mock('@/hooks/use-theme-colorizer', () => ({
  useThemeColorizer: () => ({ baseColor: '0.52 0.18 260', setBaseColor: vi.fn() }),
}))

function ThemeControls() {
  const { setTheme } = useTheme()
  return (
    <>
      <button
        onClick={() => {
          setTheme('glass')
        }}
      >
        Glass
      </button>
      <button
        onClick={() => {
          setTheme('light')
        }}
      >
        Light
      </button>
      <button
        onClick={() => {
          setTheme('dark')
        }}
      >
        Dark
      </button>
      <button
        onClick={() => {
          setTheme('system')
        }}
      >
        System
      </button>
    </>
  )
}

afterEach(() => {
  document.documentElement.classList.remove('light', 'dark', 'glass', 'unrelated')
  localStorage.removeItem('theme-transition-test')
  vi.restoreAllMocks()
})

it.each([
  ['Light', false, 'light'],
  ['Dark', false, 'dark'],
  ['System', false, 'light'],
  ['System', true, 'dark'],
])('retires glass when selecting %s with dark preference %s', (choice, dark, expected) => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: dark && query === '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  )
  localStorage.setItem('theme-transition-test', 'glass')
  document.documentElement.classList.add('unrelated')
  render(
    <ThemeProvider storageKey="theme-transition-test">
      <ThemeControls />
    </ThemeProvider>,
  )
  expect(document.documentElement).toHaveClass('glass')
  for (let cycle = 0; cycle < 2; cycle++) {
    fireEvent.click(screen.getByRole('button', { name: choice }))
    expect(document.documentElement).toHaveClass(expected, 'unrelated')
    expect(document.documentElement).not.toHaveClass('glass')
    expect(document.documentElement).not.toHaveClass(expected === 'light' ? 'dark' : 'light')
    expect(localStorage.getItem('theme-transition-test')).toBe(choice.toLowerCase())
    fireEvent.click(screen.getByRole('button', { name: 'Glass' }))
    expect(document.documentElement).toHaveClass('glass', 'unrelated')
    expect(document.documentElement).not.toHaveClass('light')
    expect(document.documentElement).not.toHaveClass('dark')
  }
})

// spec: OVERSTORY-DESIGN-R002.1.1
// spec: OVERSTORY-DESIGN-R005.2
function AppearanceControls() {
  const { density, setDensity, motion, setMotion, transparency, setTransparency } = useTheme()
  return (
    <>
      <button
        onClick={() => {
          setDensity(density === 'compact' ? 'comfortable' : 'compact')
        }}
      >
        Density
      </button>
      <button
        onClick={() => {
          setMotion(motion === 'system' ? 'reduce' : 'system')
        }}
      >
        Motion
      </button>
      <button
        onClick={() => {
          setTransparency(transparency === 'glass' ? 'opaque' : 'glass')
        }}
      >
        Surfaces
      </button>
    </>
  )
}

it('loads and persists bounded density and effect preferences independently of theme', () => {
  localStorage.setItem('agent-webui.density', 'comfortable')
  localStorage.setItem('agent-webui.motion', 'reduce')
  localStorage.setItem('agent-webui.transparency', 'opaque')
  render(
    <ThemeProvider storageKey="theme-transition-test">
      <AppearanceControls />
    </ThemeProvider>,
  )
  const root = document.documentElement
  expect(root.dataset).toMatchObject({ density: 'comfortable', motion: 'reduce', transparency: 'opaque' })
  fireEvent.click(screen.getByRole('button', { name: 'Density' }))
  fireEvent.click(screen.getByRole('button', { name: 'Motion' }))
  fireEvent.click(screen.getByRole('button', { name: 'Surfaces' }))
  expect(root.dataset).toMatchObject({ density: 'compact', motion: 'system', transparency: 'glass' })
  expect(localStorage.getItem('agent-webui.density')).toBe('compact')
  expect(localStorage.getItem('agent-webui.motion')).toBe('system')
  expect(localStorage.getItem('agent-webui.transparency')).toBe('glass')
})

it('keeps preference changes usable when storage is denied', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage denied')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage denied')
  })
  render(
    <ThemeProvider storageKey="theme-transition-test">
      <AppearanceControls />
      <ThemeControls />
    </ThemeProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Density' }))
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
  expect(document.documentElement.dataset.density).toBe('comfortable')
  expect(document.documentElement).toHaveClass('dark')
})

// spec: OVERSTORY-DESIGN-R002.1.1
it('presents legacy glass as the light palette with an independent material preference', () => {
  localStorage.setItem('theme-transition-test', 'glass')
  render(
    <ThemeProvider storageKey="theme-transition-test">
      <WorkspaceAppearance />
    </ThemeProvider>,
  )
  fireEvent.click(screen.getByText('Settings'))
  expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('light')
  expect(screen.queryByRole('option', { name: 'Canopy glass' })).not.toBeInTheDocument()
  expect(localStorage.getItem('theme-transition-test')).toBe('glass')
  fireEvent.change(screen.getByRole('combobox', { name: 'Surfaces' }), { target: { value: 'opaque' } })
  expect(document.documentElement.dataset.transparency).toBe('opaque')
  expect(document.documentElement).toHaveClass('glass')
})
