// spec: WEBUI-DESIGN-R002.1.1
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ThemeProvider } from '@/components/theme-provider'
import { WorkspaceAppearance } from '@/components/workspace/WorkspaceAppearance'
import { contrastRatio, cssColorToHex } from '@/components/knowledge-graph/theme-colors'
import { derivePaletteTokens, PALETTE_PRESETS } from '@/lib/theme-palette'
import { useThemeColorizer } from '../use-theme-colorizer'

function composite(color: string, alpha: number, backdrop: number) {
  const hex = cssColorToHex(color, '#ff0000').slice(1)
  return (
    '#' +
    [0, 2, 4]
      .map((offset) =>
        Math.round(parseInt(hex.slice(offset, offset + 2), 16) * alpha + backdrop * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-palette')
  document.documentElement.className = ''
})

it.each(PALETTE_PRESETS)('$name derived states retain text and focus contrast in both schemes', ({ color }) => {
  for (const dark of [false, true]) {
    const tokens = derivePaletteTokens(color, dark)
    for (const state of ['primary', 'primary-hover', 'primary-active'] as const) {
      for (const backdrop of [0, 255]) {
        expect(
          contrastRatio(
            dark ? '#16251a' : '#ffffff',
            composite(tokens[state], state === 'primary' ? 0.96 : state === 'primary-hover' ? 0.98 : 1, backdrop),
          ),
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
    for (const [state, alpha] of [
      ['neutral', dark ? 0.88 : 0.64],
      ['neutral-hover', dark ? 0.92 : 0.78],
      ['neutral-active', dark ? 0.96 : 0.84],
    ] as const) {
      for (const backdrop of [0, 255]) {
        expect(
          contrastRatio(dark ? '#f1f5eb' : '#111111', composite(tokens[state], alpha, backdrop)),
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrastRatio(dark ? '#1c2a22' : '#f7f8f2', cssColorToHex(tokens.focus, '#ff0000'))).toBeGreaterThanOrEqual(
      3,
    )
  }
})

it('replaces every derived token on repeated selection and restores the exact green baseline', () => {
  const { result } = renderHook(() => useThemeColorizer())
  const root = document.documentElement
  for (const preset of PALETTE_PRESETS.slice(1)) {
    act(() => {
      result.current.setBaseColor(preset.color)
    })
    expect(root.dataset.palette).toBe('custom')
    expect(root.style.getPropertyValue('--palette-neutral')).toBe(derivePaletteTokens(preset.color, false).neutral)
    for (const semantic of ['--destructive', '--status-warning', '--status-success', '--status-danger-surface'])
      expect(root.style.getPropertyValue(semantic)).toBe('')
  }
  act(() => {
    result.current.setBaseColor(PALETTE_PRESETS[0].color)
  })
  expect(root.dataset.palette).toBeUndefined()
  expect(root.style.getPropertyValue('--primary')).toBe('')
  expect(root.style.getPropertyValue('--palette-neutral')).toBe('')
})

it('exposes named choices only in Settings and restores a selected palette after remount', () => {
  const first = render(
    <ThemeProvider>
      <WorkspaceAppearance />
    </ThemeProvider>,
  )
  const palette = screen.getByLabelText('Palette')
  expect(palette.querySelectorAll('option')).toHaveLength(7)
  fireEvent.change(palette, { target: { value: PALETTE_PRESETS[4].color } })
  expect(localStorage.getItem('pydantic-brand-color')).toBe(PALETTE_PRESETS[4].color)
  first.unmount()
  render(
    <ThemeProvider>
      <WorkspaceAppearance />
    </ThemeProvider>,
  )
  expect(screen.getByLabelText('Palette')).toHaveValue(PALETTE_PRESETS[4].color)
})
