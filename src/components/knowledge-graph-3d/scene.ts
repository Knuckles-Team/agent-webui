/**
 * @file scene.ts
 * @description The WebGL scene for the 3D knowledge graph. No React, no
 * fetching -- a plain class that owns a canvas, so it can be reasoned about
 * (and torn down) independently of the component that mounts it.
 *
 * ## Why points and line segments, not meshes
 *
 * The obvious way to draw a 3D graph is a sphere per node and a cylinder per
 * edge. That is also the way that stops being smooth at a few thousand nodes:
 * one `Object3D` per node means one draw call per node, plus a per-frame
 * matrix update and a scene-graph traversal for each. This scene instead
 * draws the ENTIRE graph in three draw calls, forever, regardless of node
 * count:
 *
 *   1. `LineSegments` -- every edge, additively blended so dense regions glow.
 *   2. `Points` (halo pass) -- an oversized, soft, additive sprite per node.
 *   3. `Points` (core pass) -- the crisp node body, sharing pass 2's geometry.
 *
 * Colour, size, and interaction STATE are per-vertex attributes, so
 * highlighting a neighbourhood or hiding two thirds of the graph is a buffer
 * write, not a scene rebuild. That is what makes selection feel instant.
 *
 * ## Why picking is done in screen space, not with `Raycaster`
 *
 * `Raycaster` against `Points` needs a world-space `threshold`, which under a
 * perspective camera means the pick radius is generous when you are close and
 * useless when you are far. Projecting the visible nodes to NDC and taking the
 * nearest within a PIXEL radius is both cheaper (one pass of ~10 flops per
 * node, only on pointer move) and behaves the same at every zoom level. At the
 * live graph's ~2.2k connected nodes this costs microseconds; the linear scan
 * is the honest limit of this approach and is why the module doc for
 * `PICK_LINEAR_SCAN_LIMIT` says what it says.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import type { Graph3DModel } from './model'

/**
 * Above this many VISIBLE nodes the per-pointer-move linear pick scan stops
 * being free and would need a spatial index. The renderer itself has no such
 * limit -- this is a note about the interaction layer, and the point at which
 * this file would need an octree.
 */
export const PICK_LINEAR_SCAN_LIMIT = 60_000

/** Pointer proximity, in CSS pixels, that counts as hovering a node. */
const PICK_RADIUS_PX = 14

/**
 * Floor on the neighbourhood radius `focusNode` frames, in the canonical world
 * units `layout.worker.ts` normalizes every layout to (see its
 * `CANONICAL_RADIUS`). Without it, focusing a leaf node flies the camera to
 * touching distance of a single point.
 */
const FOCUS_MIN_EXTENT = 42

/** Per-node interaction state, encoded into the `aState` vertex attribute. */
const STATE_NORMAL = 0
const STATE_DIMMED = 1
const STATE_NEIGHBOUR = 2
const STATE_SELECTED = 3
const STATE_HIDDEN = 4

const NODE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aState;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uViewportScale;
  uniform float uMaxSize;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float boost = 1.0;
    float alpha = 1.0;
    if (aState == ${STATE_DIMMED}.0)      { boost = 0.72; alpha = 0.16; }
    else if (aState == ${STATE_NEIGHBOUR}.0) { boost = 1.35; alpha = 1.0; }
    else if (aState == ${STATE_SELECTED}.0)  { boost = 2.05; alpha = 1.0; }
    else if (aState == ${STATE_HIDDEN}.0)    { boost = 0.0;  alpha = 0.0; }

    // Perspective size attenuation: nodes get smaller with distance the way
    // geometry does, so the point cloud reads as a solid object rather than
    // as flat confetti pinned to the screen.
    // Perspective-correct: a node keeps a fixed size in WORLD units, so the
    // point cloud reads as a solid object rather than as flat confetti pinned
    // to the screen. uViewportScale is height / (2 * tan(fov/2)), recomputed
    // on resize -- the standard projection of a world radius to pixels.
    // Clamped: without a ceiling, flying the camera up to a hub turns its
    // sprite into a screen-filling blur (and, on a software rasterizer, a
    // fill-rate cliff). The clamp is what keeps a close-up readable.
    float size = aSize * boost * uSizeScale * (uViewportScale / max(1.0, -mvPosition.z));
    gl_PointSize = min(size, uMaxSize) * uPixelRatio;
    vColor = aColor;
    vAlpha = alpha;
  }
