/**
 * @file scene.ts
 * @description The WebGL scene for the 3D knowledge graph. No React, no
 * fetching -- a plain class that owns a canvas, so it can be reasoned about
 * (and torn down) independently of the component that mounts it.
 *
 * ## Two draw calls for the whole graph
 *
 * The obvious way to draw a 3D graph is one `Mesh` per node and one per edge.
 * That is also the way that stops being smooth at a few thousand nodes: a draw
 * call, a matrix update and a scene-graph traversal each, every frame. This
 * scene draws the entire graph in TWO:
 *
 *   1. `InstancedMesh` -- every node, one lit sphere instance each, with a
 *      per-instance matrix (position + size) and a per-instance colour.
 *   2. `LineSegments` -- every edge, additively blended so dense regions glow.
 *
 * Interaction state -- hover, selection, the second-degree context ring, the
 * relationship-type filter, the isolate mask -- is expressed by rewriting
 * those per-instance matrices and colours, never by adding or removing
 * objects. That is what makes selection feel instant.
 *
 * Sphere tessellation is chosen from the node count ([`sphereDetail`]): the
 * per-instance triangle budget is the one cost that does scale with N, so a
 * 25k-node graph gets a coarser sphere than a 2k-node one and the total stays
 * bounded. At the sizes a node is actually drawn, the difference is invisible.
 *
 * ## Depth, and why it is fog + bloom rather than only lights
 *
 * A force-directed graph in 3D reads as flat unless something tells the eye
 * which nodes are near. Three things do that here, in increasing cost:
 * exponential fog (free, and the strongest single cue), lit spheres with a
 * camera-follow key light (one draw call), and an `UnrealBloomPass` so bright
 * nodes bleed light the way a real point source does. Depth of field
 * (`BokehPass`) is available but OFF by default -- it is the one effect here
 * that renders an extra depth pass per frame, and it makes a graph you are
 * meant to read blurrier, not clearer, unless you are already focused on one
 * node.
 *
 * ## Why picking is done in screen space, not with `Raycaster`
 *
 * `Raycaster` against an `InstancedMesh` tests every instance's geometry.
 * Projecting node CENTRES to NDC and taking the nearest within a PIXEL radius
 * is far cheaper (~10 flops per node, only on pointer move) and behaves the
 * same at every zoom level, where a world-space ray threshold does not. At the
 * live graph's ~2.2k connected nodes this costs microseconds; the linear scan
 * is the honest limit of this approach and is why the doc for
 * [`PICK_LINEAR_SCAN_LIMIT`] says what it says.
 */

import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  FogExp2,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

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

/**
 * Interaction tier of one node, in increasing prominence.
 *
 * `NORMAL` is what every node is when nothing is focused -- distinct from
 * `NEIGHBOUR`, which is a node's tier only BECAUSE something else is focused.
 * Collapsing the two (the first version of this file did) made the resting
 * graph render at highlight brightness and highlight size: every node bloomed,
 * and the edges disappeared underneath them.
 */
const TIER_HIDDEN = 0
const TIER_DIMMED = 1
const TIER_CONTEXT = 2
const TIER_NORMAL = 3
const TIER_NEIGHBOUR = 4
const TIER_SELECTED = 5

/** Instance scale multiplier per tier. */
const TIER_SCALE = [0, 0.7, 0.8, 1.0, 1.2, 1.5]
/**
 * Colour multiplier per tier. The bloom threshold sits just under 1.0, so only
 * the two focus tiers cross it -- "highlighted" and "glowing" are one signal.
 */
const TIER_GAIN = [0, 0.26, 0.55, 0.95, 1.45, 2.1]

/**
 * Sphere tessellation by node count. Icosahedron detail 2 is 320 triangles,
 * detail 1 is 80, detail 0 is 20, so this keeps the whole graph inside a
 * bounded triangle budget instead of letting it grow with N. The thresholds
 * are set against how large a node is actually DRAWN: at the handful of
 * pixels a node occupies in a whole-graph view, detail 1 is already
 * indistinguishable from detail 2, and detail 2 is only worth its four-fold
 * cost on a small graph you are looking at up close.
 */
export function sphereDetail(nodeCount: number): number {
  if (nodeCount <= 800) return 2
  if (nodeCount <= 20_000) return 1
  return 0
}

export interface SceneCallbacks {
  onHover: (index: number | null, clientX: number, clientY: number) => void
  onSelect: (index: number | null) => void
  onExpand: (index: number) => void
  onStats: (fps: number, drawCalls: number) => void
}

export interface EffectSettings {
  bloom: boolean
  depthOfField: boolean
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

  private composer: EffectComposer | null = null
  private bloomPass: UnrealBloomPass | null = null
  private bokehPass: BokehPass | null = null
  private effects: EffectSettings = { bloom: true, depthOfField: false }

