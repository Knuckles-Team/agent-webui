import { useEffect, useRef } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import { PALETTE_PRESETS } from '@/lib/theme-palette'
import { PrivacyConsentSettings } from '@/components/ConsentBanner'

/** Local settings for every workspace role; accessibility reductions always win. */
export function WorkspaceAppearance() {
  const appearance = useTheme()
  const details = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = details.current
    function close(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !element?.open) return
      event.preventDefault()
      element.open = false
      summary.current?.focus()
    }
    element?.addEventListener('keydown', close)
    return () => {
      element?.removeEventListener('keydown', close)
    }
  }, [])
  return (
    <details ref={details} className="workspace-appearance">
      <summary ref={summary}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        Settings
      </summary>
      <div className="workspace-appearance-options">
        <label>
          Theme
          <select
            value={appearance.theme === 'glass' ? 'light' : appearance.theme}
            onChange={(event) => {
              appearance.setTheme(event.target.value as typeof appearance.theme)
            }}
          >
            <option value="system">System</option>
            <option value="light">Canopy light</option>
            <option value="dark">Canopy dark</option>
          </select>
        </label>
        <label>
          Palette
          <select
            value={appearance.baseColor}
            onChange={(event) => {
              appearance.setBaseColor(event.target.value)
            }}
          >
            {PALETTE_PRESETS.map((palette) => (
              <option key={palette.name} value={palette.color}>
                {palette.name}
              </option>
            ))}
            {!PALETTE_PRESETS.some((palette) => palette.color === appearance.baseColor) && (
              <option value={appearance.baseColor}>Custom</option>
            )}
          </select>
        </label>
        <label>
          Density
          <select
            value={appearance.density}
            onChange={(event) => {
              appearance.setDensity(event.target.value as typeof appearance.density)
            }}
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </label>
        <label>
          Motion
          <select
            value={appearance.motion}
            onChange={(event) => {
              appearance.setMotion(event.target.value as typeof appearance.motion)
            }}
          >
            <option value="system">Follow system</option>
            <option value="reduce">Reduce motion</option>
          </select>
        </label>
        <label>
          Surfaces
          <select
            value={appearance.transparency}
            onChange={(event) => {
              appearance.setTransparency(event.target.value as typeof appearance.transparency)
            }}
          >
            <option value="glass">Glass framing</option>
            <option value="opaque">Opaque framing</option>
          </select>
        </label>
        <label>
          Wallpaper motion
          <select
            value={appearance.wallpaperMotion}
            onChange={(event) => {
              appearance.setWallpaperMotion(event.target.value as typeof appearance.wallpaperMotion)
            }}
          >
            <option value="off">Off</option>
            <option value="subtle">Subtle</option>
            <option value="expressive">Expressive</option>
          </select>
        </label>
        <label>
          Wallpaper scene
          <select
            value={appearance.wallpaperScene}
            onChange={(event) => {
              appearance.setWallpaperScene(event.target.value as typeof appearance.wallpaperScene)
            }}
          >
            <option value="canopy">Canopy · knowledge</option>
            <option value="tree">Tree · agent harness</option>
            <option value="roots">Roots · source systems</option>
            <option value="fluid">Fluid · workspace light</option>
          </select>
        </label>
        <label>
          Weather preview (manual)
          <select
            value={appearance.wallpaperWeather}
            onChange={(event) => {
              appearance.setWallpaperWeather(event.target.value as typeof appearance.wallpaperWeather)
            }}
          >
            <option value="clear">Clear</option>
            <option value="rain">Rain</option>
            <option value="snow">Snow</option>
            <option value="thunderstorm">Thunderstorm (no flashes)</option>
            <option value="fog">Fog</option>
            <option value="heat">Heat</option>
            <option value="cloudy">Cloudy</option>
          </select>
        </label>
        <p>Decorative scenery, not system activity. Manual weather only; no location or live provider is used.</p>
        <p>System motion and transparency reductions take precedence.</p>
        <div className="col-span-2 min-w-0">
          <PrivacyConsentSettings />
          <a className="mt-2 inline-flex min-h-11 items-center underline" href="/privacy">
            Privacy policy and details
          </a>
        </div>
      </div>
    </details>
  )
}
