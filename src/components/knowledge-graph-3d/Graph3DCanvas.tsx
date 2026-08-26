/**
 * @file Graph3DCanvas.tsx
 * @description React shell around `Graph3DScene`: owns the canvas element,
 * the layout worker, and the hover tooltip. Deliberately thin -- every
 * imperative concern lives in `scene.ts`, so React state changes never cause
 * the WebGL scene to be torn down and rebuilt.
 *
 * WebGL is feature-detected. When the browser cannot give us a context the
 * component says so in plain language instead of leaving a blank rectangle,
 * matching the same "never a silently blank canvas" rule the engine's own
 * interactive-render lane states.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Boxes } from 'lucide-react'

import { nodeTypeColor } from '../knowledge-graph/theme-colors'
import type { Graph3DModel } from './model'
import { Graph3DScene } from './scene'
import type { LayoutProgress, LayoutRequest } from './layout.worker'

export interface Graph3DCanvasProps {
  model: Graph3DModel
  isDark: boolean
  background: string
  selected: number | null
  onSelect: (index: number | null) => void
  onExpand: (index: number) => void
  /** `null` renders everything; otherwise a per-node 0/1 visibility mask. */
  visibleMask: Uint8Array | null
  autoRotate: boolean
  /** Increment to re-frame the camera on the currently visible nodes. */
  frameToken: number
}

interface HoverState {
  index: number
  x: number
  y: number
}

function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export function Graph3DCanvas({
  model,
  isDark,
  background,
  selected,
  onSelect,
  onExpand,
  visibleMask,
  autoRotate,
  frameToken,
}: Graph3DCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<Graph3DScene | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [fps, setFps] = useState(0)
  const [drawCalls, setDrawCalls] = useState(0)
  const [progress, setProgress] = useState(0)
  const [supported] = useState<boolean>(() => webglAvailable())

  // Colours come from the app's own theme tokens, through the SAME
  // `nodeTypeColor` the 2D canvas and the legend use, so a type is the same
  // colour everywhere in the product.
  const typeColors = useMemo(() => model.types.map((type) => nodeTypeColor(type, isDark)), [model.types, isDark])

  // BUG (found while screenshotting this view): the scene-lifecycle effect
  // originally listed the `onSelect`/`onExpand` callbacks in its dependency
  // array. A parent that passes an inline arrow (`onExpand={() => …}`) hands
  // over a NEW function identity on every render, so the effect tore the
  // WebGL scene down and rebuilt it -- and because the model effect's own
  // deps had not changed, nothing ever re-installed the graph into the new
  // scene. The canvas went black, with zero draw calls, on the first parent
  // re-render. Callbacks live in a ref instead: the scene is constructed
  // exactly once and always calls through to the LATEST props.
  const callbacksRef = useRef({ onSelect, onExpand })
  useEffect(() => {
    callbacksRef.current = { onSelect, onExpand }
  }, [onSelect, onExpand])

  // ── scene lifecycle: created once, never re-created by a state change ──
  useEffect(() => {
    const container = containerRef.current
    if (!container || !supported) return
    const scene = new Graph3DScene(container, {
      onHover: (index, x, y) => {
        setHover(index == null ? null : { index, x, y })
      },
      onSelect: (index) => {
        callbacksRef.current.onSelect(index)
      },
      onExpand: (index) => {
        callbacksRef.current.onExpand(index)
      },
      onStats: (nextFps, calls) => {
        setFps(nextFps)
        setDrawCalls(calls)
      },
    })
    sceneRef.current = scene
    const observer = new ResizeObserver(() => {
      scene.resize()
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [supported])

  // ── model + layout ────────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setModel(model, typeColors)
    setProgress(0)

    workerRef.current?.terminate()
    const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<unknown>) => {
      // Same structured-clone boundary as the worker's own inbound guard:
      // validated, not trusted from the type parameter.
      const data = event.data as Partial<LayoutProgress> | null
      if (data?.kind !== 'progress' || !data.positions) return
      sceneRef.current?.setTargetPositions(data.positions)
      const total = data.totalTicks ?? 0
      setProgress(total === 0 ? 1 : (data.tick ?? 0) / total)
      if (data.done) sceneRef.current?.frameVisibleIfIdle()
    }
    const edges = new Uint32Array(model.edges.length * 2)
    for (let i = 0; i < model.edges.length; i += 1) {
      edges[i * 2] = model.edges[i].s
      edges[i * 2 + 1] = model.edges[i].t
    }
    const degree = Uint32Array.from(model.degree)
    const request: LayoutRequest = {
      kind: 'layout',
      nodeCount: model.nodes.length,
      edges,
      degree,
      // Fixed seed: the same graph must lay out the same way every reload,
      // or the view is impossible to build a memory of.
      seed: 0x5eed_3d,
    }
    worker.postMessage(request, [edges.buffer, degree.buffer])
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [model, typeColors])

  useEffect(() => {
    sceneRef.current?.setBackground(background)
  }, [background])

  useEffect(() => {
    sceneRef.current?.setSelection(selected)
    if (selected != null) sceneRef.current?.focusNode(selected)
  }, [selected])

  useEffect(() => {
    sceneRef.current?.setVisibility(visibleMask)
  }, [visibleMask])

  useEffect(() => {
    sceneRef.current?.setAutoRotate(autoRotate)
  }, [autoRotate])

  useEffect(() => {
    if (frameToken > 0) sceneRef.current?.frameVisible()
  }, [frameToken])

  if (!supported) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
        <Boxes className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">This browser cannot open a WebGL context</p>
        <p className="max-w-md text-xs text-muted-foreground">
          The 3D graph needs WebGL. The 2D Knowledge Graph canvas renders the same data without it.
        </p>
      </div>
    )
  }

  const hovered = hover ? model.nodes[hover.index] : null

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-lg">
      {hovered && hover ? (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-md border bg-popover/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="font-medium leading-tight">{hovered.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: typeColors[model.typeIndex[hover.index]] }}
            />
            {hovered.type}
            <span className="opacity-60">· {model.degree[hover.index]} links</span>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
        {progress < 1 ? <span>settling {(progress * 100).toFixed(0)}%</span> : null}
        <span>{drawCalls} draw calls</span>
        <span>{fps.toFixed(0)} fps</span>
      </div>
    </div>
  )
}
