/**
 * @file api.ts
 * @description Centralized API client for the Agent Web UI.
 *
 * Provides a standardized wrapper around the Fetch API for interacting with
 * the agent backend. Includes typing for request/response cycles and
 * uniform error handling via the ApiError class.
 */

import type { SavedWorkflow, WorkflowCapabilities, WorkflowCanvas, WorkflowRunResult } from './workflow'

/** Body accepted by `POST /workflows`. */
export interface SaveWorkflowPayload {
  name: string
  steps: string[]
  orchestrates: string[]
  canvas?: WorkflowCanvas
}

// ---------------------------------------------------------------------------
// Ontology (KG-2.x) — types shared between the api client adapters and the
// operator views (ObjectExplorerView / ObjectView / VertexView). The backend
// routes live under /api/enhanced/ontology/* in agent_webui/api_extensions.py
// and serialize raw ontology shapes (properties/derived as dicts, links as
// {out,in}, edits as the EditLedger model). The client methods below adapt
// those raw shapes into the view-facing shapes declared here so the views are
// genuinely live against the real routes.
// ---------------------------------------------------------------------------

/** A single ontology object summarized for an object-set table row. */
export interface OntologyObjectSummary {
  id: string
  type: string
  title?: string
  properties?: Record<string, unknown>
}

/** View-facing object-set result (search / search-around / pivot). */
export interface OntologyObjectSetResult {
  objects: OntologyObjectSummary[]
  total: number
  columns?: string[]
}

/** One aggregation bucket from the aggregate route. */
export interface OntologyAggregateBucket {
  key: string
  count: number
}

/** A typed value on an object (properties + derived share this shape). */
export interface OntologyPropertyValueDto {
  name: string
  title?: string
  value_type?: string
  value: unknown
  /** Present on derived values. */
  expression?: string
}

/** A link to another object, grouped under a link type. */
export interface OntologyLinkDto {
  link_type: string
  title?: string
  direction: 'out' | 'in'
  target_id: string
  target_type?: string
  target_title?: string
}

/** A recorded edit in an object's history. */
export interface OntologyEditDto {
  edit_id: string
  kind: string
  target?: string
  old_value?: unknown
  new_value?: unknown
  actor?: string
  timestamp: string
  reverted?: boolean
}

/** Full object payload consumed by ObjectView. */
export interface OntologyObjectDto {
  id: string
  object_type: string
  title?: string
  properties: OntologyPropertyValueDto[]
  derived: OntologyPropertyValueDto[]
  links: OntologyLinkDto[]
  markings: string[]
  history: OntologyEditDto[]
  layout?: { property_order?: string[]; link_order?: string[]; title?: string }
}

/** Request body for a single object edit. */
export interface OntologyEditRequestDto {
  kind: 'set_property' | 'add_link' | 'remove_link'
  target: string
  value?: unknown
}

/** Raw object-set envelope returned by the backend (`{ids, rows, count}`). */
interface RawObjectSet {
  ids?: string[]
  rows?: Record<string, unknown>[]
  count?: number
}

/** Raw aggregate envelope returned by the backend. */
interface RawAggregate {
  metric?: string
  field?: string | null
  group_by?: string | null
  groups?: Record<string, number>
  value?: number
  total_objects?: number
}

/** Raw full-object envelope returned by GET /ontology/object/{id}. */
interface RawObject {
  id: string
  object_type?: string | null
  properties?: Record<string, unknown>
  derived?: Record<string, unknown>
  links?: { out?: { type: string; target: string }[]; in?: { type: string; source: string }[] }
  markings?: string[]
  history?: Record<string, unknown>[]
  /** Layout mode marker ('standard' | 'configured') returned by the route. */
  layout?: string
  /** Resolved widget composition for the requested layout (configured/standard). */
  view?: { property_order?: string[]; link_order?: string[]; title?: string } & Record<string, unknown>
}

const ONTOLOGY_ROW_META = new Set(['id', 'type', '_type', 'object_type', 'title', 'name'])

/** Coerce an unknown value to a string, defaulting when not a string/number. */
function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

