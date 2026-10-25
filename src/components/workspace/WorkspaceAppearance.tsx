import { useEffect, useRef } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
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
