/**
 * @file design-tokens.test.ts
 * @description Token audit for WEBUI-DESIGN-R002 (docs/design-system.md). Confirms the
 * color values documented there still match the live `src/index.css` source
 * and that every documented pairing clears its stated WCAG contrast target,
 * using the same OKLCH-to-sRGB and contrast math the knowledge-graph canvas
 * already relies on (`theme-colors.ts`) rather than a second implementation.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { contrastRatio, cssColorToHex } from '@/components/knowledge-graph/theme-colors'

const CSS_PATH = resolve(import.meta.dirname, '../index.css')
const CSS_SOURCE = readFileSync(CSS_PATH, 'utf-8')
const DOC_SOURCE = readFileSync(resolve(import.meta.dirname, '../../docs/design-system.md'), 'utf-8').toLowerCase()

/** Pull the flat `--name: value;` declarations out of one top-level selector block. */
function readThemeBlock(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css.replace(/\/\*[^]*?\*\//g, ''))
  const tokens: Record<string, string> = {}
  if (!match) return tokens
  for (const declaration of match[1].split(';')) {
    const trimmed = declaration.trim()
    const colonIndex = trimmed.indexOf(':')
    if (!trimmed.startsWith('--') || colonIndex === -1) continue
    tokens[trimmed.slice(0, colonIndex).trim()] = trimmed.slice(colonIndex + 1).trim()
  }
  return tokens
}

const LIGHT = readThemeBlock(CSS_SOURCE, ':root')
const DARK = readThemeBlock(CSS_SOURCE, '.dark')

// Mirrors the "Color tokens" table in docs/design-system.md. A change to
// either this table or index.css without updating the other fails here.
const DOCUMENTED_COLOR: Record<string, { light: string; dark: string }> = {
  '--background': { light: '#E9EDE5', dark: '#121C17' },
  '--foreground': { light: '#1F2A24', dark: '#F1F5EB' },
  '--card': { light: '#F7F8F2', dark: '#1C2A22' },
  '--primary': { light: '#3E634F', dark: '#ADC99F' },
  '--primary-foreground': { light: '#FFFFFF', dark: '#16251A' },
  '--secondary': { light: '#E6EBE1', dark: '#16231C' },
  '--secondary-foreground': { light: '#46544A', dark: '#D0DBCB' },
  '--muted-foreground': { light: '#59665C', dark: '#AABAA5' },
  '--accent': { light: '#DDE9D8', dark: '#314A35' },
  '--accent-foreground': { light: '#274C36', dark: '#E4EEDC' },
  '--destructive': { light: '#963F37', dark: '#F0B0A6' },
  '--destructive-foreground': { light: '#FFFFFF', dark: '#381914' },
  '--ring': { light: '#245F70', dark: '#9ACFE1' },
  '--input': { light: '#738170', dark: '#829680' },
}

describe('design-system token audit (WEBUI-DESIGN-R002)', () => {
  // spec: WEBUI-DESIGN-R002
  it.each(Object.entries(DOCUMENTED_COLOR))('%s matches docs/design-system.md in :root and .dark', (name, doc) => {
    expect(DOC_SOURCE).toContain(doc.light.toLowerCase())
    expect(DOC_SOURCE).toContain(doc.dark.toLowerCase())
    expect(LIGHT[name].toLowerCase()).toBe(doc.light.toLowerCase())
    expect(DARK[name].toLowerCase()).toBe(doc.dark.toLowerCase())
  })

  it('defines the shared radius and readable metadata floor', () => {
    expect(LIGHT['--radius']).toBe('0.75rem')
    expect(CSS_SOURCE).toContain('--text-tiny: 0.75rem;')
  })

  it('keeps the global focus-visible outline on the --ring token', () => {
    expect(CSS_SOURCE).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/)
  })

  // spec: WEBUI-DESIGN-R005
  it('disables nonessential animation and transition motion under prefers-reduced-motion (WEBUI-DESIGN-R005)', () => {
    const reduceBlock = /@media \(prefers-reduced-motion: reduce\)\s*\{([^]*?)\n\}/.exec(CSS_SOURCE)
    expect(reduceBlock).not.toBeNull()
    expect(reduceBlock?.[1]).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
    expect(reduceBlock?.[1]).toMatch(/transition-duration:\s*0\.01ms\s*!important/)
  })
})

interface ContrastCase {
  name: string
  fg: string
  bg: string
  target: number
}