/** Coerce an unknown value to a finite number, defaulting when not numeric. */
function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number.parseFloat(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/** Turn a permission-enforced object-set row into a view summary. */
function toObjectSummary(row: Record<string, unknown>): OntologyObjectSummary {
  const id = asString(row.id)
  const type = asString(row.type ?? row._type ?? row.object_type, 'Object')
  const titleRaw = row.title ?? row.name
  const properties: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (!ONTOLOGY_ROW_META.has(k) && !k.startsWith('_')) properties[k] = v
  }
  return { id, type, title: typeof titleRaw === 'string' ? titleRaw : undefined, properties }
}

/** Adapt the raw `{ids, rows, count}` object-set envelope to the view shape. */
function adaptObjectSet(raw: RawObjectSet): OntologyObjectSetResult {
  const objects = (raw.rows ?? []).map(toObjectSummary)
  const columns = new Set<string>()
  for (const o of objects) for (const k of Object.keys(o.properties ?? {})) columns.add(k)
  return { objects, total: raw.count ?? objects.length, columns: Array.from(columns) }
}

/** Adapt the raw aggregate envelope into group-by buckets. */
function adaptAggregateBuckets(raw: RawAggregate): OntologyAggregateBucket[] {
  if (raw.groups && Object.keys(raw.groups).length > 0) {
    return Object.entries(raw.groups).map(([key, count]) => ({ key, count: asNumber(count) }))
  }
  return [{ key: raw.metric ?? 'count', count: asNumber(raw.value ?? raw.total_objects) }]
}

/** Adapt a single property/derived dict entry into a typed value DTO. */
function toPropertyValues(map: Record<string, unknown> | undefined): OntologyPropertyValueDto[] {
  if (!map) return []
  return Object.entries(map)
    .filter(([k]) => !k.startsWith('_'))
    .map(([name, value]) => {
      // Derived entries may already be `{name,value,expression,value_type}`.
      if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
        const v = value as Record<string, unknown>
        return {
          name,
          title: typeof v.title === 'string' ? v.title : undefined,
          value_type: typeof v.value_type === 'string' ? v.value_type : undefined,
          value: v.value,
          expression: typeof v.expression === 'string' ? v.expression : undefined,
        }
      }
      return { name, value }
    })
}

/** Adapt the raw `{out,in}` link map into a flat, directional link list. */
function toLinks(links: RawObject['links']): OntologyLinkDto[] {
  const out: OntologyLinkDto[] = []
  for (const l of links?.out ?? []) {
    out.push({ link_type: l.type, direction: 'out', target_id: l.target, target_title: l.target })
  }
  for (const l of links?.in ?? []) {
    out.push({ link_type: l.type, direction: 'in', target_id: l.source, target_title: l.source })
  }
  return out
}

const EDIT_KIND_LABEL: Record<string, string> = {
  property_set: 'set_property',
  link_add: 'add_link',
  link_remove: 'remove_link',
}

/** Adapt an EditLedger history entry into the timeline DTO. */
function toEdit(raw: Record<string, unknown>): OntologyEditDto {
  const before = (raw.before ?? {}) as Record<string, unknown>
  const after = (raw.after ?? {}) as Record<string, unknown>
  const target =
    (typeof raw.link_label === 'string' && raw.link_label) ||
    Object.keys(after)[0] ||
    Object.keys(before)[0] ||
    undefined
  const ts = raw.timestamp
  const timestamp =
    typeof ts === 'number' ? new Date(ts * 1000).toISOString() : typeof ts === 'string' ? ts : new Date().toISOString()
  const editType = asString(raw.edit_type, 'edit')
  return {
    edit_id: asString(raw.id),
    kind: EDIT_KIND_LABEL[editType] ?? editType,
    target,
    old_value: target ? before[target] : undefined,
    new_value: target ? after[target] : undefined,
    actor: typeof raw.actor === 'string' ? raw.actor : undefined,
    timestamp,
  }
}

/** Adapt the full raw object payload into the ObjectView DTO. */
function adaptObject(raw: RawObject): OntologyObjectDto {
  const props = raw.properties ?? {}
  const title =
    (typeof props.title === 'string' && props.title) || (typeof props.name === 'string' && props.name) || undefined
  const view = raw.view
  const layout =
    view && (view.property_order || view.link_order || typeof view.title === 'string')
      ? {
          property_order: Array.isArray(view.property_order) ? view.property_order : undefined,
          link_order: Array.isArray(view.link_order) ? view.link_order : undefined,
          title: typeof view.title === 'string' ? view.title : undefined,
        }
      : undefined
  return {
    id: raw.id,
    object_type: asString(raw.object_type ?? props.type, 'Object'),
    title,
    properties: toPropertyValues(raw.properties),
    derived: toPropertyValues(raw.derived),
    links: toLinks(raw.links),
    markings: raw.markings ?? [],
    history: (raw.history ?? []).map(toEdit),
    layout,
  }
}

