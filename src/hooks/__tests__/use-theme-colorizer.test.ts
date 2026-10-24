import { contrastRatio, cssColorToHex } from '@/components/knowledge-graph/theme-colors'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { act, renderHook } from '@testing-library/react'

import { normalizeBaseColor, useThemeColorizer } from '../use-theme-colorizer'

describe('normalizeBaseColor', () => {
  it('canonicalizes finite in-range OKLCH components', () => {
    expect(normalizeBaseColor(' 0.52   0.18  260 ')).toBe('0.52 0.18 260')
    expect(normalizeBaseColor('1 .5 -360')).toBe('1 0.5 -360')
  })

  it.each([
    "0.5 0.2 260')/><script>alert(1)</script>",
    'NaN 0.2 260',
    '0.5 Infinity 260',
    '1.1 0.2 260',
    '0.5 0.6 260',
    '0.5 0.2 361',
  ])('rejects unsafe or out-of-range color %s', (value) => {
    expect(normalizeBaseColor(value)).toBeNull()
  })
})

// spec: WEBUI-DESIGN-R002.1.1
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem('pydantic-brand-color')
  localStorage.removeItem('agent-webui.explicit-accent')
  document.documentElement.classList.remove('dark')
  for (const name of ['--primary', '--sidebar-primary', '--pydantic-brand'])
    document.documentElement.style.removeProperty(name)
})

it('keeps default action pairs in CSS rather than overwriting dark mode on the root', () => {
  renderHook(() => useThemeColorizer())
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
  expect(document.documentElement.style.getPropertyValue('--ring')).toBe('')
})

it('retains a saved custom hue and safely adapts it when the existing theme changes', async () => {
  localStorage.setItem('pydantic-brand-color', '0.7 0.22 35')
  const { result } = renderHook(() => useThemeColorizer())
  expect(result.current.baseColor).toBe('0.7 0.22 35')
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('oklch(0.47 0.08 35)')
  await act(async () => {
    document.documentElement.classList.add('dark')
  })
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('oklch(0.8 0.08 35)')
  expect(localStorage.getItem('pydantic-brand-color')).toBe('0.7 0.22 35')
})

it('distinguishes an explicit re-selection of the old default hue', () => {
  const { result } = renderHook(() => useThemeColorizer())
  act(() => {
    result.current.setBaseColor('0.52 0.18 260')
  })
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('oklch(0.47 0.08 260)')
  expect(localStorage.getItem('agent-webui.explicit-accent')).toBe('true')
})

it('restores an explicitly selected blue hue after remount and adapts it to dark', async () => {
  const first = renderHook(() => useThemeColorizer())
  act(() => {
    first.result.current.setBaseColor('0.52 0.18 260')
  })
  first.unmount()
  document.documentElement.classList.add('dark')
  const second = renderHook(() => useThemeColorizer())
  expect(second.result.current.baseColor).toBe('0.52 0.18 260')
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('oklch(0.8 0.08 260)')
  await act(async () => {
    document.documentElement.classList.remove('dark')
  })
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('oklch(0.47 0.08 260)')
})

it('does not change a legacy stored hue or manufacture evidence of an explicit choice', () => {
  localStorage.setItem('pydantic-brand-color', '0.52 0.18 260')
  const { result } = renderHook(() => useThemeColorizer())
  expect(result.current.baseColor).toBe('0.47 0.055 155')
  expect(result.current.accentMode).toBe('default')
  expect(document.documentElement.style.getPropertyValue('--pydantic-brand')).toBe('')
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', 'oklch(0.47 0.055 155)')
  expect(localStorage.getItem('pydantic-brand-color')).toBe('0.52 0.18 260')
  expect(localStorage.getItem('agent-webui.explicit-accent')).toBeNull()
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
})

it('ignores malformed stored colors and keeps local controls working when storage fails', () => {
  localStorage.setItem('pydantic-brand-color', 'not a valid color')
  const first = renderHook(() => useThemeColorizer())
  expect(first.result.current.baseColor).toBe('0.47 0.055 155')
  first.unmount()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied')
  })
  const second = renderHook(() => useThemeColorizer())
  act(() => {
    second.result.current.setBaseColor('0.8 0.1 35')
  })
  expect(second.result.current.baseColor).toBe('0.8 0.1 35')
})

it('keeps action text readable across the full custom hue circle in light and dark', async () => {
  const { result } = renderHook(() => useThemeColorizer())
  for (const dark of [false, true]) {
    await act(async () => {
      document.documentElement.classList.toggle('dark', dark)
    })
    for (let hue = 0; hue < 360; hue += 15) {
      act(() => {
        result.current.setBaseColor(`0.5 0.5 ${hue}`)
      })
      const background = document.documentElement.style.getPropertyValue('--primary')
      expect(contrastRatio(dark ? '#16251a' : '#ffffff', cssColorToHex(background, '#000000'))).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  }
})

// spec: WEBUI-DESIGN-R002.1.1
it('keeps custom action contrast and metadata in sync with system-resolved light and dark', async () => {
  let change = () => undefined
  const media = {
    matches: false,
    addEventListener: (_type: string, listener: () => undefined) => {
      change = listener
    },
    removeEventListener: vi.fn(),
  }
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  localStorage.setItem('pydantic-brand-color', '0.5 0.2 40')
  const { result } = renderHook(() => useTheme(), {
    wrapper: ({ children }) =>
      createElement(ThemeProvider, { defaultTheme: 'system', storageKey: 'system-accent-test', children }),
  })
  expect(result.current.accentMode).toBe('custom')
  for (const dark of [true, false]) {
    await act(async () => {
      media.matches = dark
      change()
    })
    const background = document.documentElement.style.getPropertyValue('--primary')
    expect(document.documentElement).toHaveClass(dark ? 'dark' : 'light')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', background)
    expect(contrastRatio(dark ? '#16251a' : '#ffffff', cssColorToHex(background, '#000000'))).toBeGreaterThanOrEqual(
      4.5,
    )
    expect(localStorage.getItem('pydantic-brand-color')).toBe('0.5 0.2 40')
  }
})
