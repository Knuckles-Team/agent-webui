import { describe, it, expect } from 'vitest'
import {
  contrastRatio,
  hasExplicitNodeTypeColor,
  hexToRgb,
  nodeTypeColor,
  oklchToRgb,
  pickReadableTextColor,
  relativeLuminance,
  resolveThemeColors,
  rgbToHex,
} from '@/components/knowledge-graph/theme-colors'

// This is the regression guard for the reported bug ("black text hard to see
// on dark blue background"): a programmatic WCAG contrast assertion, not a
// screenshot — so it fails loudly the moment a future change lets a label
// color drift back under the 4.5:1 AA floor, in EITHER theme.
describe('theme-colors — WCAG AA contrast (the actual regression guard)', () => {
  it.each([
    ['dark', true],
    ['light', false],
  ] as const)('node label vs. canvas background meets 4.5:1 in %s mode', (_name, isDark) => {
    const theme = resolveThemeColors(isDark)
    const labelColor = pickReadableTextColor(theme.card)
    const ratio = contrastRatio(labelColor, theme.card)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['dark', true],
    ['light', false],
  ] as const)('edge/edge-label color vs. canvas background meets 4.5:1 in %s mode', (_name, isDark) => {
    const theme = resolveThemeColors(isDark)
    const ratio = contrastRatio(theme.mutedForeground, theme.card)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('pure black on pure white is the maximum ratio (~21:1) — sanity check on the math itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeGreaterThan(20)
  })

  it('a color against itself is always 1:1', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
  })

  it('pickReadableTextColor always returns the higher-contrast candidate', () => {
    const onDark = pickReadableTextColor('#0f172a')
    const onLight = pickReadableTextColor('#f8fafc')
    expect(contrastRatio(onDark, '#0f172a')).toBeGreaterThan(contrastRatio(onLight, '#0f172a'))
    expect(contrastRatio(onLight, '#f8fafc')).toBeGreaterThan(contrastRatio(onDark, '#f8fafc'))
  })
})

describe('theme-colors — oklch -> sRGB conversion', () => {
  it('converts near-black and near-white oklch endpoints correctly', () => {
    expect(rgbToHex(oklchToRgb(0, 0, 0))).toBe('#000000')
    expect(rgbToHex(oklchToRgb(1, 0, 0))).toBe('#ffffff')
  })

  it('round-trips through hexToRgb without throwing on a converted value', () => {
    const hex = rgbToHex(oklchToRgb(0.6, 0.15, 260))
    expect(hexToRgb(hex)).not.toBeNull()
    expect(relativeLuminance(hex)).toBeGreaterThanOrEqual(0)
    expect(relativeLuminance(hex)).toBeLessThanOrEqual(1)
  })

  it('hexToRgb rejects malformed input instead of throwing', () => {
    expect(hexToRgb('not-a-color')).toBeNull()
  })
})

describe('theme-colors — resolveThemeColors', () => {
  it('returns distinct light and dark palettes', () => {
    const light = resolveThemeColors(false)
    const dark = resolveThemeColors(true)
    expect(light.card).not.toBe(dark.card)
    expect(light.card.startsWith('#')).toBe(true)
    expect(dark.card.startsWith('#')).toBe(true)
  })

  it('dark mode background is darker than light mode background', () => {
    const light = resolveThemeColors(false)
    const dark = resolveThemeColors(true)
    expect(relativeLuminance(dark.background)).toBeLessThan(relativeLuminance(light.background))
  })
})

// TEST REQUIREMENT: "The type→colour mapping is deterministic (same input →
// same colour) and total (an unknown/missing node_type still yields a
// readable, legible colour rather than crashing or rendering invisible
// text)."
describe('theme-colors — nodeTypeColor (deterministic + total)', () => {
  it('is deterministic: the same type always yields the same color, in the same theme', () => {
    expect(nodeTypeColor('RuntimeSignal', true)).toBe(nodeTypeColor('RuntimeSignal', true))
    expect(nodeTypeColor('WorkItem', false)).toBe(nodeTypeColor('WorkItem', false))
    // Also stable across repeated calls with a long-tail (hashed) type.
    expect(nodeTypeColor('SomeFutureNodeType', true)).toBe(nodeTypeColor('SomeFutureNodeType', true))
  })

  it('is total: an empty/unknown node_type still returns a valid, non-crashing color', () => {
    expect(() => nodeTypeColor('', true)).not.toThrow()
    expect(() => nodeTypeColor('TotallyMadeUpType', false)).not.toThrow()
    expect(nodeTypeColor('', true)).toMatch(/^#[0-9a-f]{6}$/i)
    expect(nodeTypeColor('TotallyMadeUpType', false)).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('yields a color with non-trivial contrast against the canvas background (not invisible)', () => {
    for (const type of ['RuntimeSignal', 'WorkItem', 'Concept', 'AnUnknownLongTailType']) {
      for (const isDark of [true, false]) {
        const theme = resolveThemeColors(isDark)
        const color = nodeTypeColor(type, isDark)
        // Node fills aren't required to hit the 4.5:1 TEXT threshold, but
        // must not be lost against the background (a bare minimum
        // distinguishability floor).
        expect(contrastRatio(color, theme.card)).toBeGreaterThan(1.2)
      }
    }
  })

  it('adapts lightness/saturation per theme rather than reusing one fixed palette', () => {
    const darkColor = nodeTypeColor('RuntimeSignal', true)
    const lightColor = nodeTypeColor('RuntimeSignal', false)
    expect(darkColor).not.toBe(lightColor)
  })

  it('the highest-volume production types have hand-picked (non-hashed) colors', () => {
    for (const type of [
      'RuntimeSignal',
      'WorkItem',
      'Concept',
      'WorkflowStep',
      'WorkflowDefinition',
      'MCPServer',
      'CallableResource',
    ]) {
      expect(hasExplicitNodeTypeColor(type)).toBe(true)
    }
  })

  it('long-tail / unrecognized types fall back to the hash, not an explicit entry', () => {
    expect(hasExplicitNodeTypeColor('SomeFutureNodeType')).toBe(false)
  })

  it('distinct known types get visually distinct colors (spot check)', () => {
    const colors = new Set(
      [
        'RuntimeSignal',
        'WorkItem',
        'Concept',
        'WorkflowStep',
        'WorkflowDefinition',
        'MCPServer',
        'CallableResource',
      ].map((t) => nodeTypeColor(t, true)),
    )
    expect(colors.size).toBe(7)
  })
})