/** Map a view edit-request `kind` to the backend `edit_type`. */
const EDIT_TYPE_FROM_KIND: Record<OntologyEditRequestDto['kind'], string> = {
  set_property: 'property_set',
  add_link: 'link_add',
  remove_link: 'link_remove',
}

/**
 * Custom error class for API-related failures
 */
export class ApiError extends Error {
  /** HTTP status code */
  public status: number
  /** Raw response body text */
  public body: string

  /**
   * @param status - HTTP response status code
   * @param body - Diagnostic message or raw body content from the server
   */
  constructor(status: number, body: string) {
    super(`API ${status}: ${body}`)
    this.status = status
    this.body = body
    this.name = 'ApiError'
  }
}

/** One action+observation step in a SWE run's KG provenance (OS-5.34). */
export interface SweProvenanceAction {
  id: string
  kind: string
  step: number
  summary: string
  obs_kind?: string
  obs_summary?: string
}

/** A (workspace-action -> Code symbol) MUTATED edge from the provenance graph (KG-2.64). */
export interface SweMutatedEdge {
  action_id: string
  symbol_id: string
}

/** Aggregate SWE-bench report (AHE-3.22). */
export interface SweBenchReport {
  total: number
  resolved: number
  unresolved: number
  resolved_rate: number
  by_repo: Record<string, { total: number; resolved: number }>
  instances: { instance_id: string; repo: string; resolved: boolean; error: string }[]
}

/**
 * Internal API client implementation
 */
class ApiClient {
  private baseUrl: string

