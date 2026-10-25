/**
 * @file design-tokens.test.ts
 * @description Token audit for WEBUI-DESIGN-R002 (docs/design-system.md). Confirms the
 * color values documented there still match the live `src/index.css` source
 * and that every documented pairing clears its stated WCAG contrast target,
 * using the same OKLCH-to-sRGB and contrast math the knowledge-graph canvas
 * already relies on (`theme-colors.ts`) rather than a second implementation.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
  '--foreground': { light: '#111111', dark: '#F1F5EB' },
  '--card': { light: '#F7F8F2', dark: '#1C2A22' },
  '--primary': { light: '#3E634F', dark: '#ADC99F' },
  '--primary-foreground': { light: '#FFFFFF', dark: '#16251A' },
  '--secondary': { light: '#E6EBE1', dark: '#16231C' },
  '--secondary-foreground': { light: '#111111', dark: '#D0DBCB' },
  '--muted-foreground': { light: '#111111', dark: '#AABAA5' },
  '--accent': { light: '#DDE9D8', dark: '#314A35' },
  '--accent-foreground': { light: '#111111', dark: '#E4EEDC' },
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
it.each(['light', 'dark'] as const)('keeps %s glass text readable over the bounded authored field', (theme) => {
  const tokens = theme === 'dark' ? DARK : LIGHT
  for (const material of [
    '--glass-chrome',
    '--glass-secondary',
    '--glass-primary',
    '--glass-reading',
    '--glass-control',
  ]) {
    const values = tokens[material].match(/[\d.]+/g)!.map(Number)
    const color =
      '#' +
      values
        .slice(0, 3)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
    const alpha = values[3] / 100
    expect(alpha).toBeLessThan(1)
    expect(alpha).toBeGreaterThan(0.3)
    // The authored field contains no channel darker than this floor. White is
    // conservative for every luminous spot, including overlapping gradients.
    for (const backdrop of [tokens['--glass-field-floor'], '#ffffff']) {
      const composite = compositeHex(color, backdrop, alpha)
      for (const text of ['--foreground', '--glass-muted'])
        expect(contrastRatio(tokens[text], composite), `${theme} ${material} ${text}`).toBeGreaterThanOrEqual(4.5)
    }
  }
})

it('keeps glass materials separate from semantic tokens and container opacity', () => {
  const glass = readThemeBlock(CSS_SOURCE, '.glass')
  expect(glass['--shell-alpha']).toBe('32%')
  expect(glass['--card']).toBeUndefined()
  expect(glass['--background']).toBeUndefined()
  expect(CSS_SOURCE).not.toContain('.glass body')
  const frame = readFileSync(resolve(import.meta.dirname, '../components/workspace/WorkspaceFrame.css'), 'utf-8')
  const explore = readFileSync(resolve(import.meta.dirname, '../components/workspace/ExploreWorkspace.css'), 'utf-8')
  expect(frame).toContain('background: var(--glass-chrome)')
  expect(frame).toContain('background-blend-mode: lighten')
  expect(frame).toContain('arbora-canopy-wallpaper.webp')
  expect(explore).toContain('background: var(--glass-primary)')
  for (const source of [frame, explore]) {
    expect(source).toContain("[data-transparency='opaque']")
    expect(source).toContain('(prefers-reduced-transparency: reduce)')
    expect(source).toContain('(forced-colors: active)')
    expect(source).toContain('backdrop-filter: none')
    expect(source).not.toContain('opacity: 0.92')
  }
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

// spec: WEBUI-DESIGN-R002.1.1
it('pins the approved palette and requested fifteen-percent glass refinement', () => {
  const approved = {
    '--foreground': '#111111',
    '--glass-muted': '#111111',
    '--glass-chrome': 'rgb(241 246 231 / 38%)',
    '--glass-secondary': 'rgb(218 234 220 / 38%)',
    '--glass-primary': 'rgb(248 250 243 / 48%)',
    '--glass-reading': 'rgb(255 255 250 / 60%)',
    '--glass-control': 'rgb(255 255 252 / 72%)',
    '--glass-edge': 'rgb(255 255 255 / 76%)',
    '--glass-field-floor': '#45685b',
  }
  const refined = new Set([
    '--glass-chrome',
    '--glass-secondary',
    '--glass-primary',
    '--glass-reading',
    '--glass-control',
  ])
  for (const [token, value] of Object.entries(approved)) {
    const current = refined.has(token)
      ? value.replace(/(\d+)%/, (_, alpha: string) => `${Math.round(Number(alpha) * 0.85)}%`)
      : value
    expect(LIGHT[token]).toBe(current)
  }
  const wallpaper = readFileSync(resolve(import.meta.dirname, '../assets/arbora-canopy-wallpaper.webp'))
  expect(createHash('sha256').update(wallpaper).digest('hex')).toBe(
    'df3bfb3775c406c2eacdd8e1fc5c4daf7e86af69b8fcf74d8e9a79153f56544a',
  )
  const frame = readFileSync(resolve(import.meta.dirname, '../components/workspace/WorkspaceFrame.css'), 'utf-8')
  const explore = readFileSync(resolve(import.meta.dirname, '../components/workspace/ExploreWorkspace.css'), 'utf-8')
  expect(frame).toContain('backdrop-filter: blur(16px) saturate(125%)')
  expect(frame).toContain('backdrop-filter: blur(16px) saturate(120%)')
  expect(explore).toContain('backdrop-filter: blur(16px) saturate(115%)')
})

// spec: WEBUI-DESIGN-R002.1.1
it('uses quiet selection and aligned control type without losing keyboard focus', () => {
  const frame = readFileSync(resolve(import.meta.dirname, '../components/workspace/WorkspaceFrame.css'), 'utf-8')
  const explore = readFileSync(resolve(import.meta.dirname, '../components/workspace/ExploreWorkspace.css'), 'utf-8')
  for (const css of [frame, explore]) {
    expect(css).not.toMatch(/inset\s+(?:3px 0|0 -2px 0)\s+var\(--primary\)/)
    expect(css).toContain('font-size: var(--workspace-control-size)')
    expect(css).toContain('line-height: var(--workspace-control-leading)')
  }
  expect(frame).toContain('background: var(--button-neutral-active)')
  expect(frame).toContain('background: var(--button-neutral-hover)')
  expect(frame).toContain('--workspace-control-size: 0.875rem')
  expect(frame).toContain('--workspace-control-leading: 1.25rem')
  expect(frame).toContain('outline: 2px solid var(--workspace-ring)')
  expect(frame).toContain('outline-offset: 3px')
  expect(frame).toContain('forced-colors: active')
  expect(explore).toContain('background: var(--glass-control)')
  expect(explore).toContain('color: var(--primary-foreground)')
})

// spec: WEBUI-DESIGN-R002.1.1
it.each(['light', 'dark'] as const)('keeps %s shared button states translucent and readable', (theme) => {
  const tokens = theme === 'dark' ? DARK : LIGHT
  for (const name of [
    '--button-neutral',
    '--button-neutral-hover',
    '--button-neutral-active',
    '--button-primary',
    '--button-primary-hover',
  ]) {
    const values = tokens[name].match(/[\d.]+/g)!.map(Number)
    const color =
      '#' +
      values
        .slice(0, 3)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
    const alpha = values[3] / 100
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)
    const foreground = name.startsWith('--button-primary')
      ? tokens['--primary-foreground']
      : tokens['--button-neutral-foreground']
    for (const backdrop of [tokens['--glass-field-floor'], '#ffffff'])
      expect(
        contrastRatio(foreground, compositeHex(color, backdrop, alpha)),
        `${theme} ${name}`,
      ).toBeGreaterThanOrEqual(4.5)
  }
  const primitive = readFileSync(resolve(import.meta.dirname, '../components/ui/button.tsx'), 'utf-8')
  expect(primitive).toContain('bg-[var(--button-neutral)]')
  expect(primitive).toContain('border-transparent')
  expect(primitive).toContain('aria-pressed:bg-[var(--button-neutral-active)]')
  expect(primitive).toContain('focus-visible:outline-2')
  expect(primitive).toContain('disabled:bg-muted')
  expect(primitive).toContain('bg-destructive text-destructive-foreground')
})

it('keeps inventoried ordinary workspace actions on the shared button primitive', () => {
  // WEBUI-DESIGN-R002.1.1: includes collapsed task and conversation actions.
  for (const name of [
    'WorkWorkspace',
    'WorkTaskControls',
    'WorkConversationControls',
    'WorkExecutionGraph',
    'OperateWorkspace',
    'OperateCatalogPanel',
    'OperateReadinessPanel',
    'WorkspaceCommands',
    'WorkspaceCommandDestinations',
    'WorkspaceCommandBranches',
  ]) {
    const source = readFileSync(resolve(import.meta.dirname, '../components/workspace', name + '.tsx'), 'utf-8')
    expect(source, name).toContain('workspaceButtonClass')
    expect(source, name).not.toContain("const button = 'min-h-11 rounded border")
    expect(source, name).not.toMatch(/<button\b[^>]*className="min-h-11 rounded border/)
  }
  const primitive = readFileSync(resolve(import.meta.dirname, '../components/ui/button.tsx'), 'utf-8')
  expect(primitive).toContain('ui-button inline-flex')
  expect(primitive).toContain("buttonVariants({ variant: 'destructive' })")
  expect(CSS_SOURCE).toContain('.ui-button:focus-visible')
  expect(CSS_SOURCE).toContain('.ui-button:disabled')
})

// spec: WEBUI-DESIGN-R005.4
it('keeps decorative stacking out of the default glass backdrop ancestry', () => {
  const wallpaper = readFileSync(
    resolve(import.meta.dirname, '../components/workspace/WorkspaceWallpaper.css'),
    'utf-8',
  )
  expect(wallpaper).not.toContain('isolation:')
  expect(wallpaper).toContain(".workspace-frame:has(.workspace-wallpaper[data-active='true'])")
  expect(wallpaper).toContain(".workspace-wallpaper[data-active='false']")
})