  private nodeGeometry: IcosahedronGeometry | null = null
  private readonly nodeMaterial: MeshLambertMaterial
  private nodes: InstancedMesh | null = null
  private edgeGeometry = new BufferGeometry()
  private lines: LineSegments | null = null
  private readonly edgeMaterial: LineBasicMaterial
  private readonly keyLight: DirectionalLight

  private model: Graph3DModel | null = null
  private positions = new Float32Array(0)
  private targetPositions = new Float32Array(0)
  private baseColors = new Float32Array(0)
  private baseSizes = new Float32Array(0)
  private tier = new Uint8Array(0)
  private visible: Uint8Array | null = null
  /** `null` renders every relationship type. */
  private relFilter: Set<string> | null = null
  private selected: number | null = null
  private hovered: number | null = null
  private contextHops = 2

  private readonly matrix = new Matrix4()
  private readonly scratchColor = new Color()
  private tween: Tween | null = null
  private raf = 0
  private disposed = false
  private lastPointer: { x: number; y: number } | null = null
  private pointerDirty = false
  private downAt: { x: number; y: number; t: number } | null = null
  private frames = 0
  private fpsSince = 0
  private settling = false
  private userEngaged = false

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container
    this.callbacks = callbacks

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    // Capped at 1.5, not 2: this scene is fill-bound (two full-screen-ish
    // passes of alpha-blended geometry plus, with bloom, five more), and on a
    // HiDPI display a device ratio of 2 doubles every one of them for a
    // difference nobody can see on a sphere a few pixels across.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
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

    // Soft, low-contrast lighting: a graph is read by colour and position, so
    // the shading is there to give the spheres volume, never to create dark
    // sides that hide a node's category colour. The key light is parented to
    // the camera so it always lights what you are looking at.
    this.scene.add(new AmbientLight(0xffffff, 1.15))
    this.scene.add(new HemisphereLight(0xa8c8ff, 0x20242e, 1.0))
    this.keyLight = new DirectionalLight(0xffffff, 1.5)
    this.keyLight.position.set(0.4, 0.8, 1)
    this.camera.add(this.keyLight)
    this.scene.add(this.camera)

