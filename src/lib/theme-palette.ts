/** Named choices reuse the existing persisted OKLCH accent, not a second theme store. */
export const PALETTE_PRESETS = [
  { name: 'Green', color: '0.47 0.055 155' },
  { name: 'Blue', color: '0.52 0.18 260' },
  { name: 'Red', color: '0.47 0.08 25' },
  { name: 'Purple', color: '0.47 0.08 300' },
  { name: 'Pink', color: '0.47 0.08 345' },
  { name: 'Orange', color: '0.47 0.08 55' },
  { name: 'Yellow', color: '0.47 0.08 95' },
] as const

/** Bounded action pairs; semantic danger/warning and wallpaper are never recolored. */
export function derivePaletteTokens(baseColor: string, dark: boolean) {
  const [, chroma, hue] = baseColor.split(' ').map(Number)
  const color = (lightness: number, cap = 0.08) => `oklch(${lightness} ${Math.min(chroma, cap)} ${hue})`
  return {
    primary: color(dark ? 0.8 : 0.47),
    'primary-hover': color(dark ? 0.84 : 0.43),
    'primary-active': color(dark ? 0.88 : 0.39),
    neutral: color(dark ? 0.32 : 0.88, 0.035),
    'neutral-hover': color(dark ? 0.35 : 0.85, 0.035),
    'neutral-active': color(dark ? 0.38 : 0.82, 0.035),
    focus: color(dark ? 0.85 : 0.43),
  }
}
