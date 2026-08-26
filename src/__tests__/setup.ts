import { expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import {
  mockMemoryNode,
  mockKnowledgeBase,
  mockArticle,
  mockSpec,
  mockPlan,
  mockTask,
  mockGraphStats,
  mockGraphNodes,
  mockGraphNodeTypes,
  mockGraphRelationships,
} from './fixtures'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Default route-aware fetch shim
//
// The view components (MemoryView, SDDView, KnowledgeBaseView, GraphView, ...)
// talk to the backend with bare `fetch('/api/enhanced/...')` calls rather than
// going through a typed api client. Under jsdom there is no backend, so without
// a shim those relative requests would either fail to parse (no base URL) or
// reject (no network) and the components would render empty.
//
// This shim resolves each known `/api/enhanced/*` route to the same fixture
// data the per-suite mocks already declare, so the data path is genuinely
// exercised end to end. Suites that need bespoke behaviour (CypherReplView /
// MagmaView) assign their own `global.fetch` inside the test, which transparently
// overrides this default for that test.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

function routeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const path = url.replace(/^https?:\/\/[^/]+/, '')

  // Memory
  if (path.startsWith('/api/enhanced/graph/nodes') && path.includes('node_type=Memory')) {
    return Promise.resolve(jsonResponse([mockMemoryNode]))
  }
  if (path.startsWith('/api/enhanced/graph/memory')) {
    return Promise.resolve(jsonResponse({ status: 'success', id: 'mem_test' }))
  }

  // Graph (GraphView)
  if (path.startsWith('/api/enhanced/graph/stats')) {
    return Promise.resolve(jsonResponse(mockGraphStats))
  }
  if (path.startsWith('/api/enhanced/graph/node-types')) {
    return Promise.resolve(jsonResponse(mockGraphNodeTypes))
  }
  if (path.startsWith('/api/enhanced/graph/relationships')) {
    return Promise.resolve(jsonResponse(mockGraphRelationships))
  }
  if (path.startsWith('/api/enhanced/graph/nodes')) {
    return Promise.resolve(jsonResponse(mockGraphNodes))
  }
  if (path.startsWith('/api/enhanced/graph/query')) {
    return Promise.resolve(jsonResponse([]))
  }
  if (path.startsWith('/api/enhanced/graph/magma')) {
    return Promise.resolve(jsonResponse([]))
  }

  // SDD
  if (path.startsWith('/api/enhanced/sdd/constitution')) {
    return Promise.resolve(
      jsonResponse({
        governance_rules: ['Rule 1', 'Rule 2'],
        tech_stack: { language: 'Python' },
        quality_gates: ['Gate 1'],
      }),
    )
  }
  if (path.startsWith('/api/enhanced/sdd/specs')) {
    return Promise.resolve(jsonResponse([mockSpec]))
  }
  if (path.startsWith('/api/enhanced/sdd/plans')) {
    return Promise.resolve(jsonResponse([mockPlan]))
  }
  if (path.startsWith('/api/enhanced/sdd/tasks')) {
    return Promise.resolve(jsonResponse({ tasks: [mockTask] }))
  }
  if (path.startsWith('/api/enhanced/sdd/spec')) {
    return Promise.resolve(jsonResponse({ ...mockSpec, id: 'new_spec' }))
  }
  if (path.startsWith('/api/enhanced/sdd/sync')) {
    return Promise.resolve(jsonResponse({ status: 'success' }))
  }

  // Knowledge base
  if (path.startsWith('/api/enhanced/kb/list')) {
    return Promise.resolve(jsonResponse([mockKnowledgeBase]))
  }
  if (path.startsWith('/api/enhanced/kb/search')) {
    return Promise.resolve(jsonResponse([mockArticle]))
  }
  if (path.startsWith('/api/enhanced/kb/ingest')) {
    return Promise.resolve(jsonResponse({ status: 'success', job_id: 'test_job' }))
  }
  if (path.startsWith('/api/enhanced/kb/health')) {
    return Promise.resolve(jsonResponse({ health_status: 'healthy', issues: [] }))
  }

  // Unknown route: behave like an empty-but-OK backend.
  return Promise.resolve(jsonResponse([]))
}

function installDefaultFetch(): void {
  global.fetch = vi.fn(routeFetch)
}

