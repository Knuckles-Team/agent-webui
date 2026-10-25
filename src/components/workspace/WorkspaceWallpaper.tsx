// spec: WEBUI-DESIGN-R005.3, WEBUI-DESIGN-R005.4, WEBUI-DESIGN-R005.5
import { useEffect, useRef } from 'react'
import { useTheme, type WallpaperScene, type WallpaperWeather } from '../theme-provider'
import './WorkspaceWallpaper.css'

export const WALLPAPER_BUDGET = { pixels: 800_000, dpr: 1.5, particles: 24, subtleFps: 12, expressiveFps: 24 } as const

export function wallpaperSize(width: number, height: number, dpr: number) {
  const scale = Math.min(
    WALLPAPER_BUDGET.dpr,
    Math.max(1, dpr),
    Math.sqrt(WALLPAPER_BUDGET.pixels / Math.max(1, width * height)),
  )
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

/** Abstract decoration only: no graph, weather, location, or activity service. */
function paint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: Exclude<WallpaperScene, 'context'>,
  weather: WallpaperWeather,
  time: number,
) {
  ctx.clearRect(0, 0, width, height)
  ctx.strokeStyle = '#76aa8d'
  ctx.fillStyle = '#b3d4b1'
  ctx.lineWidth = Math.max(1, width / 600)
  const sway = Math.sin(time / 6000) * width * 0.012
  if (scene === 'fluid') {
    for (let i = 0; i < 5; i++) {
      ctx.beginPath()
      ctx.moveTo(0, (height * (i + 1)) / 6)
      ctx.bezierCurveTo(
        width * 0.3,
        height * 0.2 + sway * 4,
        width * 0.7,
        height * 0.8 - sway * 4,
        width,
        (height * (i + 1)) / 6,
      )
      ctx.stroke()
    }
  } else {
    const root = scene === 'roots'
    const originY = root ? height * 0.15 : height
    ctx.beginPath()
    ctx.moveTo(width * 0.5, originY)
    ctx.quadraticCurveTo(width * 0.48 + sway, height * 0.5, width * 0.5 + sway, root ? height : height * 0.08)
    ctx.stroke()
    for (let i = 0; i < WALLPAPER_BUDGET.particles; i++) {
      const side = i % 2 ? 1 : -1
      const level = (i + 2) / 28
      const x = width * 0.5 + side * width * (0.12 + (i % 5) * 0.065) + sway
      const y = height * (root ? 1 - level : level)
      ctx.beginPath()
      ctx.moveTo(width * 0.5 + sway, height * (root ? 1 - level * 0.7 : level + 0.18))
      ctx.quadraticCurveTo(x, y + (root ? -40 : 40), x, y)
      ctx.stroke()
      if (!root) {
        ctx.beginPath()
        ctx.ellipse(x, y, width * (scene === 'canopy' ? 0.025 : 0.012), height * 0.009, side * 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.strokeStyle = '#d2e3e9'
  ctx.fillStyle = '#e4ece7'
  if (weather === 'rain' || weather === 'snow' || weather === 'thunderstorm') {
    for (let i = 0; i < WALLPAPER_BUDGET.particles; i++) {
      const x = ((i * 0.618) % 1) * width
      const y = ((i * 0.381 + time / (weather === 'snow' ? 18000 : 6000)) % 1) * height
      ctx.beginPath()
      if (weather === 'snow') {
        ctx.arc(x, y, 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.moveTo(x, y)
        ctx.lineTo(x - 3, y + 12)
        ctx.stroke()
      }
      // Slow glass droplets in storms; no flashes, audio or content distortion.
      if (weather === 'thunderstorm' && i < 8) {
        ctx.beginPath()
        ctx.ellipse(x, y * 0.3, 3, 5, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  } else if (weather !== 'clear') {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.ellipse(
        (width * (i + 0.5)) / 3 + sway,
        (height * (i + 1)) / 4,
        width * 0.24,
        height * (weather === 'heat' ? 0.025 : 0.09),
        0,
        0,
        Math.PI * 2,
      )
      if (weather === 'heat') ctx.stroke()
      else ctx.fill()
    }
  }
}

/** Canonical page selection only; never infer activity from identity or navigation. */
export function resolveWallpaperScene(scene: WallpaperScene, routeId?: string): Exclude<WallpaperScene, 'context'> {
  if (scene !== 'context') return scene
  if (routeId === 'workspace.work-proof') return 'tree'
  if (routeId === 'workspace.explore-proof') return 'canopy'
  if (routeId === 'workspace.operate') return 'roots'
  return 'fluid'
}

export function WorkspaceWallpaper({ routeId }: { routeId?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { wallpaperMotion, wallpaperScene, wallpaperWeather, motion, transparency } = useTheme()
  const scene = resolveWallpaperScene(wallpaperScene, routeId)
  useEffect(() => {
    const node = canvas.current
    if (!node) return
    // The accepted default photo needs no context, listeners or backing store.
    if (wallpaperMotion === 'off' && scene === 'canopy' && wallpaperWeather === 'clear') {
      node.width = 0
      node.height = 0
      return
    }
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = node.getContext('2d')
    } catch {
      /* Original photo remains the fallback. */
    }
    if (!ctx) return
    const context = ctx
    const media = [
      '(prefers-reduced-motion: reduce)',
      '(prefers-reduced-transparency: reduce)',
      '(forced-colors: active)',
    ].map((query) => window.matchMedia(query))
    let visible = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let elapsed = 0
    let failed = false
    const resources = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
    const constrained =
      resources.connection?.saveData === true || (resources.deviceMemory !== undefined && resources.deviceMemory <= 2)
    const fps = wallpaperMotion === 'expressive' ? WALLPAPER_BUDGET.expressiveFps : WALLPAPER_BUDGET.subtleFps
    const delay = Math.ceil(1000 / fps)
    function stop() {
      clearTimeout(timer)
      timer = undefined
    }
    function draw() {
      if (failed) return
      try {
        paint(
          context,
          node!.width,
          node!.height,
          scene,
          wallpaperWeather,
          elapsed * (wallpaperMotion === 'expressive' ? 1 : 0.4),
        )
      } catch {
        failed = true
        stop()
        node!.hidden = true
      }
    }
    function tick() {
      elapsed += delay
      draw()
      if (!failed) timer = setTimeout(tick, delay)
    }
    function sync() {
      stop()
      const reduced = motion === 'reduce' || transparency === 'opaque' || media.some((query) => query.matches)
      node!.hidden = failed || transparency === 'opaque' || media[1].matches || media[2].matches
      draw()
      if (!failed && !constrained && !reduced && wallpaperMotion !== 'off' && visible && !document.hidden)
        timer = setTimeout(tick, delay)
    }
    function resize() {
      const bounds = node!.getBoundingClientRect()
      const size = wallpaperSize(bounds.width, bounds.height, window.devicePixelRatio || 1)
      node!.width = size.width
      node!.height = size.height
      sync()
    }
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting)
            sync()
          })
    observer?.observe(node)
    const resizer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    resizer?.observe(node)
    function loseContext() {
      failed = true
      stop()
      node!.hidden = true
    }
    node.addEventListener('contextlost', loseContext)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', sync)
    media.forEach((query) => {
      query.addEventListener('change', sync)
    })
    resize()
    return () => {
      stop()
      observer?.disconnect()
      resizer?.disconnect()
      node.removeEventListener('contextlost', loseContext)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', sync)
      media.forEach((query) => {
        query.removeEventListener('change', sync)
      })
    }
  }, [wallpaperMotion, scene, wallpaperWeather, motion, transparency])
  const active = wallpaperMotion !== 'off' || scene !== 'canopy' || wallpaperWeather !== 'clear'
  return (
    <canvas ref={canvas} className="workspace-wallpaper" data-active={active} data-scene={scene} aria-hidden="true" />
  )
}
