// spec: WEBUI-DESIGN-R002
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '../theme-provider'

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
    (query) => ({ matches: dark && query === '(prefers-color-scheme: dark)' }) as MediaQueryList,
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
