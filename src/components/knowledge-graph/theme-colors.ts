/**
 * @file theme-colors.ts
 * @description Theme-driven color resolution for the knowledge-graph canvas
 * (GraphCanvas.tsx / GraphAdapter.ts).
 *
 * WHY THIS EXISTS (the reported bug): sigma.js renders nodes/edges/labels
 * onto raw `<canvas>` elements (2D + WebGL layers), which cannot see
 * Tailwind classes or CSS custom properties — every color handed to sigma
 * must already be a concrete `#rrggbb`/`rgb()` string (confirmed against
 * sigma's own color parser, `colorToArray`/`parseColor` in
 * `sigma/dist/colors-*.js`: it recognizes ONLY hex and rgb()/rgba(), never
 * `oklch()`). Node labels defaulted to sigma's built-in `labelColor: {color:
 * "#000"}` (`sigma/settings`), i.e. pure black, drawn over the canvas's
 * previously-hardcoded `bg-slate-900` (a dark navy) — exactly the "black
 * text hard to see on dark blue background" defect reported. This module is
 * the ONE place that bridges the app's real design tokens (`src/index.css`,
 * oklch custom properties toggled by the `.dark` class — see
 * `theme-provider.tsx`) into concrete colors sigma can actually draw, so the
 * graph canvas never drifts from the rest of the UI's theme again.
 *
 * MECHANISM: read each CSS custom property live off
 * `getComputedStyle(document.documentElement)` (so the graph always reflects
 * whatever theme is actually active, including the runtime brand-color hue
 * picker in `use-theme-colorizer.ts`), convert its `oklch(L C H [/ A])`
 * value to sRGB using the standard OKLab<->linear-sRGB matrices from the CSS
 * Color 4 spec, and cache nothing across renders (theme reads are cheap;
 * correctness on every theme toggle matters more). A small FALLBACK table
 * mirrors `src/index.css`'s `:root`/`.dark` blocks for environments where no
 * stylesheet is attached (unit tests under jsdom, first paint before CSS
 * loads) -- update both together if the design tokens change.
 */

import { useEffect, useState } from 'react'

// ── oklch -> sRGB ────────────────────────────────────────────────────────

export interface RGB {
  r: number
  g: number
  b: number
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** Gamma-encode a linear sRGB channel (0..1) per the sRGB transfer function. */
function linearToSrgb(c: number): number {
  const cc = clamp01(c)
  return cc <= 0.0031308 ? 12.92 * cc : 1.055 * Math.pow(cc, 1 / 2.4) - 0.055
}

/**
 * Convert an OKLCH color (L in 0..1, C roughly 0..0.4, H in degrees) to
 * 8-bit sRGB. Matrices are the standard OKLab<->linear-sRGB constants from
 * the CSS Color 4 spec / Björn Ottosson's OKLab reference implementation.
 */
export function oklchToRgb(l: number, c: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b

  const ll = l_ * l_ * l_
  const mm = m_ * m_ * m_
  const ss = s_ * s_ * s_

  const rLin = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss
  const gLin = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss
  const bLin = -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss

  return {
    r: Math.round(clamp01(linearToSrgb(rLin)) * 255),
    g: Math.round(clamp01(linearToSrgb(gLin)) * 255),
    b: Math.round(clamp01(linearToSrgb(bLin)) * 255),
  }
}

const toHex2 = (n: number): string => n.toString(16).padStart(2, '0')

export function rgbToHex({ r, g, b }: RGB): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+(-?[\d.]+)\s*(?:\/\s*[\d.%]+\s*)?\)$/i

/** Parse a CSS `oklch(L C H)` (optionally `/ alpha`) string into components. */
export function parseOklch(value: string): { l: number; c: number; h: number } | null {
  const match = OKLCH_RE.exec(value.trim())
  if (!match) return null
  const l = Number(match[1])
  const c = Number(match[2])
  const h = Number(match[3])
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) return null
  return { l, c, h }
}

