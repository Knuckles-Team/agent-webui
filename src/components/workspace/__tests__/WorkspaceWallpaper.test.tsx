// spec: WEBUI-DESIGN-R005.4, WEBUI-DESIGN-R005.5
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../theme-provider'
import { WorkspaceAppearance } from '../WorkspaceAppearance'
import { WALLPAPER_BUDGET, wallpaperSize, WorkspaceWallpaper, resolveWallpaperScene } from '../WorkspaceWallpaper'

vi.mock('@/hooks/use-theme-colorizer', () => ({ useThemeColorizer: () => ({ baseColor: '', setBaseColor: vi.fn() }) }))
const clearRect = vi.fn()
let intersect: (entries: { isIntersecting: boolean }[]) => void
const disconnect = vi.fn()
let reduced = false
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  reduced = false
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: reduced && query.includes('reduced-motion'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    lineTo: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback
      }
      observe = vi.fn()
      disconnect = disconnect
    },
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearRect.mockClear()
})
function mount() {
  return render(
    <ThemeProvider>
      <WorkspaceAppearance />
      <WorkspaceWallpaper />
    </ThemeProvider>,
  )
}
it('caps backing pixels and DPR for small and ultra-wide displays', () => {
  for (const [width, height, dpr] of [
    [3840, 2160, 3],
    [800, 600, 2],
    [400, 300, 1],
  ]) {
    const size = wallpaperSize(width, height, dpr)
    expect(size.width * size.height).toBeLessThanOrEqual(WALLPAPER_BUDGET.pixels)
    expect(size.width).toBeLessThanOrEqual(width * WALLPAPER_BUDGET.dpr)
  }
})
it('defaults off, animates only by choice, pauses offscreen and cleans up', () => {
  const view = mount()
  expect(screen.getByLabelText('Wallpaper motion')).toHaveValue('off')
  expect(view.container.querySelector('canvas')).toHaveAttribute('data-active', 'false')
  const baseline = clearRect.mock.calls.length
  void act(() => vi.advanceTimersByTime(1000))
  expect(clearRect).toHaveBeenCalledTimes(baseline)
  fireEvent.change(screen.getByLabelText('Wallpaper motion'), { target: { value: 'expressive' } })
  expect(view.container.querySelector('canvas')).toHaveAttribute('data-active', 'true')
  const start = clearRect.mock.calls.length
  void act(() => vi.advanceTimersByTime(1000))
  expect(clearRect.mock.calls.length - start).toBeGreaterThan(0)
  expect(clearRect.mock.calls.length - start).toBeLessThanOrEqual(24)
  act(() => {
    intersect([{ isIntersecting: false }])
  })
  const paused = clearRect.mock.calls.length
  void act(() => vi.advanceTimersByTime(1000))
  expect(clearRect).toHaveBeenCalledTimes(paused)
  act(() => {
    intersect([{ isIntersecting: true }])
  })
  view.unmount()
  const ended = clearRect.mock.calls.length
  void act(() => vi.advanceTimersByTime(1000))
  expect(clearRect).toHaveBeenCalledTimes(ended)
  expect(disconnect).toHaveBeenCalled()
})
it('system reduction overrides stored expressive motion from mount', () => {
  reduced = true
  localStorage.setItem('agent-webui.wallpaper-motion', 'expressive')
  mount()
  const baseline = clearRect.mock.calls.length
  void act(() => vi.advanceTimersByTime(2000))
  expect(clearRect).toHaveBeenCalledTimes(baseline)
})
it('labels weather as manual and persists only appearance settings', () => {
  mount()
  fireEvent.change(screen.getByLabelText('Weather preview (manual)'), { target: { value: 'thunderstorm' } })
  expect(localStorage.getItem('agent-webui.wallpaper-weather')).toBe('thunderstorm')
  expect(screen.getByText(/no location or live provider/)).toBeInTheDocument()
})
it('retains the original photo fallback when canvas is unavailable', () => {
  localStorage.setItem('agent-webui.wallpaper-scene', 'tree')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  expect(() => mount()).not.toThrow()
})
it.each(['clear', 'rain', 'snow', 'thunderstorm', 'fog', 'heat', 'cloudy'])(
  'renders %s only as a manual preview',
  (weather) => {
    mount()
    fireEvent.change(screen.getByLabelText('Weather preview (manual)'), { target: { value: weather } })
    for (const scene of ['canopy', 'tree', 'roots', 'fluid']) {
      fireEvent.change(screen.getByLabelText('Wallpaper scene'), { target: { value: scene } })
    }
    expect(clearRect).toHaveBeenCalled()
  },
)
it('pauses hidden documents and does not resume after context loss', () => {
  const view = mount()
  fireEvent.change(screen.getByLabelText('Wallpaper motion'), { target: { value: 'subtle' } })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  const hidden = clearRect.mock.calls.length
  void act(() => vi.advanceTimersByTime(1000))
  expect(clearRect).toHaveBeenCalledTimes(hidden)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  fireEvent(document, new Event('visibilitychange'))
  const canvas = view.container.querySelector('canvas')!
  fireEvent(canvas, new Event('contextlost'))
  expect(canvas).toHaveAttribute('hidden')
  fireEvent(document, new Event('visibilitychange'))
  const lost = clearRect.mock.calls.length
  void act(() => vi.advanceTimersByTime(1000))
  expect(clearRect).toHaveBeenCalledTimes(lost)
  expect(canvas).toHaveAttribute('hidden')
})
it('stops drawing and retains the photo when the context fails during painting', () => {
  clearRect.mockImplementationOnce(() => {
    throw new Error('Synthetic context failure')
  })
  localStorage.setItem('agent-webui.wallpaper-motion', 'expressive')
  const view = mount()
  expect(view.container.querySelector('canvas')).toHaveAttribute('hidden')
  const failed = clearRect.mock.calls.length
  void act(() => vi.advanceTimersByTime(1000))
  expect(clearRect).toHaveBeenCalledTimes(failed)
})