  /**
   * @param baseUrl - The base URL for all requests (defaults to local origin)
   */
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl
  }

  /**
   * Performs a GET request and returns the parsed JSON response
   */
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`)
    if (!res.ok) {
      const body = await res.text().catch(() => 'Unknown error')
      throw new ApiError(res.status, body)
    }
    return res.json() as Promise<T>
  }

  /**
   * Performs a POST request with JSON body and returns the parsed JSON response
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error')
      throw new ApiError(res.status, text)
    }
    return res.json() as Promise<T>
  }

  /**
   * Performs a DELETE request
   */
  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.text().catch(() => 'Unknown error')
      throw new ApiError(res.status, body)
    }
  }

  // SDD Methods
  getConstitution = () => this.get<any>('/api/enhanced/sdd/constitution')
  saveConstitution = (data: any) => this.post<any>('/api/enhanced/sdd/constitution', data)
  listSpecs = () => this.get<any[]>('/api/enhanced/sdd/specs')
  createSpec = (data: any) => this.post<any>('/api/enhanced/sdd/spec', data)
  listPlans = () => this.get<any[]>('/api/enhanced/sdd/plans')
  getTasks = (planId: string) => this.get<{ tasks: any[] }>(`/api/enhanced/sdd/tasks?plan_id=${planId}`)
  syncSDDToMemory = (data: any) => this.post<any>('/api/enhanced/sdd/sync', data)

  // SWE Developer-Workspace Runtime (OS-5.33 / ORCH-1.46) + SWE-bench (AHE-3.22)
  createSweSession = (body?: { prefer_docker?: boolean; image?: string; actor?: string }) =>
    this.post<{ session_id: string; backend: string; workdir: string }>('/api/runtime/sessions', body ?? {})
  sweAct = (sid: string, action: Record<string, unknown>) =>
    this.post<Record<string, unknown>>(`/api/runtime/sessions/${sid}/act`, action)
  sweStatus = (sid: string) =>
    this.get<{ session_id: string; backend: string; cwd: string; steps: number }>(`/api/runtime/sessions/${sid}`)
  sweProvenance = (sid: string) =>
    this.get<{ run_id: string; actions: SweProvenanceAction[]; mutated: SweMutatedEdge[] }>(
      `/api/runtime/sessions/${sid}/provenance`,
    )
  stopSweSession = (sid: string) => this.delete(`/api/runtime/sessions/${sid}`)
  /** SSE endpoint for the live action/observation event log (consumed via EventSource). */
  sweEventsUrl = (sid: string) => `${this.baseUrl}/api/runtime/sessions/${sid}/events`
  runSweBench = (body: { instances: unknown[]; ingest?: boolean; remediate?: boolean }) =>
    this.post<{ run_id: string; report: SweBenchReport; remediation: unknown }>('/api/swebench/run', body)

  // Memory Methods
  getGraphNodes = (type?: string) => this.get<any[]>(`/api/enhanced/graph/nodes${type ? `?node_type=${type}` : ''}`)
  addMemory = (data: any) => this.post<any>('/api/enhanced/graph/memory', data)
  updateMemory = (id: string, data: any) => this.post<any>(`/api/enhanced/graph/memory/${id}`, data) // Using POST for update based on test mock or component? Actually component uses PUT.
  deleteMemory = (id: string) => this.delete(`/api/enhanced/graph/memory/${id}`)

  // Knowledge Base Methods
  listKnowledgeBases = () => this.get<any[]>('/api/enhanced/kb')
  searchKnowledgeBase = (id: string, query: string) => this.get<any[]>(`/api/enhanced/kb/${id}/search?q=${query}`)
  getKBArticle = (kbId: string, articleId: string) => this.get<any>(`/api/enhanced/kb/${kbId}/article/${articleId}`)
  ingestKnowledgeBase = (data: any) => this.post<any>('/api/enhanced/kb/ingest', data)
  runKBHealthCheck = (id: string) => this.get<any>(`/api/enhanced/kb/${id}/health`)

  // Graph Methods
  getGraphStats = () => this.get<any>('/api/enhanced/graph/stats')
  getGraphRelationships = () => this.get<any[]>('/api/enhanced/graph/relationships')

  // Document → knowledge-graph fact extraction (ECO-4.43; KG-2.64/2.65/2.66)
  submitExtraction = (payload: {
    text?: string
    url?: string
    rounds?: number
    dedup?: boolean
    dedup_field?: string
    dedup_threshold?: number
  }) => this.post<{ status: string; job_id?: string; message?: string }>(
    '/api/enhanced/extract/submit',
    payload,
  )
  listExtractionJobs = () => this.get<{ status: string; jobs: any[] }>('/api/enhanced/extract/jobs')
  getExtractionStatus = (jobId: string) =>
    this.get<any>(`/api/enhanced/extract/status/${encodeURIComponent(jobId)}`)
  pauseExtraction = (jobId: string) =>
    this.post<any>(`/api/enhanced/extract/pause/${encodeURIComponent(jobId)}`, {})
  resumeExtraction = (jobId: string) =>
    this.post<any>(`/api/enhanced/extract/resume/${encodeURIComponent(jobId)}`, {})
  /** SSE URL for streaming a job's extraction events (round_start|fact|…|job_done). */
  extractionStreamUrl = (jobId: string) =>
    `${this.baseUrl}/api/enhanced/extract/stream/${encodeURIComponent(jobId)}`
  /** Download URL for a job's facts as JSONL (upstream parity). */
  extractionJsonlUrl = (jobId: string) =>
    `${this.baseUrl}/api/enhanced/extract/jsonl/${encodeURIComponent(jobId)}`

  // Workflow Editor Methods (D9 — visual workflow editor)
  listWorkflowCapabilities = () => this.get<WorkflowCapabilities>('/api/enhanced/workflows/capabilities')
  listWorkflows = () => this.get<SavedWorkflow[]>('/api/enhanced/workflows')
  saveWorkflow = (payload: SaveWorkflowPayload) =>
    this.post<{ id: string; saved: boolean }>('/api/enhanced/workflows', payload)
  runWorkflow = (id: string) => this.post<WorkflowRunResult>(`/api/enhanced/workflows/${encodeURIComponent(id)}/run`)

  // -------------------------------------------------------------------------
  // Ontology metadata (KG-2.38 / KG-2.47) — registry surfaces.
  // -------------------------------------------------------------------------
  listObjectTypes = () =>
    this.get<{ name: string; implements: string[]; count: number }[]>('/api/enhanced/ontology/object-types')
  listPropertyTypes = () => this.get<Record<string, unknown>[]>('/api/enhanced/ontology/property-types')
  listInterfaces = () => this.get<Record<string, unknown>[]>('/api/enhanced/ontology/interfaces')
  getInterfaceImplementers = (name: string) =>
    this.get<{ interface: string; implementers: string[] }>(
      `/api/enhanced/ontology/interfaces/${encodeURIComponent(name)}/implementers`,
    )

  // -------------------------------------------------------------------------
  // Object-set surface (ObjectExplorerView). Adapts the backend's raw
  // `{ids, rows, count}` / aggregate envelopes into the view-facing shapes.
  // -------------------------------------------------------------------------
  /** Faceted/full-text search. `payload`: {query, object_type, filters}. */
  ontologySearch = async (payload: {
    query?: string
    object_type?: string
    filters?: { property: string; op: string; value: unknown }[]
  }): Promise<OntologyObjectSetResult> => {
    const raw = await this.post<RawObjectSet>('/api/enhanced/ontology/object-set/search', {
      query: payload.query ?? '',
      kind: payload.object_type,
      filters: payload.filters ?? [],
    })
    return adaptObjectSet(raw)
  }

  /** Traverse a typed link from a selected id set to related objects. */
  ontologySearchAround = async (payload: {
    ids: string[]
    link_type?: string
    hops?: number
    direction?: 'in' | 'out' | 'both'
  }): Promise<OntologyObjectSetResult> => {
    const raw = await this.post<RawObjectSet>('/api/enhanced/ontology/object-set/search-around', {
      ids: payload.ids,
      link_type: payload.link_type,
      hops: payload.hops ?? 1,
      direction: payload.direction ?? 'out',
    })
    return adaptObjectSet(raw)
  }

  /** Pivot the current set across a link type, grouping the linked set. */
  ontologyPivot = async (payload: {
    ids?: string[]
    link_type?: string
    group_by?: string
  }): Promise<OntologyObjectSetResult> => {
    const raw = await this.post<{ groups?: Record<string, string[]> }>('/api/enhanced/ontology/object-set/pivot', {
      ids: payload.ids ?? [],
      link_type: payload.link_type,
      group_by: payload.group_by ?? 'type',
    })
    // Pivot returns grouped target-id buckets; surface them as summary rows.
    const objects: OntologyObjectSummary[] = []
    for (const [group, ids] of Object.entries(raw.groups ?? {})) {
      for (const id of ids) objects.push({ id, type: group, properties: {} })
    }
    return { objects, total: objects.length, columns: [] }
  }

  /** Group-by aggregate over the current object set. */
  ontologyAggregate = async (payload: {
    ids?: string[]
    group_by?: string
    metric?: string
    field?: string
  }): Promise<OntologyAggregateBucket[]> => {
    const raw = await this.post<RawAggregate>('/api/enhanced/ontology/object-set/aggregate', {
      ids: payload.ids ?? [],
      group_by: payload.group_by,
      metric: payload.metric ?? 'count',
      field: payload.field,
    })
    return adaptAggregateBuckets(raw)
  }

  /**
   * Persist the current object set (resolved spec) as a durable, optionally
   * shared saved set. `payload`: {name, ids|filters|query, kind?, shared?}.
   * Backs POST /ontology/object-set/save.
   */
  ontologySaveObjectSet = (payload: {
    name: string
    ids?: string[]
    query?: string
    object_type?: string
    filters?: { property: string; op: string; value: unknown }[]
    shared?: boolean
  }) => {
    // The backend resolves the type facet under `kind` (same as ontologySearch);
    // map object_type -> kind so a saved set narrows to the right type.
    return this.post<{ id: string; name: string; count: number; kind?: string }>(
      '/api/enhanced/ontology/object-set/save',
      {
        name: payload.name,
        ids: payload.ids,
        query: payload.query,
        kind: payload.object_type,
        filters: payload.filters,
        shared: payload.shared,
      },
    )
  }

  /** List the saved object sets visible to the caller. */
  listSavedObjectSets = async (): Promise<
    { id: string; name: string; count: number; kind?: string; shared?: boolean }[]
  > => {
    // The backend envelopes the list as `{sets, count}`; surface the rows.
    const raw = await this.get<{
      sets?: { id: string; name: string; count: number; kind?: string; shared?: boolean }[]
    }>('/api/enhanced/ontology/object-set/list')
    return raw.sets ?? []
  }

  /**
   * List the REAL registered ontology actions, optionally scoped to an object
   * type. Backs the Object Explorer bulk-action menu so only genuinely
   * registered, executor-routed actions are offered. `object_type` narrows the
   * list to actions whose `acts_on` covers that type.
   */
  listOntologyActions = (objectType?: string) =>
    this.get<
      {
        name: string
        verb: string
        description: string
        produces_effect: string
        required_capability: string
        acts_on: string[]
      }[]
    >(`/api/enhanced/ontology/actions${objectType ? `?object_type=${encodeURIComponent(objectType)}` : ''}`)

  /**
   * Run a governed bulk action over a set of object ids. `payload`:
   * {ids, action_name, params?, approve?}. Backs POST /ontology/object-set/action.
   * The backend route reads `action_name`, so this is sent verbatim.
   */
  ontologyObjectSetAction = (payload: {
    ids: string[]
    action_name: string
    params?: Record<string, unknown>
    approve?: unknown
  }) =>
    this.post<{
      applied: number
      results: { id: string; status: string; edit_ids: string[] }[]
      errors: unknown[]
    }>('/api/enhanced/ontology/object-set/action', payload)

  // -------------------------------------------------------------------------
  // Single-object surface (ObjectView). Adapts the raw object payload into the
  // properties[]/derived[]/links[]/history[] shape the view renders.
  // -------------------------------------------------------------------------
  getOntologyObject = async (id: string, layout?: 'standard' | 'configured'): Promise<OntologyObjectDto> => {
    const qs = layout ? `?layout=${encodeURIComponent(layout)}` : ''
    const raw = await this.get<RawObject>(`/api/enhanced/ontology/object/${encodeURIComponent(id)}${qs}`)
    return adaptObject(raw)
  }

  editOntologyObject = async (id: string, req: OntologyEditRequestDto): Promise<{ edit_id: string }> => {
    const body: Record<string, unknown> = { edit_type: EDIT_TYPE_FROM_KIND[req.kind] }
    if (req.kind === 'set_property') {
      body.property = req.target
      body.value = req.value
    } else {
      body.link_type = req.target
      body.target = req.value
    }
    const raw = await this.post<{ edit?: { id?: string } }>(
      `/api/enhanced/ontology/object/${encodeURIComponent(id)}/edit`,
      body,
    )
    return { edit_id: raw.edit?.id ?? '' }
  }

  revertOntologyEdit = async (id: string, editId: string): Promise<{ reverted: boolean }> => {
    await this.post(`/api/enhanced/ontology/object/${encodeURIComponent(id)}/revert`, { edit_id: editId })
    return { reverted: true }
  }

  // -------------------------------------------------------------------------
  // Function / derive / document surfaces.
  // -------------------------------------------------------------------------
  invokeOntologyFunction = (payload: { name: string; version?: string; params?: Record<string, unknown> }) =>
    this.post<Record<string, unknown>>('/api/enhanced/ontology/function/invoke', payload)

  /** Compute a single derived property for an object. */
  deriveOntologyProperty = (payload: { object_id: string; derived_name: string; object_type?: string }) =>
    this.post<Record<string, unknown>>('/api/enhanced/ontology/derive', payload)

  processOntologyDocument = (payload: Record<string, unknown>) =>
    this.post<Record<string, unknown>>('/api/enhanced/ontology/document/process', payload)

  getOntologyObjectView = (type: string) =>
    this.get<Record<string, unknown>>(`/api/enhanced/ontology/object-view/${encodeURIComponent(type)}`)
  saveOntologyObjectView = (type: string, layout: unknown) =>
    this.post<Record<string, unknown>>(`/api/enhanced/ontology/object-view/${encodeURIComponent(type)}`, layout)

  // Fleet supervisory plane (CONCEPT:OS-5.10) — swarm health, topology,
  // emergency containment, and the mutation/risk approval queue.
  getFleetHealth = () => this.get<FleetHealth>('/api/fleet/health')
  getFleetTopology = () => this.get<FleetTopology>('/api/fleet/topology')
  pauseFleet = (target: { domain?: string; session_ids?: string[] }) =>
    this.post<FleetActionResult>('/api/fleet/pause', target)
  killFleet = (target: { domain?: string; session_ids?: string[] }) =>
    this.post<FleetActionResult>('/api/fleet/kill', target)
  getFleetApprovals = () => this.get<{ pending: unknown[] }>('/api/fleet/approvals')
  grantFleetApproval = (job_id: string, decision: string) =>
    this.post<unknown>('/api/fleet/approvals/grant', { job_id, decision })

  // Usage / cost / observability (CONCEPT:ECO-4.41) — assimilated agentsview.
  // One surface over both ingested agent logs and our own runtime telemetry.
  private obs<T>(path: string, filters?: UsageFilters): Promise<T> {
    const qs = filters
      ? '?' +
        Object.entries(filters)
          .filter(([, v]) => v !== undefined && v !== '' && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : ''
    return this.get<T>(`/api/observability${path}${qs}`)
  }
  getUsageSummary = (f?: UsageFilters) => this.obs<UsageSummary>('/summary', f)
  getUsageByModel = (f?: UsageFilters) => this.obs<UsageBreakdown[]>('/by-model', f)
  getUsageByProject = (f?: UsageFilters) => this.obs<UsageBreakdown[]>('/by-project', f)
  getUsageByAgent = (f?: UsageFilters) => this.obs<UsageBreakdown[]>('/by-agent', f)
  getUsageTools = (f?: UsageFilters) => this.obs<UsageToolStat[]>('/analytics/tools', f)
  getUsageActivity = (f?: UsageFilters) => this.obs<UsageActivityCell[]>('/analytics/activity', f)
  getUsageSessionShape = (f?: UsageFilters) => this.obs<UsageSessionShape>('/analytics/session-shape', f)
  getUsageTopSessions = (f?: UsageFilters) => this.obs<UsageSessionRow[]>('/top-sessions', f)
  getUsageSessions = (f?: UsageFilters) => this.obs<UsageSessionRow[]>('/sessions', f)
  getUsageSessionDetail = (id: string) =>
    this.get<UsageSessionDetail>(`/api/observability/sessions/${encodeURIComponent(id)}`)
  getUsageSearch = (q: string) => this.get<UsageSearchHit[]>(`/api/observability/search?q=${encodeURIComponent(q)}`)
  getUsageTraces = () => this.get<UsageTraces>('/api/observability/traces')
}

export interface UsageFilters {
  from?: string
  to?: string
  project?: string
  agent?: string
  model?: string
  origin?: string
  tenant_id?: string
  limit?: number
}
export interface UsageSummary {
  session_count: number
  totals: {
    input_tokens: number
    output_tokens: number
    cache_creation_tokens: number
    cache_read_tokens: number
    reasoning_tokens: number
    cost_usd: number
  }
  cache_hit_rate: number
}
export interface UsageBreakdown {
  key: string
  session_count: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
}
export interface UsageToolStat {
  name: string
  category: string
  calls: number
  success: number
  success_rate: number
}
export interface UsageActivityCell {
  day_of_week: number
  hour: number
  sessions: number
  cost_usd: number
}
export interface UsageSessionShape {
  total: number
  shapes: Record<string, number>
}
export interface UsageSessionRow {
  id: string
  project: string
  agent: string
  started_at?: string
  ended_at?: string
  message_count: number
  total_output_tokens: number
  cost_usd: number
  health_grade?: string
  outcome: string
  origin: string
}
export interface UsageSessionDetail {
  session: UsageSessionRow
  messages: Array<{
    ordinal: number
    role: string
    content: string
    model: string
    context_tokens: number
    output_tokens: number
    has_tool_use: boolean
  }>
  tool_calls: Array<{
    message_ordinal?: number
    tool_name: string
    category: string
    skill_name?: string
    status: string
  }>
  usage_events: Array<{ model: string; input_tokens: number; output_tokens: number; cost_usd?: number }>
}
export interface UsageSearchHit {
  session_id: string
  ordinal: number
  role: string
  snippet: string
  project: string
  agent: string
}
export interface UsageTraces {
  enabled: boolean
  host: string
  traces: Array<{ session_id: string; project: string; url: string }>
}

export interface FleetDomainHealth {
  total: number
  active: number
  errored: number
  error_rate: number
}
export interface FleetHealth {
  generated_at: number
  sessions: { total: number; by_status: Record<string, number> }
  goals: { active: number; tracked: number }
  domains: Record<string, FleetDomainHealth>
}
export interface FleetTopologySession {
  id: string
  status: string
  background: boolean
  needs_input: boolean
  updated_at: number
}
export interface FleetTopology {
  domains: { domain: string; sessions: FleetTopologySession[] }[]
  goals: unknown[]
  totals: { domains: number; sessions: number }
}
export interface FleetActionResult {
  status: string
  action: string
  affected: string[]
  count: number
}

/**
 * Singleton API client instance for application-wide use
 */
export const api = new ApiClient()
