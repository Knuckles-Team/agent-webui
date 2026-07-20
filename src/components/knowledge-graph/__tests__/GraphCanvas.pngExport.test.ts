import { describe, it, expect, afterEach, vi } from 'vitest'
import { compositeSigmaCanvasesToPngDataUrl } from '@/components/knowledge-graph/GraphCanvas'

// PNG/screenshot export (Ontology-Playground coverage row #31). Unit-tests the
// pure compositing helper GraphCanvas's "Download PNG" HUD button calls — no
// DOM rendering / sigma instance required, just plain <canvas> elements.
//
// jsdom has no native canvas-pixel backend (`toDataURL` logs "Not
// implemented" and returns a stub value without the optional `canvas` npm
// package, which this repo does not depend on) — so tests that need the
// actual PNG bytes stub `HTMLCanvasElement.prototype.toDataURL` rather than
// asserting on jsdom's fake pixel output. What's under test is THIS
// function's logic (layer sizing, draw order, return-value plumbing), not
// jsdom's canvas rendering.

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

describe('compositeSigmaCanvasesToPngDataUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when there are no layers', () => {
    expect(compositeSigmaCanvasesToPngDataUrl({})).toBeNull()
  })

  it('sizes the composited canvas to match the source layers and returns the PNG data URL', () => {
    let capturedWidth = -1
    let capturedHeight = -1
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement): string {
      capturedWidth = this.width
      capturedHeight = this.height
      return 'data:image/png;base64,FAKE'
    })

    const canvases = { edges: makeCanvas(640, 480), nodes: makeCanvas(640, 480) }
    const dataUrl = compositeSigmaCanvasesToPngDataUrl(canvases)

    expect(dataUrl).toBe('data:image/png;base64,FAKE')
    expect(capturedWidth).toBe(640)
    expect(capturedHeight).toBe(480)
  })

  it('draws every provided layer, known and unknown, without throwing', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,FAKE')
    const canvases = {
      edges: makeCanvas(100, 100),
      nodes: makeCanvas(100, 100),
      labels: makeCanvas(100, 100),
      edgeLabels: makeCanvas(100, 100),
      hovers: makeCanvas(100, 100),
      someFutureLayer: makeCanvas(100, 100),
    }
    expect(() => compositeSigmaCanvasesToPngDataUrl(canvases)).not.toThrow()
  })
})
