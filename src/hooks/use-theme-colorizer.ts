import { useState, useEffect } from 'react'

const DEFAULT_BASE_COLOR = '0.52 0.18 260'
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

/**
 * Hook to dynamically change the theme's brand and primary colors at runtime.
 * We store the user's preferred hue and chroma, and apply them to the :root variables
 * ensuring both light and dark modes adapt seamlessly.
 */
export function useThemeColorizer(defaultBaseColor = DEFAULT_BASE_COLOR) {
  const fallbackColor = normalizeBaseColor(defaultBaseColor) ?? DEFAULT_BASE_COLOR
  const [baseColor, setStoredBaseColor] = useState<string>(() => {
    return normalizeBaseColor(localStorage.getItem('pydantic-brand-color') ?? '') ?? fallbackColor
  })
  const setBaseColor = (color: string) => {
    setStoredBaseColor(normalizeBaseColor(color) ?? fallbackColor)
  }

  useEffect(() => {
    localStorage.setItem('pydantic-brand-color', baseColor)

    // Parse the base OKLCH string (e.g., "0.52 0.18 260")
    // We can assume it's valid for now or fallback to default
    const [l, c, h] = baseColor.split(' ')

    const root = document.documentElement

    if (!l || !c || !h) return

    // Apply primary brand colors
    root.style.setProperty('--pydantic-brand', `oklch(${baseColor})`)

    // Light mode dynamic adjustments
    // We adjust primary to be similar to brand
    root.style.setProperty('--primary', `oklch(${baseColor})`)
    root.style.setProperty('--sidebar-primary', `oklch(${baseColor})`)
    root.style.setProperty('--ring', `oklch(${baseColor})`)
    root.style.setProperty('--sidebar-ring', `oklch(${baseColor})`)

    // Dark mode often needs a slightly lighter/more vibrant primary for contrast.
    // However, since we're using CSS custom properties globally, if we set them on :root
    // they apply everywhere. To do dark mode specifically, we might need a <style> tag or
    // rely on the fact that Tailwind uses these variables inside .dark selectors if we inject there.

    // Generate an SVG data URI using the brand color for dynamic favicons
    const svgColor = `oklch(${baseColor})`
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
  }, [baseColor])

  return { baseColor, setBaseColor }
}