it('resolves only canonical page context and preserves manual overrides', () => {
  for (const [route, scene] of [
    ['workspace.work-proof', 'tree'],
    ['workspace.explore-proof', 'canopy'],
    ['workspace.operate', 'roots'],
    ['workspace.entry', 'fluid'],
    ['unknown', 'fluid'],
  ]) {
    expect(resolveWallpaperScene('context', route)).toBe(scene)
    expect(resolveWallpaperScene('tree', route)).toBe('tree')
  }
  expect(resolveWallpaperScene('context')).toBe('fluid')
})

it('follows route changes only by choice without enabling motion or retaining old effects', () => {
  localStorage.setItem('agent-webui.wallpaper-scene', 'context')
  const content = (routeId: string) => (
    <ThemeProvider>
      <WorkspaceAppearance />
      <WorkspaceWallpaper routeId={routeId} />
    </ThemeProvider>
  )
  const view = render(content('workspace.work-proof'))
  expect(view.container.querySelector('canvas')).toHaveAttribute('data-scene', 'tree')
  expect(screen.getByLabelText('Wallpaper motion')).toHaveValue('off')
  const start = clearRect.mock.calls.length
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(clearRect).toHaveBeenCalledTimes(start)
  view.rerender(content('workspace.operate'))
  expect(disconnect).toHaveBeenCalled()
  expect(view.container.querySelector('canvas')).toHaveAttribute('data-scene', 'roots')
  fireEvent.change(screen.getByLabelText('Wallpaper scene'), { target: { value: 'fluid' } })
  view.rerender(content('workspace.explore-proof'))
  expect(view.container.querySelector('canvas')).toHaveAttribute('data-scene', 'fluid')
  expect(localStorage.getItem('agent-webui.wallpaper-scene')).toBe('fluid')
  expect(screen.getByLabelText('Wallpaper motion')).toHaveValue('off')
})