    // Lambert, not Standard. A node here is a matte, uniformly coloured
    // sphere a few pixels across: physically-based shading buys a specular
    // response nobody can see at that size and costs a full PBR fragment
    // program per pixel. Measured on this environment's software rasterizer,
    // the same scene went from 2 fps (Standard) to a multiple of that
    // (Lambert) with no visible difference -- and the same fragment cost is
    // what an integrated GPU pays too.
    this.nodeMaterial = new MeshLambertMaterial({
      // Instance colours multiply this, and the tier gain pushes selected /
      // neighbour nodes above 1.0 -- which is exactly what the bloom pass
      // thresholds on, so "highlighted" and "glowing" are the same signal.
      color: 0xffffff,
      toneMapped: false,
      fog: true,
    })
    this.edgeMaterial = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      fog: true,
    })

    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: true })
    canvas.addEventListener('dblclick', this.onDoubleClick)
    this.buildComposer()
    this.loop(0)
  }

  private aspect(): number {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    return w / h
  }

  /**
   * (Re)build the post-processing chain for the current effect settings.
   *
   * Rebuilt rather than toggled because `BokehPass` allocates its own depth
   * render target; keeping a disabled one alive costs that memory for nothing.
   * With every effect off there is no composer at all and the scene renders
   * straight to the canvas -- one fewer full-screen blit.
   */
  private buildComposer(): void {
    this.composer?.dispose()
    this.composer = null
    this.bloomPass = null
    this.bokehPass = null
    if (!this.effects.bloom && !this.effects.depthOfField) return

    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const composer = new EffectComposer(this.renderer)
    composer.setPixelRatio(this.renderer.getPixelRatio())
    composer.setSize(w, h)
    composer.addPass(new RenderPass(this.scene, this.camera))
    if (this.effects.bloom) {
      // strength / radius / threshold. The threshold sits just under 1.0 so
      // ONLY tier-boosted (selected, neighbour) nodes and the additive edge
      // pile-up in dense regions bloom -- an unselected graph stays crisp.
      // Half resolution: bloom IS a blur, so running its five downsample /
      // upsample passes at half size is visually indistinguishable and a
      // quarter of the fill cost -- the single change that decides whether
      // this effect is affordable on an integrated GPU.
      this.bloomPass = new UnrealBloomPass(
        { x: w / 2, y: h / 2 } as unknown as ConstructorParameters<typeof UnrealBloomPass>[0],
        0.62,
        0.75,
        0.92,
      )
      composer.addPass(this.bloomPass)
    }
    if (this.effects.depthOfField) {
      this.bokehPass = new BokehPass(this.scene, this.camera, {
        focus: 400,
        aperture: 0.00035,
        maxblur: 0.006,
      })
      composer.addPass(this.bokehPass)
    }
    composer.addPass(new OutputPass())
    this.composer = composer
  }

  setEffects(effects: EffectSettings): void {
    if (effects.bloom === this.effects.bloom && effects.depthOfField === this.effects.depthOfField) {
      return
    }
    this.effects = { ...effects }
    this.buildComposer()
  }

  resize(): void {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.composer?.setSize(w, h)
    this.bloomPass?.setSize(w / 2, h / 2)
  }

  setBackground(cssColor: string): void {
    const color = new Color(cssColor)
    this.scene.background = color
    // Exponential fog in the SAME colour as the background: distant nodes fade
    // into the page rather than into a visible haze. The density is tuned
    // against `layout.worker.ts`'s canonical world radius (300), so it means
    // the same thing for every graph regardless of node count.
    this.scene.fog = new FogExp2(color.getHex(), 0.00085)
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on
  }

  /** How many hops of context the selection reveals (the spec's 1-2 default). */
  setContextHops(hops: number): void {
    this.contextHops = Math.max(1, Math.min(3, hops))
    this.applyState()
  }

  /** `null` renders every relationship type. */
  setRelationshipFilter(types: Set<string> | null): void {
    this.relFilter = types
    this.applyState()
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
    this.baseSizes = new Float32Array(n)
    this.tier = new Uint8Array(n)

    for (let i = 0; i < n; i += 1) {
      this.scratchColor.set(typeColors[model.typeIndex[i]] ?? '#8899aa')
      this.baseColors[i * 3] = this.scratchColor.r
      this.baseColors[i * 3 + 1] = this.scratchColor.g
      this.baseColors[i * 3 + 2] = this.scratchColor.b
      // sqrt(degree): a 200-edge hub reads as clearly bigger than a leaf
      // without becoming a planet that hides everything behind it. In the
      // canonical world units the layout normalizes to (radius 300).
      this.baseSizes[i] = 2.0 + 1.25 * Math.sqrt(model.degree[i] ?? 0)
    }

    if (this.nodes) {
      this.scene.remove(this.nodes)
      this.nodes.dispose()
    }
    this.nodeGeometry?.dispose()
    this.nodeGeometry = new IcosahedronGeometry(1, sphereDetail(n))
    this.nodes = new InstancedMesh(this.nodeGeometry, this.nodeMaterial, Math.max(n, 1))
    this.nodes.instanceMatrix.setUsage(DynamicDrawUsage)
    this.nodes.count = n
    // The bounding sphere is recomputed constantly while the layout settles,
    // and a stale one culls the whole graph away mid-animation.
    this.nodes.frustumCulled = false
    for (let i = 0; i < n; i += 1) {
      this.scratchColor.setRGB(this.baseColors[i * 3], this.baseColors[i * 3 + 1], this.baseColors[i * 3 + 2])
      this.nodes.setColorAt(i, this.scratchColor)
    }
    this.scene.add(this.nodes)

    this.edgeGeometry.dispose()
    this.edgeGeometry = new BufferGeometry()
    this.edgeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(model.edges.length * 6), 3))
    this.edgeGeometry.setAttribute('color', new BufferAttribute(new Float32Array(model.edges.length * 6), 3))
    if (this.lines) this.scene.remove(this.lines)
    this.lines = new LineSegments(this.edgeGeometry, this.edgeMaterial)
    this.lines.frustumCulled = false
    this.lines.renderOrder = -1
    this.scene.add(this.lines)

    this.selected = null
    this.hovered = null
    this.visible = null
    this.userEngaged = false
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
      this.writeInstances()
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

  /**
   * Recompute every node's tier and push the whole graph's instance matrices,
   * instance colours and edge buffers.
   *
   * Focus-plus-context: the focused node is `TIER_SELECTED`, its immediate
   * neighbours `TIER_NEIGHBOUR`, and -- when `contextHops >= 2` -- their
   * neighbours in turn are `TIER_CONTEXT`, a deliberately lighter, smaller
   * ring that says "there is more this way" without competing with the
   * first-degree answer. Everything else drops to `TIER_DIMMED`.
   */
  private applyState(): void {
    const model = this.model
    if (!model || !this.nodes) return
    const n = model.nodes.length
    const focus = this.selected ?? this.hovered

    if (focus == null) {
      this.tier.fill(TIER_NORMAL)
    } else {
      this.tier.fill(TIER_DIMMED)
      // BFS to `contextHops`, keeping the hop number as the tier.
      this.tier[focus] = TIER_SELECTED
      let frontier = [focus]
      for (let hop = 1; hop <= this.contextHops && frontier.length > 0; hop += 1) {
        const next: number[] = []
        const tierForHop = hop === 1 ? TIER_NEIGHBOUR : TIER_CONTEXT
        for (const node of frontier) {
          for (let k = model.adjOffset[node]; k < model.adjOffset[node + 1]; k += 1) {
            const nb = model.adjTarget[k]
            if (this.relFilter && !this.relFilter.has(model.edges[model.adjEdge[k]].r)) continue
            if (this.tier[nb] !== TIER_DIMMED) continue
            this.tier[nb] = tierForHop
            next.push(nb)
          }
        }
        frontier = next
      }
    }
    if (this.visible) {
      for (let i = 0; i < n; i += 1) if (this.visible[i] === 0) this.tier[i] = TIER_HIDDEN
    }

    this.writeInstances()
    this.writeEdges()
  }

  /** Push per-instance matrices and colours. One linear pass, no allocation. */
  private writeInstances(): void {
    const model = this.model
    if (!model || !this.nodes) return
    for (let i = 0; i < model.nodes.length; i += 1) {
      const tier = this.tier[i]
      const scale = this.baseSizes[i] * TIER_SCALE[tier]
      this.matrix.makeScale(scale, scale, scale)
      this.matrix.setPosition(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2])
      this.nodes.setMatrixAt(i, this.matrix)
      const gain = TIER_GAIN[tier]
      this.scratchColor.setRGB(
        this.baseColors[i * 3] * gain,
        this.baseColors[i * 3 + 1] * gain,
        this.baseColors[i * 3 + 2] * gain,
      )
      this.nodes.setColorAt(i, this.scratchColor)
    }
    this.nodes.instanceMatrix.needsUpdate = true
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true
  }

  /**
   * Rebuild the edge position + colour buffers. One linear pass over the edge
   * list with no allocation, which is why it can afford to run per-frame while
   * the layout is still moving.
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
      const edge = model.edges[e]
      const { s, t } = edge
      const o = e * 6
      posArray[o] = this.positions[s * 3]
      posArray[o + 1] = this.positions[s * 3 + 1]
      posArray[o + 2] = this.positions[s * 3 + 2]
      posArray[o + 3] = this.positions[t * 3]
      posArray[o + 4] = this.positions[t * 3 + 1]
      posArray[o + 5] = this.positions[t * 3 + 2]

      let gain: number
      if (
        this.tier[s] === TIER_HIDDEN ||
        this.tier[t] === TIER_HIDDEN ||
        (this.relFilter && !this.relFilter.has(edge.r))
      ) {
        gain = 0
      } else if (focus == null) {
        gain = 1.15
      } else if (s === focus || t === focus) {
        gain = 2.0
      } else if (this.tier[s] >= TIER_CONTEXT && this.tier[t] >= TIER_CONTEXT) {
        // The context ring's own edges: present, clearly secondary.
        gain = 0.3
      } else {
        gain = 0.05
      }

      // An edge takes its colour from its endpoints, so a relationship reads
      // as a gradient between the two types it connects.
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

  /** Frame the visible nodes: fit them, then glide there. */
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
    const distance = (radius * 2.1) / Math.tan((this.camera.fov * Math.PI) / 360)
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
    this.callbacks.onSelect(this.pick(event.clientX, event.clientY))
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
      if (this.tier[i] === TIER_HIDDEN) continue
      v.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2])
      v.project(this.camera)
      if (v.z < -1 || v.z > 1) continue
      const sx = (v.x * 0.5 + 0.5) * rect.width
      const sy = (-v.y * 0.5 + 0.5) * rect.height
      const d2 = (sx - px) * (sx - px) + (sy - py) * (sy - py)
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
      this.writeInstances()
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
    // Count draw calls for the WHOLE frame, post-processing included. Three's
    // default per-render reset would otherwise report only the composer's
    // last pass (1), which reads as "the graph costs one draw call" -- true
    // of the graph, false of the frame.
    this.renderer.info.autoReset = false
    this.renderer.info.reset()
    if (this.bokehPass) {
      // Focus on whatever the camera is orbiting, so depth of field always
      // agrees with what the viewer has centred rather than a fixed plane.
      const uniforms = this.bokehPass.materialBokeh.uniforms
      uniforms.focus.value = this.camera.position.distanceTo(this.controls.target)
    }
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)

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
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('wheel', this.onWheel)
    canvas.removeEventListener('dblclick', this.onDoubleClick)
    this.controls.dispose()
    this.composer?.dispose()
    this.nodes?.dispose()
    this.nodeGeometry?.dispose()
    this.nodeMaterial.dispose()
    this.edgeGeometry.dispose()
    this.edgeMaterial.dispose()
    this.renderer.dispose()
    canvas.remove()
  }
}
