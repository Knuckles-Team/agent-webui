/**
 * @file design-tokens.test.ts
 * @description Token audit for DS-01 (docs/design-system.md). Confirms the
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

/** Pull the flat `--name: value;` declarations out of one top-level selector block. */
function readThemeBlock(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
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
  '--background': { light: 'oklch(0.988 0.002 280)', dark: 'oklch(0.13 0.02 260)' },
  '--foreground': { light: 'oklch(0.145 0.012 265)', dark: 'oklch(0.96 0.005 260)' },
  '--primary': { light: 'oklch(0.52 0.16 260)', dark: 'oklch(0.62 0.16 260)' },
  '--primary-foreground': { light: 'oklch(0.98 0.005 260)', dark: 'oklch(0.10 0.015 260)' },
  '--secondary': { light: 'oklch(0.96 0.004 280)', dark: 'oklch(0.22 0.015 260)' },
  '--secondary-foreground': { light: 'oklch(0.22 0.01 280)', dark: 'oklch(0.96 0.005 260)' },
  '--muted-foreground': { light: 'oklch(0.50 0.02 280)', dark: 'oklch(0.64 0.02 260)' },
  '--accent': { light: 'oklch(0.95 0.04 260)', dark: 'oklch(0.20 0.04 260)' },
  '--accent-foreground': { light: 'oklch(0.22 0.01 280)', dark: 'oklch(0.96 0.005 260)' },
  '--destructive': { light: 'oklch(0.58 0.24 27)', dark: 'oklch(0.70 0.19 22)' },
  '--ring': { light: 'oklch(0.52 0.16 260)', dark: 'oklch(0.62 0.16 260)' },
}

describe('design-system token audit (DS-01)', () => {
  it.each(Object.entries(DOCUMENTED_COLOR))('%s matches docs/design-system.md in :root and .dark', (name, doc) => {
    expect(LIGHT[name]).toBe(doc.light)
    expect(DARK[name]).toBe(doc.dark)
  })

  // spec: DS-01, DS-02, DS-04, DS-05
  it('defines the one spacing/density primitive (--radius) documented in docs/design-system.md', () => {
    expect(LIGHT['--radius']).toBe('0.625rem')
  })

  it('keeps the global focus-visible outline on the --ring token', () => {
    expect(CSS_SOURCE).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/)
  })

  it('disables nonessential animation and transition motion under prefers-reduced-motion (DS-04)', () => {
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
    { name: 'ring/background (focus indicator)', fg: t('--ring'), bg: t('--background'), target: 3 },
  ]
}

describe.each(['light', 'dark'] as const)('%s theme contrast targets (DS-01)', (theme) => {
  it.each(contrastCases(theme))('$name clears $target:1', ({ fg, bg, target }) => {
    const ratio = contrastRatio(cssColorToHex(fg, '#000000'), cssColorToHex(bg, '#ffffff'))
    expect(ratio).toBeGreaterThanOrEqual(target)
  })
})