`

const NODE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uCoreBias;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.001) discard;
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    // Soft body with a brighter centre. uCoreBias picks which of the two
    // passes this is: a wide, faint halo, or the crisp core on top of it.
    float body = smoothstep(0.5, uCoreBias, d);
    float core = pow(body, 2.2);
    vec3 rgb = mix(vColor, vColor + vec3(0.55), core * 0.7);
    gl_FragColor = vec4(rgb, body * vAlpha);
  }
`

export interface SceneCallbacks {
  onHover: (index: number | null, clientX: number, clientY: number) => void
  onSelect: (index: number | null) => void
  onExpand: (index: number) => void
  onStats: (fps: number, drawCalls: number) => void
}

interface Tween {
  from: Vector3
  to: Vector3
  fromTarget: Vector3
  toTarget: Vector3
  start: number
  duration: number
}

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class Graph3DScene {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly container: HTMLElement
  private readonly callbacks: SceneCallbacks

  private nodeGeometry = new BufferGeometry()
  private edgeGeometry = new BufferGeometry()
  private halo: Points | null = null
  private core: Points | null = null
  private lines: LineSegments | null = null
  private readonly haloMaterial: ShaderMaterial
  private readonly coreMaterial: ShaderMaterial
  private readonly edgeMaterial: LineBasicMaterial

  private model: Graph3DModel | null = null
  private positions = new Float32Array(0)
  private targetPositions = new Float32Array(0)
  private baseColors = new Float32Array(0)
  private state = new Float32Array(0)
  private visible: Uint8Array | null = null
  private selected: number | null = null
  private hovered: number | null = null

  private tween: Tween | null = null
  private raf = 0
  private disposed = false
  private lastPointer: { x: number; y: number } | null = null
  private pointerDirty = false
  private downAt: { x: number; y: number; t: number } | null = null
  private userEngaged = false
  private frames = 0
  private fpsSince = 0
  private settling = false

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container
    this.callbacks = callbacks

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false)
    const canvas = this.renderer.domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.touchAction = 'none'
    container.appendChild(canvas)

    this.camera = new PerspectiveCamera(55, this.aspect(), 0.5, 20_000)
    this.camera.position.set(0, 0, 420)

    this.controls = new OrbitControls(this.camera, canvas)
    // Damping is the single setting that decides whether the camera feels
    // heavy-but-smooth or twitchy. 0.075 is slow enough to glide and fast
    // enough not to feel like it is lagging the pointer.
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.075
    this.controls.rotateSpeed = 0.55
    this.controls.zoomSpeed = 0.9
    this.controls.panSpeed = 0.7
    this.controls.autoRotateSpeed = 0.35
    this.controls.minDistance = 8
    this.controls.maxDistance = 8_000

    const uniforms = () => ({
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uSizeScale: { value: 1 },
      uCoreBias: { value: 0.2 },
      uViewportScale: { value: 800 },
      uMaxSize: { value: 26 },
    })
    this.haloMaterial = new ShaderMaterial({
      uniforms: {
        ...uniforms(),
        uSizeScale: { value: 2.0 },
        uCoreBias: { value: 0.5 },
        uMaxSize: { value: 54 },
      },
      vertexShader: NODE_VERTEX_SHADER,
      fragmentShader: NODE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.coreMaterial = new ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: NODE_VERTEX_SHADER,
      fragmentShader: NODE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    })
    this.edgeMaterial = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: AdditiveBlending,
    })

    this.updateViewportScale()
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('wheel', this.onWheel, { passive: true })
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('dblclick', this.onDoubleClick)
    this.loop(0)
  }

  private aspect(): number {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    return w / h
  }

  resize(): void {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.updateViewportScale()
  }

  /** height / (2 tan(fov/2)) -- world units to pixels at unit depth. */
  private updateViewportScale(): void {
    const h = this.container.clientHeight || 1
    const scale = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360))
    this.haloMaterial.uniforms.uViewportScale.value = scale
    this.coreMaterial.uniforms.uViewportScale.value = scale
  }

  setBackground(cssColor: string): void {
    this.scene.background = new Color(cssColor)
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on
  }

  /**
   * Install a graph. `typeColors` is one `#rrggbb` per entry of
   * `model.types`, resolved by the caller from the app's theme so this file
   * never owns a palette of its own.
   */
  setModel(model: Graph3DModel, typeColors: string[]): void {
    this.model = model
    const n = model.nodes.length

    this.positions = new Float32Array(n * 3)
    this.targetPositions = new Float32Array(n * 3)
    this.baseColors = new Float32Array(n * 3)
    this.state = new Float32Array(n)
    const sizes = new Float32Array(n)

    const scratch = new Color()
    for (let i = 0; i < n; i += 1) {
      scratch.set(typeColors[model.typeIndex[i]] ?? '#8899aa')
      this.baseColors[i * 3] = scratch.r
      this.baseColors[i * 3 + 1] = scratch.g
      this.baseColors[i * 3 + 2] = scratch.b
      // sqrt(degree): a 200-edge hub reads as clearly bigger than a leaf
      // without becoming a planet that hides everything behind it.
      sizes[i] = 5.0 + 2.6 * Math.sqrt(model.degree[i] ?? 0)
    }

    this.nodeGeometry.dispose()
    this.nodeGeometry = new BufferGeometry()
    this.nodeGeometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    this.nodeGeometry.setAttribute('aColor', new BufferAttribute(this.baseColors, 3))
    this.nodeGeometry.setAttribute('aSize', new BufferAttribute(sizes, 1))
    this.nodeGeometry.setAttribute('aState', new BufferAttribute(this.state, 1))

    this.edgeGeometry.dispose()
    this.edgeGeometry = new BufferGeometry()
    this.edgeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(model.edges.length * 6), 3))
    this.edgeGeometry.setAttribute('color', new BufferAttribute(new Float32Array(model.edges.length * 6), 3))

    if (this.halo) this.scene.remove(this.halo)
    if (this.core) this.scene.remove(this.core)
    if (this.lines) this.scene.remove(this.lines)
    this.lines = new LineSegments(this.edgeGeometry, this.edgeMaterial)
    this.halo = new Points(this.nodeGeometry, this.haloMaterial)
    this.core = new Points(this.nodeGeometry, this.coreMaterial)
    // Draw order: edges under the halo under the core. `frustumCulled` off
    // because the bounding sphere is recomputed constantly while the layout
    // settles and a stale one culls the whole graph away mid-animation.
    for (const object of [this.lines, this.halo, this.core]) {
      object.frustumCulled = false
      this.scene.add(object)
    }
    this.lines.renderOrder = 0
    this.halo.renderOrder = 1
    this.core.renderOrder = 2

    this.selected = null
    this.hovered = null
    this.visible = null
    this.applyState()
  }

  /**
   * Hand the scene the newest layout snapshot. Positions are LERPED toward it
   * rather than assigned, which is what turns the worker's ~20 discrete
   * snapshots into one continuous unfolding motion.
   */
  setTargetPositions(next: Float32Array): void {
    if (next.length !== this.targetPositions.length) return
    this.targetPositions.set(next)
    this.settling = true
    // First snapshot: adopt it outright so the graph does not fly in from the
    // origin, which looks like a glitch rather than an animation.
    if (this.positions.every((v) => v === 0)) {
      this.positions.set(next)
      this.frameVisible()
    }
  }

  /** `null` means "everything visible". */
  setVisibility(mask: Uint8Array | null): void {
    this.visible = mask
    this.applyState()
  }

  setSelection(index: number | null): void {
    if (index != null) this.userEngaged = true
    this.selected = index
    this.applyState()
  }

  setHover(index: number | null): void {
    if (this.hovered === index) return
    this.hovered = index
    this.applyState()
  }

  /** Recompute every per-node/per-edge state attribute in one pass. */
  private applyState(): void {
    const model = this.model
    if (!model) return
    const n = model.nodes.length
    const focus = this.selected ?? this.hovered
    const neighbourMask = new Uint8Array(focus == null ? 0 : n)
    if (focus != null) {
      for (let k = model.adjOffset[focus]; k < model.adjOffset[focus + 1]; k += 1) {
        neighbourMask[model.adjTarget[k]] = 1
      }
    }

    for (let i = 0; i < n; i += 1) {
      if (this.visible?.[i] === 0) {
        this.state[i] = STATE_HIDDEN
      } else if (focus == null) {
        this.state[i] = STATE_NORMAL
      } else if (i === focus) {
        this.state[i] = STATE_SELECTED
      } else if (neighbourMask[i] === 1) {
        this.state[i] = STATE_NEIGHBOUR
      } else {
        this.state[i] = STATE_DIMMED
      }
    }
    this.nodeGeometry.getAttribute('aState').needsUpdate = true
    this.writeEdges()
  }

  /**
   * Rebuild the edge position + colour buffers. Called on every state change
   * and on every settled frame; it is one linear pass over the edge list with
   * no allocation, which is why it can afford to run per-frame while the
   * layout is still moving.
   */
  private writeEdges(): void {
    const model = this.model
    if (!model || !this.lines) return
    const pos = this.edgeGeometry.getAttribute('position') as BufferAttribute
    const col = this.edgeGeometry.getAttribute('color') as BufferAttribute
    const posArray = pos.array as Float32Array
    const colArray = col.array as Float32Array
    const focus = this.selected ?? this.hovered

    for (let e = 0; e < model.edges.length; e += 1) {
      const { s, t } = model.edges[e]
      const o = e * 6
      posArray[o] = this.positions[s * 3]
      posArray[o + 1] = this.positions[s * 3 + 1]
      posArray[o + 2] = this.positions[s * 3 + 2]
      posArray[o + 3] = this.positions[t * 3]
      posArray[o + 4] = this.positions[t * 3 + 1]
      posArray[o + 5] = this.positions[t * 3 + 2]

      const hidden = this.visible != null && (this.visible[s] === 0 || this.visible[t] === 0)
      const incident = focus != null && (s === focus || t === focus)
      // An edge takes its colour from its endpoints, so a relationship reads
      // as a gradient between the two types it connects.
      let gain = 1.05
      if (hidden) gain = 0
      else if (focus == null) gain = 1.05
      else if (incident) gain = 1.7
      else gain = 0.09

      for (let end = 0; end < 2; end += 1) {
        const node = end === 0 ? s : t
        colArray[o + end * 3] = this.baseColors[node * 3] * gain
        colArray[o + end * 3 + 1] = this.baseColors[node * 3 + 1] * gain
        colArray[o + end * 3 + 2] = this.baseColors[node * 3 + 2] * gain
      }
    }
    pos.needsUpdate = true
    col.needsUpdate = true
  }

  /**
   * Frame the visible nodes ONLY if the viewer has not taken control yet.
   *
   * BUG (found while screenshotting this view): the layout worker emits its
   * final snapshot seconds after the graph is already interactive, and the
   * "done" handler re-framed the camera unconditionally. Clicking a node
   * during those seconds flew the camera to it -- and then the layout
   * finished and yanked the camera back out to the whole-graph framing. The
   * fix is not to stop re-framing (a first-load auto-frame is exactly right);
   * it is that ANY viewer action -- an orbit, a zoom, a selection -- takes
   * the camera away from the layout for good.
   */
  frameVisibleIfIdle(): void {
    if (this.userEngaged) return
    this.frameVisible()
  }

  /** Frame the visible nodes: fit the bounding sphere, then glide to it. */
  frameVisible(): void {
    const model = this.model
    if (!model || model.nodes.length === 0) return
    let cx = 0
    let cy = 0
    let cz = 0
    let count = 0
    for (let i = 0; i < model.nodes.length; i += 1) {
      if (this.visible?.[i] === 0) continue
      cx += this.positions[i * 3]
      cy += this.positions[i * 3 + 1]
      cz += this.positions[i * 3 + 2]
      count += 1
    }
    if (count === 0) return
    cx /= count
    cy /= count
    cz /= count
    // A PERCENTILE radius, not the maximum: a graph almost always has a
    // handful of weakly-attached nodes flung far out by the charge force, and
    // framing to the furthest of them shrinks the part anyone wants to look
    // at into a speck in the middle. p92 keeps the body of the graph filling
    // the viewport and lets the stragglers sit just outside it.
    const distances = new Float64Array(count)
    let written = 0
    for (let i = 0; i < model.nodes.length; i += 1) {
      if (this.visible?.[i] === 0) continue
      const dx = this.positions[i * 3] - cx
      const dy = this.positions[i * 3 + 1] - cy
      const dz = this.positions[i * 3 + 2] - cz
      distances[written] = Math.sqrt(dx * dx + dy * dy + dz * dz)
      written += 1
    }
    distances.sort()
    const radius = Math.max(1, distances[Math.floor((written - 1) * 0.92)])
    const distance = (radius * 1.12) / Math.tan((this.camera.fov * Math.PI) / 360)
    const direction = new Vector3().subVectors(this.camera.position, this.controls.target).normalize()
    if (direction.lengthSq() < 1e-6) direction.set(0.35, 0.25, 1).normalize()
    const target = new Vector3(cx, cy, cz)
    this.flyTo(target.clone().addScaledVector(direction, distance), target, 900)
  }

  /** Glide the camera so a node and its neighbours fill the view. */
  focusNode(index: number): void {
    const model = this.model
    if (!model || index < 0 || index >= model.nodes.length) return
    const target = new Vector3(this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2])
    // Frame the node AND its immediate neighbours. A fixed focus distance does
    // not work: a two-edge leaf and a two-hundred-edge hub occupy wildly
    // different volumes, and one distance either buries the camera inside the
    // hub or leaves the leaf a dot.
    let extent = 0
    for (let k = model.adjOffset[index]; k < model.adjOffset[index + 1]; k += 1) {
      const nb = model.adjTarget[k]
      const dx = this.positions[nb * 3] - target.x
      const dy = this.positions[nb * 3 + 1] - target.y
      const dz = this.positions[nb * 3 + 2] - target.z
      extent = Math.max(extent, Math.sqrt(dx * dx + dy * dy + dz * dz))
    }
    const direction = new Vector3().subVectors(this.camera.position, this.controls.target).normalize()
    if (direction.lengthSq() < 1e-6) direction.set(0.35, 0.25, 1).normalize()
    const radius = Math.max(extent, FOCUS_MIN_EXTENT)
    const distance = (radius * 1.7) / Math.tan((this.camera.fov * Math.PI) / 360)
    this.flyTo(target.clone().addScaledVector(direction, distance), target, 750)
  }

  private flyTo(position: Vector3, target: Vector3, duration: number): void {
    this.tween = {
      from: this.camera.position.clone(),
      to: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      start: performance.now(),
      duration,
    }
  }

  // ── pointer handling ───────────────────────────────────────────────────

  private onPointerMove = (event: PointerEvent): void => {
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.pointerDirty = true
  }

  private onPointerLeave = (): void => {
    this.lastPointer = null
    this.pointerDirty = false
    this.setHover(null)
    this.callbacks.onHover(null, 0, 0)
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.userEngaged = true
    this.downAt = { x: event.clientX, y: event.clientY, t: performance.now() }
  }

  private onWheel = (): void => {
    this.userEngaged = true
  }

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.downAt
    this.downAt = null
    if (!down) return
    // A click is a click only if the pointer barely moved -- otherwise it was
    // an orbit drag, and selecting whatever happens to be under the release
    // point is the single most annoying thing a 3D graph can do.
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
    if (moved > 4 || performance.now() - down.t > 700) return
    const hit = this.pick(event.clientX, event.clientY)
    this.callbacks.onSelect(hit)
  }

  private onDoubleClick = (event: MouseEvent): void => {
    const hit = this.pick(event.clientX, event.clientY)
    if (hit != null) this.callbacks.onExpand(hit)
  }

  /** Nearest visible node within `PICK_RADIUS_PX` of a client-space point. */
  pick(clientX: number, clientY: number): number | null {
    const model = this.model
    if (!model) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const px = clientX - rect.left
    const py = clientY - rect.top

    this.camera.updateMatrixWorld()
    const v = new Vector3()
    let best: number | null = null
    let bestScore = PICK_RADIUS_PX * PICK_RADIUS_PX
    for (let i = 0; i < model.nodes.length; i += 1) {
      if (this.visible?.[i] === 0) continue
      v.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2])
      v.project(this.camera)
      if (v.z < -1 || v.z > 1) continue
      const sx = (v.x * 0.5 + 0.5) * rect.width
      const sy = (-v.y * 0.5 + 0.5) * rect.height
      const d2 = (sx - px) * (sx - px) + (sy - py) * (sy - py)
      // Ties go to the node nearer the camera, so a hub in front is not
      // stolen by a leaf behind it.
      if (d2 < bestScore) {
        bestScore = d2
        best = i
      }
    }
    return best
  }

  // ── frame loop ─────────────────────────────────────────────────────────

  private loop = (now: number): void => {
    if (this.disposed) return
    this.raf = window.requestAnimationFrame(this.loop)

    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.duration)
      const k = easeInOutCubic(t)
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, k)
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, k)
      if (t >= 1) this.tween = null
    }

    if (this.settling) {
      // Exponential approach to the newest layout snapshot. 0.14 settles in
      // ~15 frames -- fast enough to track the worker, slow enough to read as
      // motion rather than a jump.
      let moved = 0
      for (let i = 0; i < this.positions.length; i += 1) {
        const delta = this.targetPositions[i] - this.positions[i]
        this.positions[i] += delta * 0.14
        moved += Math.abs(delta)
      }
      this.nodeGeometry.getAttribute('position').needsUpdate = true
      this.writeEdges()
      if (moved < this.positions.length * 0.01) this.settling = false
    }

    if (this.pointerDirty && this.lastPointer) {
      this.pointerDirty = false
      const hit = this.pick(this.lastPointer.x, this.lastPointer.y)
      if (hit !== this.hovered) {
        this.setHover(hit)
        this.callbacks.onHover(hit, this.lastPointer.x, this.lastPointer.y)
      }
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)

    this.frames += 1
    if (now - this.fpsSince >= 500) {
      const fps = (this.frames * 1000) / (now - this.fpsSince)
      this.callbacks.onStats(fps, this.renderer.info.render.calls)
      this.frames = 0
      this.fpsSince = now
    }
  }

  dispose(): void {
    this.disposed = true
    window.cancelAnimationFrame(this.raf)
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('wheel', this.onWheel)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('dblclick', this.onDoubleClick)
    this.controls.dispose()
    this.nodeGeometry.dispose()
    this.edgeGeometry.dispose()
    this.haloMaterial.dispose()
    this.coreMaterial.dispose()
    this.edgeMaterial.dispose()
    this.renderer.dispose()
    canvas.remove()
  }
}