// Install before every test so suites that call `vi.restoreAllMocks()` (which
// would otherwise strip the shim) still start from a working default.
beforeEach(() => {
  installDefaultFetch()
})
installDefaultFetch()

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Mock ResizeObserver as a constructor returning an observer-shaped object so
// libraries that `new` it and read its instance methods (e.g. floating-ui's
// autoUpdate, used by Radix popovers) work under jsdom.
function ResizeObserverMock(this: Record<string, unknown>) {
  this.observe = vi.fn()
  this.unobserve = vi.fn()
  this.disconnect = vi.fn()
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

// jsdom does not implement Element.prototype.scrollIntoView, which Radix Select
// calls when opening its listbox. Polyfill it as a no-op so popover-based
// components render under the test environment. (jsdom also lacks the
// PointerEvent capture APIs Radix uses on the trigger.)
const elementProto = Element.prototype as unknown as Record<string, unknown>
elementProto.scrollIntoView ??= vi.fn()
elementProto.hasPointerCapture ??= vi.fn(() => false)
elementProto.releasePointerCapture ??= vi.fn()

// ---------------------------------------------------------------------------
// WebGL2 stub for sigma.js (GraphView visualization tab).
//
// jsdom does not implement any WebGL rendering context, so sigma throws while
// constructing its WebGL2 renderer. We provide a minimal WebGL2RenderingContext
// stand-in plus a HTMLCanvasElement.getContext that returns it for webgl/webgl2
// requests, so GraphView can mount under jsdom. This does not weaken any
// assertions — the visualization simply renders against a no-op context.
// ---------------------------------------------------------------------------
class WebGL2RenderingContextMock {}

// A handful of WebGL members must return concrete (non-function) values so
// sigma/regl feature detection succeeds; everything else is a no-op function.
const WEBGL_VALUE_MEMBERS: Record<string, unknown> = {
  drawingBufferWidth: 0,
  drawingBufferHeight: 0,
  getExtension: null,
  getParameter: 0,
  getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 1, rangeMax: 1 }),
  // sigma's loadShader / linkProgram guard on these — report success so the
  // renderer initializes instead of throwing "error while compiling the shader".
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getShaderInfoLog: () => '',
  getProgramInfoLog: () => '',
  getError: () => 0,
}

function createWebGLContext(canvas: HTMLCanvasElement): RenderingContext {
  // `create*` factories (createFramebuffer/createTexture/createBuffer/...) must
  // return a truthy handle — sigma throws if a framebuffer comes back falsy.
  const createNoop = () => ({})
  // Everything else is a no-op returning undefined.
  const noop = () => undefined
  // A flat proxy over a plain object (no recursive prototype tricks): unknown
  // member access yields a no-op function so any GL call during init is safe.
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'canvas') return canvas
        if (prop in WEBGL_VALUE_MEMBERS) {
          const v = WEBGL_VALUE_MEMBERS[prop as string]
          return typeof v === 'function' ? v : () => v
        }
        if (prop === 'getExtension') return () => null
        if (typeof prop === 'string' && prop.startsWith('create')) return createNoop
        return noop
      },
    },
  ) as unknown as RenderingContext
}

if (typeof (globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext === 'undefined') {
  ;(globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext = WebGL2RenderingContextMock
}
// sigma's feature detection also references the WebGL1 constructor by name.
if (typeof (globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext === 'undefined') {
  ;(globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext = WebGL2RenderingContextMock
}

const originalGetContext = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function getContext(
  this: HTMLCanvasElement,
  contextId: string,
  ...args: unknown[]
): RenderingContext | null {
  if (contextId === 'webgl2' || contextId === 'webgl' || contextId === 'experimental-webgl') {
    return createWebGLContext(this)
  }
  if (contextId === '2d') {
    // sigma's mouse/label layers use a 2D canvas; jsdom returns null for it.
    // Provide a no-op 2D context so the renderer's clear/draw passes succeed.
    const noop = () => undefined
    return new Proxy(
      { canvas: this },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string, unknown>)[prop as string]
          if (prop === 'measureText') return () => ({ width: 0 })
          if (prop === 'createImageData' || prop === 'getImageData') {
            return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
          }
          if (prop === 'canvas') return target.canvas
          return noop
        },
      },
    ) as unknown as RenderingContext
  }
  if (typeof originalGetContext === 'function') {
    return (originalGetContext as (id: string, ...a: unknown[]) => RenderingContext | null).call(
      this,
      contextId,
      ...args,
    )
  }
  return null
} as typeof HTMLCanvasElement.prototype.getContext