function contrastCases(theme: 'light' | 'dark'): ContrastCase[] {
  const t = (name: string) => DOCUMENTED_COLOR[name][theme]
  return [
    { name: 'foreground/background', fg: t('--foreground'), bg: t('--background'), target: 4.5 },
    { name: 'primary-foreground/primary', fg: t('--primary-foreground'), bg: t('--primary'), target: 4.5 },
    { name: 'secondary-foreground/secondary', fg: t('--secondary-foreground'), bg: t('--secondary'), target: 4.5 },
    { name: 'muted-foreground/background', fg: t('--muted-foreground'), bg: t('--background'), target: 4.5 },
    { name: 'accent-foreground/accent', fg: t('--accent-foreground'), bg: t('--accent'), target: 4.5 },
    { name: 'destructive/background', fg: t('--destructive'), bg: t('--background'), target: 4.5 },
    {
      name: 'destructive-foreground/destructive',
      fg: t('--destructive-foreground'),
      bg: t('--destructive'),
      target: 4.5,
    },
    { name: 'muted/card', fg: t('--muted-foreground'), bg: t('--card'), target: 4.5 },
    { name: 'muted/selection', fg: t('--muted-foreground'), bg: t('--accent'), target: 4.5 },
    { name: 'input/card', fg: t('--input'), bg: t('--card'), target: 3 },
    { name: 'ring/background (focus indicator)', fg: t('--ring'), bg: t('--background'), target: 3 },
  ]
}

describe.each(['light', 'dark'] as const)('%s theme contrast targets (WEBUI-DESIGN-R002)', (theme) => {
  // spec: WEBUI-DESIGN-R002
  it.each(contrastCases(theme))('$name clears $target:1', ({ fg, bg, target }) => {
    const ratio = contrastRatio(cssColorToHex(fg, '#000000'), cssColorToHex(bg, '#ffffff'))
    expect(ratio).toBeGreaterThanOrEqual(target)
  })
})

// spec: WEBUI-DESIGN-R002.1.1
it.each(['light', 'dark'] as const)('protects %s shell labels even over black and white backdrops', (theme) => {
  const tokens = theme === 'dark' ? DARK : LIGHT
  const alpha = Number.parseFloat(tokens['--shell-alpha']) / 100
  expect(alpha).toBeGreaterThanOrEqual(0.9)
  for (const backdrop of [0, 255]) {
    const surface = tokens['--card']
      .slice(1)
      .match(/../g)!
      .map((channel) => parseInt(channel, 16))
    const composite =
      '#' +
      surface
        .map((channel) =>
          Math.round(channel * alpha + backdrop * (1 - alpha))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    for (const text of ['--foreground', '--muted-foreground'])
      expect(contrastRatio(tokens[text], composite)).toBeGreaterThanOrEqual(4.5)
  }
})

it('uses the same solid reading palette for glass instead of alpha text surfaces', () => {
  const glass = readThemeBlock(CSS_SOURCE, '.glass')
  expect(glass['--shell-alpha']).toBe('92%')
  expect(glass['--card']).toBeUndefined()
  expect(glass['--background']).toBeUndefined()
  expect(CSS_SOURCE).not.toContain('.glass body')
})

// spec: WEBUI-DESIGN-R002.1.1
it.each(['components/AuthModeBanner.tsx', 'components/ui/badge.tsx', 'components/views/SchedulingView.tsx'])(
  '%s pairs semantic action fills with their matching foreground',
  (path) => {
    const source = readFileSync(resolve(import.meta.dirname, '..', path), 'utf-8')
    expect(source).not.toMatch(/bg-(?:primary|destructive)(?![\w/-])[^"'`\n]*text-white/)
    expect(source).toMatch(/text-(?:primary|destructive)-foreground/)
  },
)

function compositeHex(foreground: string, background: string, alpha: number) {
  const channels = (hex: string) =>
    hex
      .slice(1)
      .match(/../g)!
      .map((channel) => parseInt(channel, 16))
  const back = channels(background)
  return (
    '#' +
    channels(foreground)
      .map((channel, index) =>
        Math.round(channel * alpha + back[index] * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

// spec: WEBUI-DESIGN-R002.1.1
it.each(['light', 'dark'] as const)('keeps %s semantic fill text readable at rest, hover and disabled', (theme) => {
  const tokens = theme === 'dark' ? DARK : LIGHT
  for (const fill of ['primary', 'destructive']) {
    for (const backdrop of ['--background', '--card', '--surface-raised', '--accent']) {
      for (const alpha of [1, 0.9]) {
        const background = compositeHex(tokens[`--${fill}`], tokens[backdrop], alpha)
        expect(contrastRatio(tokens[`--${fill}-foreground`], background)).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
  expect(contrastRatio(tokens['--muted-foreground'], tokens['--muted'])).toBeGreaterThanOrEqual(4.5)
})
