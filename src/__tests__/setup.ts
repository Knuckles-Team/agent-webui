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
// Worker stub for the 3D knowledge-graph view's layout worker
// (layout.worker.ts, spawned by Graph3DCanvas.tsx via `new Worker(...)`).
// jsdom does not implement the Worker API at all, so mounting the canvas
// throws `ReferenceError: Worker is not defined` without this. A real
// worker posts back layout snapshots asynchronously; this stub never does
// -- that is fine for what a route-render smoke test needs (mount without
// crashing), not for exercising the layout settling, which is what
// layout.worker.ts's own unit tests do by calling `runLayout` directly,
// in-process, with no `Worker` involved.
// ---------------------------------------------------------------------------
if (typeof (globalThis as { Worker?: unknown }).Worker === 'undefined') {
  // Same `vi.fn()`-per-instance-member shape as `ResizeObserverMock` above,
  // rather than empty class method bodies — matches this file's own
  // convention and sidesteps `no-empty-function` for methods that are
  // legitimately no-ops (see the file doc above for why).
  function WorkerMock(this: Record<string, unknown>) {
    this.onmessage = null
    this.onerror = null
    this.postMessage = vi.fn()
    this.terminate = vi.fn()
    this.addEventListener = vi.fn()
    this.removeEventListener = vi.fn()
    this.dispatchEvent = vi.fn(() => true)
  }
  ;(globalThis as { Worker?: unknown }).Worker = WorkerMock as unknown as typeof Worker
}

// ---------------------------------------------------------------------------
// WebGL2 stub for sigma.js (GraphView visualization tab) AND three.js
// (Graph3DView / Graph3DLodView's WebGLRenderer, scene.ts).
//
// jsdom does not implement any WebGL rendering context, so sigma/three both
// throw while constructing their renderers. We provide a minimal
// WebGL2RenderingContext stand-in plus a HTMLCanvasElement.getContext that
// returns it for webgl/webgl2 requests, so either can mount under jsdom.
// This does not weaken any assertions — the visualization simply renders
// against a no-op context.
// ---------------------------------------------------------------------------
class WebGL2RenderingContextMock {}

// A handful of WebGL members must return concrete (non-function) values so
// sigma/regl feature detection succeeds; everything else is a no-op function.
const WEBGL_VALUE_MEMBERS: Record<string, unknown> = {
  drawingBufferWidth: 0,
  drawingBufferHeight: 0,
  getExtension: null,
  getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 1, rangeMax: 1 }),
  // sigma's loadShader / linkProgram guard on these — report success so the
  // renderer initializes instead of throwing "error while compiling the shader".
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getShaderInfoLog: () => '',
  getProgramInfoLog: () => '',
  getError: () => 0,
}

// `getParameter` used to be one flat `() => 0` for every pname, which is all
// sigma's own numeric feature-detection ever needed. three.js's
// `WebGLRenderer` construction additionally calls
// `gl.getParameter(gl.VERSION)` and does `glVersion.indexOf('WebGL')` on the
// result (`three/src/renderers/webgl/WebGLState.js`) -- a NUMBER there
// throws `TypeError: glVersion.indexOf is not a function` before the scene
// ever renders a frame. Fixing it means `gl.VERSION` etc. must be
// individually addressable, not the one shared no-op closure every other
// unknown property resolves to below -- these sentinels exist ONLY so
// `getParameter` can tell its pname argument apart from every other
// property access; they carry no other meaning (real WebGL enum values
// would work as well, but a plain unique object avoids collisions with the
// numeric constants a future caller might also read directly).
const GL_VERSION = { name: 'VERSION' }
const GL_SHADING_LANGUAGE_VERSION = { name: 'SHADING_LANGUAGE_VERSION' }
const GL_VENDOR = { name: 'VENDOR' }
const GL_RENDERER = { name: 'RENDERER' }
// three.js's WebGLProgram, after linking, reflects the program's uniforms by
// looping `gl.getActiveUniform(program, i)` for `i` in
// `[0, gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS))`
// (`WebGLUniforms`/`onFirstUse` in three's own source) and reading `.name`
// off each result. This mock's opaque `createProgram()` handle has no real
// uniforms to reflect, so the honest answer is "zero" -- distinguishing
// these two pnames (like `getParameter`'s VERSION above) lets the count
// come back `0` instead of the shared `getProgramParameter` boolean `true`
// used for link/compile-status queries elsewhere, which a bare truthy value
// would otherwise coerce to `1` and send the loop into `getActiveUniform`
// with nothing real to return.
const GL_ACTIVE_UNIFORMS = { name: 'ACTIVE_UNIFORMS' }
const GL_ACTIVE_ATTRIBUTES = { name: 'ACTIVE_ATTRIBUTES' }
const GL_CONSTANT_SENTINELS: Record<string, unknown> = {
  VERSION: GL_VERSION,
  SHADING_LANGUAGE_VERSION: GL_SHADING_LANGUAGE_VERSION,
  VENDOR: GL_VENDOR,
  RENDERER: GL_RENDERER,
  ACTIVE_UNIFORMS: GL_ACTIVE_UNIFORMS,
  ACTIVE_ATTRIBUTES: GL_ACTIVE_ATTRIBUTES,
}
const GL_STRING_PARAMS = new Map<unknown, string>([
  [GL_VERSION, 'WebGL 2.0 (Mock)'],
  [GL_SHADING_LANGUAGE_VERSION, 'WebGL GLSL ES 3.00 (Mock)'],
  [GL_VENDOR, 'jsdom-mock'],
  [GL_RENDERER, 'jsdom-mock'],
])
// getProgramParameter pnames that must answer "zero active reflectable
// things" rather than the generic link/compile-status `true` — see the doc
// above.
const GL_ZERO_PROGRAM_PARAMS = new Set<unknown>([GL_ACTIVE_UNIFORMS, GL_ACTIVE_ATTRIBUTES])

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
        if (typeof prop === 'string' && prop in GL_CONSTANT_SENTINELS) return GL_CONSTANT_SENTINELS[prop]
        if (prop === 'getParameter') {
          // A STRING for the handful of pnames three.js's own version check
          // parses (see the sentinel doc above); the pre-existing `0` for
          // every other parameter, unchanged from before this string case
          // existed — sigma's numeric feature-detection still gets exactly
          // what it always got.
          return (pname: unknown) => GL_STRING_PARAMS.get(pname) ?? 0
        }
        if (prop === 'getProgramParameter') {
          return (_program: unknown, pname: unknown) => (GL_ZERO_PROGRAM_PARAMS.has(pname) ? 0 : true)
        }
        // Nothing to enumerate — `ACTIVE_UNIFORMS`/`ACTIVE_ATTRIBUTES` are
        // always reported as `0` above, so these are never actually called
        // for a real index, but a concrete no-op (rather than the shared
        // `noop` used for other unknown methods) documents that on purpose.
        if (prop === 'getActiveUniform' || prop === 'getActiveAttrib') {
          return () => null
        }
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
