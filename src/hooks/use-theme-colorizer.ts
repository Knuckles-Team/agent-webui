import { useState, useLayoutEffect } from 'react'
import { derivePaletteTokens } from '@/lib/theme-palette'

const DEFAULT_BASE_COLOR = '0.47 0.055 155'
const DECIMAL_COMPONENT = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/

/** True when `lightness`/`chroma`/`hue` are each finite and within OKLCH's valid range. */
function isValidOklchTriple(lightness: number, chroma: number, hue: number): boolean {
  return (
    Number.isFinite(lightness) &&
    Number.isFinite(chroma) &&
    Number.isFinite(hue) &&
    lightness >= 0 &&
    lightness <= 1 &&
    chroma >= 0 &&
    chroma <= 0.5 &&
    hue >= -360 &&
    hue <= 360
  )
}

/** Accept only three finite OKLCH numeric components from local persistence. */
export function normalizeBaseColor(value: string): string | null {
  const components = value.trim().split(/\s+/)
  if (components.length !== 3 || components.some((component) => !DECIMAL_COMPONENT.test(component))) return null

  const [lightness, chroma, hue] = components.map(Number)
  if (!isValidOklchTriple(lightness, chroma, hue)) return null
  return `${lightness} ${chroma} ${hue}`
}

function storedColor(fallback: string) {
  try {
    return normalizeBaseColor(localStorage.getItem('pydantic-brand-color') ?? '') ?? fallback
  } catch {
    return fallback
  }
}
function hasExplicitAccent() {
  try {
    return localStorage.getItem('overstory.explicit-accent') === 'true'
  } catch {
    return false
  }
}
function saveAccent(baseColor: string, explicitChoice: boolean) {
  try {
    localStorage.setItem('pydantic-brand-color', baseColor)
    if (explicitChoice) localStorage.setItem('overstory.explicit-accent', 'true')
  } catch {
    /* Appearance remains usable without storage. */
  }
}
function isCustomAccent(baseColor: string, explicitChoice: boolean) {
  // Historical blue was automatically persisted, so its provenance is ambiguous.
  // Preserve its raw value while migrating defaults. An explicit choice wins.
  return explicitChoice || (baseColor !== DEFAULT_BASE_COLOR && baseColor !== '0.52 0.18 260')
}
function applyActionAccent(root: HTMLElement, baseColor: string, custom: boolean) {
  // Selecting green retires every derived override and restores the accepted baseline.
  custom = custom && baseColor !== DEFAULT_BASE_COLOR
  const tokens = derivePaletteTokens(baseColor, root.classList.contains('dark'))
  const color = tokens.primary
  if (custom) root.dataset.palette = 'custom'
  else delete root.dataset.palette
  for (const [name, value] of Object.entries(tokens)) {
    if (custom) root.style.setProperty(`--palette-${name}`, value)
    else root.style.removeProperty(`--palette-${name}`)
  }
  for (const property of ['--primary', '--sidebar-primary']) {
    if (custom) root.style.setProperty(property, color)
    else root.style.removeProperty(property)
  }
  // This alias resolves from the same effective semantic action, never the raw legacy value.
  root.style.removeProperty('--pydantic-brand')
  return custom ? color : getComputedStyle(root).getPropertyValue('--primary').trim() || color
}
function updateBrandMetadata(svgColor: string) {
  // Generate an SVG data URI using the brand color for dynamic favicons
  const svgContent = `
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>
    <path d='M16 4L16 22L6 22Z' fill='${svgColor}'/>
    <path d='M16 8L16 22L24 22Z' fill='${svgColor}' opacity='0.6'/>
    <path d='M4 24Q10 20 16 24Q22 28 28 24' stroke='${svgColor}' stroke-width='2.5' fill='none' stroke-linecap='round'/>
  </svg>
`.trim()

  const dataUri = `data:image/svg+xml,${encodeURIComponent(svgContent)}`

  // Find existing favicon link or create a new one
  let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = dataUri

  // Update theme-color meta tag for PWA consistency
  let metaTheme: HTMLMetaElement | null = document.querySelector("meta[name='theme-color']")
  if (!metaTheme) {
    metaTheme = document.createElement('meta')
    metaTheme.name = 'theme-color'
    document.head.appendChild(metaTheme)
  }
  // Note: theme-color expects a hex, rgb, or hsl, but modern browsers often support oklch here too.
  metaTheme.content = svgColor
}

/** Keep stored custom hues while preserving the selected theme's readable action pairs. */
export function useThemeColorizer(defaultBaseColor = DEFAULT_BASE_COLOR) {
  const fallbackColor = normalizeBaseColor(defaultBaseColor) ?? DEFAULT_BASE_COLOR
  const [storedBaseColor, setStoredBaseColor] = useState(() => storedColor(fallbackColor))
  const [explicitChoice, setExplicitChoice] = useState(hasExplicitAccent)
  const custom = isCustomAccent(storedBaseColor, explicitChoice)
  const baseColor = custom ? storedBaseColor : DEFAULT_BASE_COLOR
  const setBaseColor = (color: string) => {
    setExplicitChoice(true)
    setStoredBaseColor(normalizeBaseColor(color) ?? fallbackColor)
  }
  useLayoutEffect(() => {
    saveAccent(storedBaseColor, explicitChoice)
    const root = document.documentElement
    const apply = () => {
      updateBrandMetadata(applyActionAccent(root, baseColor, custom))
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => {
      observer.disconnect()
    }
  }, [baseColor, storedBaseColor, explicitChoice, custom])
  return { baseColor, accentMode: custom ? ('custom' as const) : ('default' as const), setBaseColor }
}
