import * as React from 'react'
import { createContext, useContext, useLayoutEffect, useState } from 'react'
import { useThemeColorizer } from '../hooks/use-theme-colorizer'

type Theme = 'dark' | 'light' | 'glass' | 'system'
type Density = 'compact' | 'comfortable'
type Motion = 'system' | 'reduce'
type Transparency = 'glass' | 'opaque'
export type WallpaperMotion = 'off' | 'subtle' | 'expressive'
export type WallpaperScene = 'context' | 'canopy' | 'tree' | 'roots' | 'fluid'
export type WallpaperWeather = 'clear' | 'rain' | 'snow' | 'thunderstorm' | 'fog' | 'heat' | 'cloudy'

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

interface ThemeProviderState {
  wallpaperMotion: WallpaperMotion
  setWallpaperMotion: (value: WallpaperMotion) => void
  wallpaperScene: WallpaperScene
  setWallpaperScene: (value: WallpaperScene) => void
  wallpaperWeather: WallpaperWeather
  setWallpaperWeather: (value: WallpaperWeather) => void
  theme: Theme
  setTheme: (theme: Theme) => void
  baseColor: string
  accentMode: 'default' | 'custom'
  setBaseColor: (color: string) => void
  density: Density
  setDensity: (density: Density) => void
  motion: Motion
  setMotion: (motion: Motion) => void
  transparency: Transparency
  setTransparency: (transparency: Transparency) => void
}

const initialState: ThemeProviderState = {
  wallpaperMotion: 'subtle',
  setWallpaperMotion: () => undefined,
  wallpaperScene: 'canopy',
  setWallpaperScene: () => undefined,
  wallpaperWeather: 'clear',
  setWallpaperWeather: () => undefined,
  theme: 'system',
  setTheme: () => undefined,
  baseColor: '0.47 0.055 155',
  accentMode: 'default',
  setBaseColor: () => undefined,
  density: 'compact',
  setDensity: () => undefined,
  motion: 'system',
  setMotion: () => undefined,
  transparency: 'glass',
  setTransparency: () => undefined,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function usePreference<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, update] = useState<T>(() => readPreference(key, allowed, fallback))
  function set(next: T) {
    update(next)
    try {
      window.localStorage.setItem(key, next)
    } catch {
      // Appearance remains usable when browser persistence is unavailable.
    }
  }
  return [value, set] as const
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = usePreference<Theme>(storageKey, ['dark', 'light', 'glass', 'system'], defaultTheme)
  const [density, setDensity] = usePreference<Density>('overstory.density', ['compact', 'comfortable'], 'compact')
  const [motion, setMotion] = usePreference<Motion>('overstory.motion', ['system', 'reduce'], 'system')
  const [transparency, setTransparency] = usePreference<Transparency>(
    'overstory.transparency',
    ['glass', 'opaque'],
    'glass',
  )
  const [wallpaperMotion, setWallpaperMotion] = usePreference<WallpaperMotion>(
    'overstory.wallpaper-motion',
    ['off', 'subtle', 'expressive'],
    'subtle',
  )
  const [wallpaperScene, setWallpaperScene] = usePreference<WallpaperScene>(
    'overstory.wallpaper-scene',
    ['context', 'canopy', 'tree', 'roots', 'fluid'],
    'canopy',
  )
  const [wallpaperWeather, setWallpaperWeather] = usePreference<WallpaperWeather>(
    'overstory.wallpaper-weather',
    ['clear', 'rain', 'snow', 'thunderstorm', 'fog', 'heat', 'cloudy'],
    'clear',
  )
  const { baseColor, accentMode, setBaseColor } = useThemeColorizer()

  useLayoutEffect(() => {
    const root = window.document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      root.classList.remove('light', 'dark', 'glass')
      root.classList.add(theme === 'system' ? (media.matches ? 'dark' : 'light') : theme)
    }
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
    }
  }, [theme])

  useLayoutEffect(() => {
    const root = window.document.documentElement
    root.dataset.density = density
    root.dataset.motion = motion
    root.dataset.transparency = transparency
  }, [density, motion, transparency])

  return (
    <ThemeProviderContext.Provider
      {...props}
      value={{
        wallpaperMotion,
        setWallpaperMotion,
        wallpaperScene,
        setWallpaperScene,
        wallpaperWeather,
        setWallpaperWeather,
        theme,
        setTheme,
        baseColor,
        accentMode,
        setBaseColor,
        density,
        setDensity,
        motion,
        setMotion,
        transparency,
        setTransparency,
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeProviderContext)