const HEX_RE = /^#[0-9a-f]{3,8}$/i
const RGB_RE = /^rgba?\(/i

/**
 * Resolve ANY CSS color string this codebase's tokens use (`oklch(...)`,
 * `#hex`, `rgb()`) to a concrete `#rrggbb` sigma can draw. Unknown/unparsable
 * input degrades to `fallbackHex` rather than throwing — a graph canvas must
 * never crash because a theme string was unexpected.
 */
export function cssColorToHex(value: string, fallbackHex: string): string {
  const trimmed = value.trim()
  if (!trimmed) return fallbackHex
  if (HEX_RE.test(trimmed)) {
    return trimmed.length === 4
      ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
      : trimmed.slice(0, 7)
  }
  const oklch = parseOklch(trimmed)
  if (oklch) return rgbToHex(oklchToRgb(oklch.l, oklch.c, oklch.h))
  if (RGB_RE.test(trimmed)) {
    const nums = trimmed.match(/[\d.]+/g)
    if (nums && nums.length >= 3) {
      return rgbToHex({
        r: Math.round(Number(nums[0])),
        g: Math.round(Number(nums[1])),
        b: Math.round(Number(nums[2])),
      })
    }
  }
  return fallbackHex
}

// ── WCAG contrast ────────────────────────────────────────────────────────

function srgbToLinearChannel(c8: number): number {
  const c = c8 / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of a `#rrggbb` color, in [0, 1]. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  return (
    0.2126 * srgbToLinearChannel(rgb.r) + 0.7152 * srgbToLinearChannel(rgb.g) + 0.0722 * srgbToLinearChannel(rgb.b)
  )
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const int = parseInt(m[1], 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

/** WCAG contrast ratio between two `#rrggbb` colors, in [1, 21]. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Pick whichever of two candidate text colors has the higher contrast ratio
 * against `backgroundHex` — this is the per-node "choose from the fill's
 * luminance" mechanism the task calls for. Defaults to near-white / near-black
 * (not pure #fff/#000, to avoid harsh clipping) when no candidates are given.
 */
export function pickReadableTextColor(
  backgroundHex: string,
  lightCandidate = '#f8fafc',
  darkCandidate = '#0b1220',
): string {
  const contrastWithLight = contrastRatio(backgroundHex, lightCandidate)
  const contrastWithDark = contrastRatio(backgroundHex, darkCandidate)
  return contrastWithLight >= contrastWithDark ? lightCandidate : darkCandidate
}

// ── Theme token resolution ──────────────────────────────────────────────

export interface ThemeTokens {
  background: string
  foreground: string
  card: string
  cardForeground: string
  mutedForeground: string
  border: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
}

// Mirrors src/index.css's `:root` / `.dark` blocks. Used ONLY when a live
// stylesheet isn't attached (jsdom unit tests, SSR, first paint) — keep in
// sync with index.css if those tokens change.
const FALLBACK_LIGHT: ThemeTokens = {
  background: 'oklch(0.988 0.002 280)',
  foreground: 'oklch(0.145 0.012 265)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.145 0.012 265)',
  mutedForeground: 'oklch(0.50 0.02 280)',
  border: 'oklch(0.91 0.005 280)',
  chart1: 'oklch(0.65 0.22 41)',
  chart2: 'oklch(0.60 0.12 185)',
  chart3: 'oklch(0.40 0.07 227)',
  chart4: 'oklch(0.83 0.19 84)',
  chart5: 'oklch(0.77 0.19 70)',
}

const FALLBACK_DARK: ThemeTokens = {
  background: 'oklch(0.13 0.02 260)',
  foreground: 'oklch(0.96 0.005 260)',
  card: 'oklch(0.17 0.015 260)',
  cardForeground: 'oklch(0.96 0.005 260)',
  mutedForeground: 'oklch(0.64 0.02 260)',
  border: 'oklch(1 0 0 / 8%)',
  chart1: 'oklch(0.49 0.24 264)',
  chart2: 'oklch(0.70 0.17 162)',
  chart3: 'oklch(0.77 0.19 70)',
  chart4: 'oklch(0.63 0.27 304)',
  chart5: 'oklch(0.71 0.15 164)',
}

const CSS_VAR_BY_KEY: Record<keyof ThemeTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  mutedForeground: '--muted-foreground',
  border: '--border',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
}

function resolveCssVar(name: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  try {
    return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  } catch {
    return ''
  }
}

/**
 * Read the live design-system tokens as concrete `#rrggbb` colors, per
 * theme. Reads the real DOM custom properties first (so a user's custom
 * brand hue from `use-theme-colorizer.ts` is respected); falls back to the
 * literal `index.css` values when no stylesheet is attached.
 */
export function readThemeTokens(isDark: boolean): ThemeTokens {
  const fallback = isDark ? FALLBACK_DARK : FALLBACK_LIGHT
  const out = {} as ThemeTokens
  for (const key of Object.keys(CSS_VAR_BY_KEY) as (keyof ThemeTokens)[]) {
    const raw = resolveCssVar(CSS_VAR_BY_KEY[key])
    out[key] = raw || fallback[key]
  }
  return out
}

export interface ResolvedThemeColors {
  background: string
  foreground: string
  card: string
  cardForeground: string
  mutedForeground: string
  border: string
  chart: string[]
}

/** `readThemeTokens` with every value converted from oklch/hex/rgb to `#rrggbb`. */
export function resolveThemeColors(isDark: boolean): ResolvedThemeColors {
  const t = readThemeTokens(isDark)
  const fallbackHex = isDark ? '#0f172a' : '#ffffff'
  const fallbackFg = isDark ? '#f1f5f9' : '#0f172a'
  return {
    background: cssColorToHex(t.background, fallbackHex),
    foreground: cssColorToHex(t.foreground, fallbackFg),
    card: cssColorToHex(t.card, fallbackHex),
    cardForeground: cssColorToHex(t.cardForeground, fallbackFg),
    mutedForeground: cssColorToHex(t.mutedForeground, isDark ? '#94a3b8' : '#64748b'),
    border: cssColorToHex(t.border, isDark ? '#334155' : '#e2e8f0'),
    chart: [t.chart1, t.chart2, t.chart3, t.chart4, t.chart5].map((v) => cssColorToHex(v, fallbackFg)),
  }
}

/** Whether the `.dark` theme class is currently applied to `<html>`. */
export function isDarkModeActive(
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): boolean {
  return doc?.documentElement.classList.contains('dark') ?? true
}

// ── node_type -> color ───────────────────────────────────────────────────

/** Stable string hash (FNV-1a) — same input always yields the same hue. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// Explicit hues for the highest-volume / most operationally important node
// types (see the live `GROUP BY node_type` breakdown this was designed
// against), spread around the color wheel for maximum pairwise distinction
// rather than left to the hash fallback. Long-tail types (the other ~39)
// fall through to `hashString`-derived hues below.
// A `Map` (not `Record<string, number>`) on purpose: this project's
// tsconfig doesn't set `noUncheckedIndexedAccess`, so a plain object index
// would type as `number` (never `undefined`) even for a missing key —
// masking exactly the "total for an unknown type" behavior this module
// needs to prove. `Map.get` types correctly as `number | undefined`.
const EXPLICIT_NODE_TYPE_HUES = new Map<string, number>([
  ['RuntimeSignal', 255], // blue-violet
  ['WorkItem', 25], // orange
  ['Concept', 155], // green
  ['WorkflowStep', 205], // cyan-blue
  ['WorkflowDefinition', 300], // magenta
  ['MCPServer', 60], // yellow
  ['CallableResource', 340], // rose
  // Legacy/general-KG labels this adapter already supported.
  ['Job', 220],
  ['Log', 140],
  ['Memory', 275],
  ['KnowledgeBase', 35],
  ['Article', 50],
  ['KBConcept', 320],
  ['KBFact', 190],
  ['Prompt', 245],
  ['Tool', 5],
  ['User', 165],
  ['Client', 150],
  ['Heartbeat', 350],
  ['Message', 265],
  ['Code', 210],
  ['DatabaseTable', 40],
  ['DatabaseColumn', 45],
  ['DatabaseView', 30],
  ['interface', 210],
  ['object_type', 145],
])

/** Types with an explicit hue above are drawn at full chroma; the hashed
 * long tail is drawn slightly desaturated so it visually reads as "many
 * minor types" rather than competing for attention with the volume leaders
 * — a second (non-hue) channel for colour-vision-deficient readers. */
const EXPLICIT_CHROMA = { light: 0.15, dark: 0.16 }
const HASHED_CHROMA = { light: 0.1, dark: 0.11 }
const LIGHTNESS = { light: 0.5, dark: 0.72 }

/**
 * Deterministic, total node_type -> color mapping. Same type always yields
 * the same color (same session, same browser, same user — and across users,
 * since the hash and explicit table are pure functions of the type string).
 * An unknown/missing type still returns a legible, theme-appropriate color
 * (hash fallback), never throws, never renders invisible.
 */
export function nodeTypeColor(nodeType: string, isDark: boolean): string {
  const type = nodeType || 'Unknown'
  const explicitHue = EXPLICIT_NODE_TYPE_HUES.get(type)
  const hue = explicitHue ?? hashString(type) % 360
  const chroma = explicitHue !== undefined ? EXPLICIT_CHROMA : HASHED_CHROMA
  const c = isDark ? chroma.dark : chroma.light
  const l = isDark ? LIGHTNESS.dark : LIGHTNESS.light
  return rgbToHex(oklchToRgb(l, c, hue))
}

/** Whether `nodeType` has a hand-picked (vs. hashed long-tail) color. */
export function hasExplicitNodeTypeColor(nodeType: string): boolean {
  return EXPLICIT_NODE_TYPE_HUES.has(nodeType)
}

// ── React: live theme tracking ──────────────────────────────────────────

/**
 * Tracks whether the `.dark` class is applied to `<html>`, so canvas colors
 * can be recomputed the moment the user (or `ThemeProvider`) toggles theme —
 * required by the "read from resolved theme tokens... re-read when the theme
 * changes" contract, since sigma's canvases don't repaint themselves off CSS.
 * Subscribes via `MutationObserver` on the root element's `class` attribute
 * rather than depending on `ThemeProvider`'s React context, so this stays
 * usable from any canvas code without adding a context dependency across
 * lane boundaries.
 */
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => isDarkModeActive())

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const root = document.documentElement
    const update = () => {
      setIsDark(isDarkModeActive())
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => {
      observer.disconnect()
    }
  }, [])

  return isDark
}
