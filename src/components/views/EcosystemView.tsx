import { useState, useEffect, type SyntheticEvent } from 'react'
import {
  Network,
  Server,
  Cpu,
  HardDrive,
  Terminal,
  GitPullRequest,
  RefreshCw,
  BarChart2,
  Flame,
  Heart,
  Plus,
  Check,
  Calendar,
  Activity,
  Database,
  LayoutGrid,
  Layers,
  GitBranch,
  GitMerge,
  Sliders,
  Mail,
  Download,
  Compass,
  Search,
  FileText,
  AlertTriangle,
  Loader2,
  Lock,
} from 'lucide-react'
import { z } from 'zod'
import { validateShape, looseArray } from '@/lib/api-validation'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'

interface Host {
  reference: string
  status: string
  port_configured: boolean
  identity_configured: boolean
  password_configured: boolean
}

interface SystemResources {
  cpu_percent: number
  memory: {
    percent: number
    used_gb: number
    total_gb: number
  }
  disk: {
    percent: number
    used_gb: number
    total_gb: number
  }
}

interface ProcessInfo {
  reference: string
  cpu: number
  memory: number
}

// D-WUI-9: /api/enhanced/systems-manager/processes can answer null/{}
// instead of an array (cold cache, degraded backend). The old raw cast
// accepted it as `ProcessInfo[]`, so the unconditional `processes.filter(...)`
// computed on every render crashed with "processes.filter is not a
// function" (or "Cannot read properties of null (reading 'filter')").
const processInfoListSchema = looseArray(
  z.object({
    reference: z.string(),
    cpu: z.number(),
    memory: z.number(),
  }),
)

// Same defect shape, same file, sibling endpoint: `resources?.memory.percent`
// only guards `resources` itself (matching its `SystemResources | null`
// state type) -- an empty-object response cast straight into that state
// crashes on `.memory`/`.disk` being undefined. Validate instead of casting;
// on a shape violation `fetchSystems` falls back to leaving `resources` at
// its safe `null` default (the UI already renders placeholder figures then).
const systemResourcesSchema: z.ZodType<SystemResources> = z.object({
  cpu_percent: z.number(),
  memory: z.object({ percent: z.number(), used_gb: z.number(), total_gb: z.number() }),
  disk: z.object({ percent: z.number(), used_gb: z.number(), total_gb: z.number() }),
})

interface ContainerInfo {
  reference: string
  state: string
}

interface RepoInfo {
  reference: string
  label: string
  branch_state: string
  modified_count: number
  status: string
}

// Additional Interfaces for the 14 new services
interface KanbanIssue {
  id: string
  title: string
  priority: string
  assignee: string
}

interface KanbanColumn {
  id: string
  title: string
  issues: KanbanIssue[]
}

// BUG-012 (GOC-27-W01/W05): these four interfaces plus the
// `*ItemSchema`s below them are the WebUI-side half of the GitHub/GitLab
// contract-mismatch fix. Two concrete drifts were found and fixed:
//   - `GithubPr.checks` had no backend data source at all (the pulls/list
//     payload carries no per-check-run summary) -- removed, matching the
//     `GitlabPipeline.duration?` precedent below it.
//   - `GithubWorkflow.run_number` DOES exist upstream but
//     `get_github_prs`'s run mapping (`api_extensions.py`) was dropping it
//     before it ever reached this file -- fixed there; typed here as
//     nullable so a future regression degrades visibly instead of
//     re-fabricating a value.
// `web_url`/`project_id` were already returned by the backend and simply
// never modeled here -- added so the normalized envelope's required
// `source.url` has somewhere to come from.
interface GithubPr {
  id: number
  title: string
  author: string | null
  branch: string | null
  status: string
  web_url: string | null
}

interface GithubWorkflow {
  id: number | null
  name: string | null
  status: string | null
  conclusion: string | null
  run_number: number | null
}

interface GitlabMr {
  id: number
  project_id: number | null
  title: string
  author: string | null
  target_branch: string
  status: string
  web_url: string | null
}

interface GitlabPipeline {
  id: number
  project_id: number | null
  ref: string
  status: string
  // The backend (`get_gitlab_mrs` in api_extensions.py) does not report a
  // duration for a pipeline -- GitLab's `/pipelines` list endpoint doesn't
  // include it either. Optional so the UI never renders a fabricated value.
  duration?: string
}

const githubPrItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  author: z.string().nullable(),
  branch: z.string().nullable(),
  status: z.string(),
  web_url: z.string().nullable(),
})

const githubWorkflowItemSchema = z.object({
  id: z.number().nullable(),
  name: z.string().nullable(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  run_number: z.number().nullable(),
})

const gitlabMrItemSchema = z.object({
  id: z.number(),
  project_id: z.number().nullable(),
  title: z.string(),
  author: z.string().nullable(),
  target_branch: z.string(),
  status: z.string(),
  web_url: z.string().nullable(),
})

const gitlabPipelineItemSchema = z.object({
  id: z.number(),
  project_id: z.number().nullable(),
  ref: z.string(),
  status: z.string(),
  duration: z.string().optional(),
})

// `web_url` reaches this endpoint through `_public_external_result`
// (`agent_webui/api_extensions.py`), which runs every governed delegation
// result through `sanitize_for_persistence` -- and that sanitizer
// blanket-redacts ANY field literally named `web_url`/`html_url`/`url`/etc
// to the fixed string `"[REDACTED_LOCATION]"` regardless of content,
// including a genuinely public GitHub/GitLab source link
// (`agent_utilities/security/persistence_privacy.py`'s `_LOCATION_FIELDS`).
// Resolving that policy tension (an allowlist for known-public source
// links) is `GOC-27-W06` scope, owned by security review, not this fix --
// so render a link only when the value actually looks like one, rather
// than ever pointing an `<a href>` at the redaction placeholder.
function isRenderableUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && (value.startsWith('https://') || value.startsWith('http://'))
}

interface PortainerStack {
  name: string
  services: number
  status: string
  type: string
}

// D-WUI-BUG-008: the previous `TrainingMetrics` shape (hyperparameters, a
// live epoch counter, a per-epoch loss curve) never matched what
// `GET /api/enhanced/ecosystem/datascience/training` actually returns.
// `data-science-mcp`'s `rank_models` reports each *already-fitted* model's
// stored test R^2 -- there is no live epoch/loss stream. Rendering the old
// shape against the real response either crashed (`.hyperparameters` is
// undefined) or, worse, silently kept whatever fabricated card was already
// on screen. `TrainedModel` matches the real backend record exactly; see
// `agent/agent_webui/api_extensions.py:get_datascience_training` and
// `data_science_mcp/ml_engine.py:ranked_models`.
interface TrainedModel {
  model_id: string
  dataset: string
  model_str: string
  r2_test: number
}

// D-WUI-BUG-008: production truthful-state machinery. Every ecosystem/system
// fetch below classifies its response into one of these instead of letting
// an error or "no backend" response collapse into an empty array/`0` that
// renders indistinguishably from real empty data. See
// `ServiceNotice`/`classifyEcosystemList` and
// designs/BUG-REMEDIATION-DESIGNS.md#bug-008.
type EcoStatus = 'loading' | 'ready' | 'empty' | 'unavailable' | 'error'

interface EcoState {
  status: EcoStatus
  reason?: string
}

const LOADING_STATE: EcoState = { status: 'loading' }

/**
 * Classify one `/api/enhanced/ecosystem/*` (or similarly enveloped) JSON
 * body into a truthful {@link EcoState} plus the list it carries under
 * `key`. The backend envelope (`agent/agent_webui/api_extensions.py`) is
 * `status: 'success' | 'error' | 'capability_unavailable' | 'needs_input'`
 * with a human `detail` reason on every non-success status. A response that
 * doesn't carry a recognizable envelope is never treated as "empty" -- an
 * unrecognized shape is reported as an error, not silently swallowed.
 */
// Every call site names its own item shape
// (`classifyEcosystemList<KanbanColumn>(...)`) for a compile-time label on
// a field this helper cannot itself validate WITHOUT an `itemSchema` (the
// backend envelope carries no per-array schema of its own). This mirrors
// the existing `as ContainerInfo[]`/`as RepoInfo[]` casts elsewhere in this
// file; a full runtime schema per ecosystem list (every domain, not just
// GitHub/GitLab) is `GOC-28-W02` scope, not this lane's -- but when a
// caller DOES pass `itemSchema` (BUG-012's GitHub/GitLab call sites do), a
// per-field drift is a typed, diagnosable `error` state instead of a value
// silently reaching the render as `undefined`.
/** The three envelope statuses that resolve to a fixed `EcoState` without
 * looking at the item list at all. Returns null for 'success' and for any
 * unrecognized status, both of which the caller handles separately. */
function classifyKnownEnvelopeStatus(status: unknown, reason: string | undefined): EcoState | null {
  if (status === 'capability_unavailable') {
    return { status: 'unavailable', reason: reason ?? 'No backend is wired for this capability.' }
  }
  if (status === 'needs_input') {
    return { status: 'unavailable', reason: reason ?? 'Additional input is required.' }
  }
  if (status === 'error') {
    return { status: 'error', reason: reason ?? 'The service reported an error.' }
  }
  return null
}

function classifyEcosystemList<T>(
  json: unknown,
  key: string,
  itemSchema?: z.ZodType<T>,
): { state: EcoState; items: T[] } {
  if (!json || typeof json !== 'object') {
    return { state: { status: 'error', reason: 'The backend returned a malformed response.' }, items: [] }
  }
  const obj = json as Record<string, unknown>
  const rawItems = Array.isArray(obj[key]) ? obj[key] : []
  const reason = typeof obj.detail === 'string' ? obj.detail : undefined

  const withValidatedItems = (): { state: EcoState; items: T[] } => {
    if (!itemSchema) {
      const items = rawItems as T[]
      return { state: { status: items.length > 0 ? 'ready' : 'empty' }, items }
    }
    const parsed = z.array(itemSchema).safeParse(rawItems)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return {
        state: {
          status: 'error',
          reason: `Backend '${key}' response does not match the expected schema at '${path}': ${issue.message}.`,
        },
        items: [],
      }
    }
    return { state: { status: parsed.data.length > 0 ? 'ready' : 'empty' }, items: parsed.data }
  }

  const knownState = classifyKnownEnvelopeStatus(obj.status, reason)
  if (knownState) return { state: knownState, items: [] }
  if (obj.status === 'success') return withValidatedItems()

  // Unrecognized envelope shape. If it happens to carry a real-looking
  // array, surface it rather than discard real data -- but never invent
  // a "ready, empty" state for a contract we don't understand.
  return rawItems.length > 0
    ? withValidatedItems()
    : { state: { status: 'error', reason: 'Unexpected response shape from the backend.' }, items: [] }
}

/**
 * Read one `/api/enhanced/ecosystem/*` response body honestly, whether the
 * HTTP call succeeded or not. A non-2xx response is normalized into the same
 * `{status: 'error', detail}` envelope `classifyEcosystemList` expects, so
 * every call site has exactly one path to classify through -- there is no
 * second "the fetch failed" branch that quietly renders nothing.
 */
async function readEcosystemResponse(res: Response): Promise<unknown> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (res.ok) return body
  const detail =
    body && typeof body === 'object' && typeof (body as Record<string, unknown>).detail === 'string'
      ? (body as Record<string, unknown>).detail
      : `HTTP ${res.status}`
  return { status: 'error', detail }
}

/**
 * Truthful placeholder for a section that is `loading`, `empty`,
 * `unavailable`, or `error`. Renders nothing once `status === 'ready'` --
 * the caller is responsible for rendering the real data in that case. Never
 * renders `0`, `[]`, or a green/success indicator for `unavailable`/`error`.
 */
function ServiceNotice({ state, emptyLabel = 'No data reported.' }: { state: EcoState; emptyLabel?: string }) {
  if (state.status === 'ready') return null
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-accent/10 p-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading live data…
      </div>
    )
  }
  if (state.status === 'empty') {
    return <div className="rounded-md border p-4 text-sm text-muted-foreground">{emptyLabel}</div>
  }
  if (state.status === 'unavailable') {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300"
      >
        <AlertTriangle className="size-4 mt-0.5 flex-shrink-0" />
        <span>
          <strong>Unavailable.</strong> {state.reason ?? 'This capability is not wired to a live backend.'}
        </span>
      </div>
    )
  }
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300"
    >
      <AlertTriangle className="size-4 mt-0.5 flex-shrink-0" />
      <span>
        <strong>Error.</strong> {state.reason ?? 'The backend reported an error.'}
      </span>
    </div>
  )
}

/** Read-only note for a control surface with no wired write/mutation endpoint. */
function ReadOnlyNotice({ reason }: { reason: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-accent/10 p-3 text-xs text-muted-foreground">
      <Lock className="size-3.5 mt-0.5 flex-shrink-0" />
      <span>{reason}</span>
    </div>
  )
}

interface ScholarxPaper {
  id: string
  title: string
  author: string
  category: string
  status: string
}

interface UptimeMonitor {
  name: string
  url: string
  status: string
  uptime_24h: number
  latency: number
}

interface SearxngResult {
  title: string
  url: string
  score: number
  engine: string
}

interface HaDevice {
  entity_id: string
  friendly_name: string
  state: string
  brightness?: number
  temperature?: number
  target_temp?: number
}

interface NextcloudEvent {
  id: string
  title: string
  start: string
  end: string
  type: string
}

interface MicrosoftEmail {
  id: string
  subject: string
  from: string
  received: string
  importance: string
}

interface MediaDownload {
  id: string
  url: string
  title: string
  progress: number
  speed: string
  status: string
}

interface QbittorrentTorrent {
  name: string
  size: string
  progress: number
  dl_speed: string
  ul_speed: string
  status: string
}

interface StirlingJob {
  id: string
  filename: string
  action: string
  status: string
  timestamp: string
}

// BUG-018 (GOC-25): every server `/api/enhanced/ecosystem/services` reports
// that already has a dedicated card (or an explicit "no backend endpoint
// wired" notice, e.g. Mealie/Wger/Langfuse above) elsewhere in this view.
// This is the ONLY place that inventory is declared -- the "Other
// Integrations" tab below renders a generic descriptor for every catalog
// entry NOT in this set, so a newly installed MCP server is visible by
// default (with an honest "no dedicated dashboard yet" reason) instead of
// silently omitted until someone hand-writes it a card.
const COVERED_ECOSYSTEM_SERVICES = new Set([
  'tunnel-manager',
  'systems-manager',
  'container-manager-mcp',
  'repository-manager',
  'atlassian-agent',
  'github-agent',
  'gitlab-api',
  'portainer-agent',
  'data-science-mcp',
  'scholarx',
  'uptime-kuma-agent',
  'searxng-mcp',
  'home-assistant-agent',
  'nextcloud-agent',
  'microsoft-agent',
  'media-downloader',
  'qbittorrent-agent',
  'stirlingpdf-agent',
  'mealie-mcp',
  'wger-agent',
  'langfuse-agent',
])

const catalogServicesSchema = looseArray(z.string())

interface DevOpsDomainProps {
  ecoStatus: Record<string, EcoState>
  kanbanColumns: KanbanColumn[]
  githubRepo: string
  onGithubRepoChange: (value: string) => void
  onLoadGithubRepo: () => void
  githubPrs: GithubPr[]
  githubWorkflows: GithubWorkflow[]
  gitlabMrs: GitlabMr[]
  gitlabPipelines: GitlabPipeline[]
  portainerStacks: PortainerStack[]
}

/* 6. OTHER INTEGRATIONS DOMAIN */
function OtherDomain({ catalogState, catalogServices }: { catalogState: EcoState; catalogServices: string[] }) {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      <Card className="border border-border/80 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Compass className="text-primary size-5" /> Other Installed Integrations
          </CardTitle>
          <CardDescription>
            Every MCP server / agent package the live catalog reports that has no dedicated dashboard yet. A server
            never disappears from this list just because no one has hand-built it a card.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServiceNotice state={catalogState} emptyLabel="No additional integrations were reported." />
          {catalogState.status === 'ready' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {catalogServices
                .filter((service) => !COVERED_ECOSYSTEM_SERVICES.has(service))
                .sort((a, b) => a.localeCompare(b))
                .map((service) => (
                  <Card
                    key={service}
                    className="p-4 bg-accent/5 border hover:border-primary/20 transition-all flex flex-col justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="text-muted-foreground size-4 shrink-0" />
                      <h4 className="font-bold text-xs text-foreground tracking-tight truncate">{service}</h4>
                    </div>
                    <Badge
                      variant="outline"
                      className="mt-3 w-fit text-[9px] uppercase border-amber-500/30 text-amber-500 bg-amber-500/10"
                    >
                      No dedicated dashboard implemented yet
                    </Badge>
                  </Card>
                ))}
              {catalogServices.filter((service) => !COVERED_ECOSYSTEM_SERVICES.has(service)).length === 0 && (
                <p className="text-sm text-muted-foreground col-span-full">
                  Every server the live catalog reports already has a dedicated section elsewhere in this view.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* 2. DATA & RESEARCH DOMAIN */
interface ResearchDomainProps {
  ecoStatus: Record<string, EcoState>
  resources: SystemResources | null
  trainedModels: TrainedModel[]
  scholarxPapers: ScholarxPaper[]
}

/** Systems telemetry gauges CPU/RAM/Disk */
function CpuGaugeCard({ resources }: { resources: SystemResources | null }) {
  return (
    <Card className="border border-border/85 shadow-sm hover:border-primary/20 transition-all">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-1.5">
            <Cpu className="text-primary size-4" /> CPU Workload
          </CardTitle>
          <Activity className="size-4 text-emerald-500 animate-pulse" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-extrabold tracking-tight mb-2">{resources?.cpu_percent}%</div>
        <div className="w-full bg-accent h-2.5 rounded-full overflow-hidden">
          <div
            className="bg-primary h-full transition-all duration-500"
            // no-fabrication-allow: cosmetic progress-bar width only, not the
            // displayed number (line above has no fallback). This branch only
            // renders when ecoStatus.resources.status === 'ready', i.e. a real
            // fetch already populated `resources`; the `?? 0` is an
            // impossible-in-practice defensive default TS requires, and 0 is
            // an honest "no bar" rather than a plausible fake percentage.
            style={{ width: `${resources?.cpu_percent ?? 0}%` }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function RamGaugeCard({ resources }: { resources: SystemResources | null }) {
  return (
    <Card className="border border-border/85 shadow-sm hover:border-primary/20 transition-all">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-1.5">
          <Server className="text-primary size-4" /> RAM Utilization
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-extrabold tracking-tight mb-2">{resources?.memory.percent}%</div>
        <div className="w-full bg-accent h-2.5 rounded-full overflow-hidden mb-1">
          <div
            className="bg-purple-500 h-full transition-all duration-500"
            // no-fabrication-allow: same as the CPU gauge above -- cosmetic
            // bar width only, gated behind a real successful fetch, 0 (not a
            // plausible fake percentage) is the defensive default.
            style={{ width: `${resources?.memory.percent ?? 0}%` }}
          />
        </div>
        <div className="text-xs text-muted-foreground flex justify-between">
          <span>Used: {resources?.memory.used_gb} GB</span>
          <span>Total: {resources?.memory.total_gb} GB</span>
        </div>
      </CardContent>
    </Card>
  )
}

function DiskGaugeCard({ resources }: { resources: SystemResources | null }) {
  return (
    <Card className="border border-border/85 shadow-sm hover:border-primary/20 transition-all">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-1.5">
          <HardDrive className="text-primary size-4" /> Disk Capacity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-extrabold tracking-tight mb-2">{resources?.disk.percent}%</div>
        <div className="w-full bg-accent h-2.5 rounded-full overflow-hidden mb-1">
          <div
            className="bg-blue-500 h-full transition-all duration-500"
            // no-fabrication-allow: same as the CPU gauge above -- cosmetic
            // bar width only, gated behind a real successful fetch, 0 (not a
            // plausible fake percentage) is the defensive default.
            style={{ width: `${resources?.disk.percent ?? 0}%` }}
          />
        </div>
        <div className="text-xs text-muted-foreground flex justify-between">
          <span>Used: {resources?.disk.used_gb} GB</span>
          <span>Total: {resources?.disk.total_gb} GB</span>
        </div>
      </CardContent>
    </Card>
  )
}

function SystemGaugesCard({
  ecoStatus,
  resources,
}: {
  ecoStatus: Record<string, EcoState>
  resources: SystemResources | null
}) {
  if (ecoStatus.resources.status !== 'ready') return <ServiceNotice state={ecoStatus.resources} />
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <CpuGaugeCard resources={resources} />
      <RamGaugeCard resources={resources} />
      <DiskGaugeCard resources={resources} />
    </div>
  )
}

/** Fitted model ranking (D-WUI-BUG-008: this used to render a fabricated
 * "TrainingMetrics" shape -- hyperparameters, a live epoch counter, a
 * "Simulated Convergence" loss curve -- that never matched what the backend
 * actually returns. The real `rank_models` endpoint reports already-fitted
 * models ranked by stored test R^2; there is no live epoch/loss stream. */
function TrainedModelsCard({
  ecoStatus,
  trainedModels,
}: {
  ecoStatus: Record<string, EcoState>
  trainedModels: TrainedModel[]
}) {
  return (
    <Card className="border border-border/80 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sliders className="text-primary size-5" /> Fitted Model Ranking (Data-Science-MCP)
        </CardTitle>
        <CardDescription>Models fitted in the current engine session, ranked by stored test R&sup2;</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ServiceNotice
          state={ecoStatus.training}
          emptyLabel="No trained models registered in the current engine session."
        />
        {ecoStatus.training.status === 'ready' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-accent/40 border-b">
              <tr>
                <th className="p-2 font-semibold text-muted-foreground">Model ID</th>
                <th className="p-2 font-semibold text-muted-foreground">Dataset</th>
                <th className="p-2 font-semibold text-muted-foreground">Model</th>
                <th className="p-2 font-semibold text-muted-foreground text-right">R&sup2; (test)</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono">
              {trainedModels.map((m) => (
                <tr key={m.model_id} className="hover:bg-accent/10 transition-colors">
                  <td className="p-2 font-bold text-primary">{m.model_id}</td>
                  <td className="p-2 text-muted-foreground">{m.dataset}</td>
                  <td className="p-2 text-foreground truncate max-w-[240px]" title={m.model_str}>
                    {m.model_str}
                  </td>
                  <td className="p-2 text-right font-bold text-emerald-500">{m.r2_test.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

/** ScholarX Research Scientific literature */
function ScholarxCard({
  ecoStatus,
  scholarxPapers,
}: {
  ecoStatus: Record<string, EcoState>
  scholarxPapers: ScholarxPaper[]
}) {
  return (
    <Card className="border border-border/80 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Compass className="text-primary size-5" /> Scientific Publications database (ScholarX)
        </CardTitle>
        <CardDescription>
          Scientific paper metadata registries downloaded locally for Offline Graph training
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ServiceNotice state={ecoStatus.scholarx} emptyLabel="No downloaded papers reported." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ecoStatus.scholarx.status === 'ready' &&
            scholarxPapers.map((paper) => (
              <Card
                key={paper.id}
                className="p-4 bg-accent/5 border hover:border-primary/20 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold font-mono text-primary uppercase">{paper.id}</span>
                    <Badge variant="secondary" className="text-[9px] uppercase">
                      {paper.category}
                    </Badge>
                  </div>
                  <h4 className="font-bold text-xs text-foreground tracking-tight pt-2 leading-snug line-clamp-2">
                    {paper.title}
                  </h4>
                  <p className="text-[10px] text-muted-foreground pt-1">Author: {paper.author}</p>
                </div>
                <div className="pt-3 border-t mt-3 flex justify-between items-center text-[10px] text-emerald-500 font-bold">
                  <span className="flex items-center gap-1">
                    <Check className="size-3" /> Ready
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[9px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20"
                  >
                    {paper.status}
                  </Badge>
                </div>
              </Card>
            ))}
        </div>
      </CardContent>
    </Card>
  )
}

/** D-WUI-BUG-008: this card used to render a hardcoded, permanent
 * `latencyData` array of five invented trace rows (fake trace IDs, routes,
 * latencies, and token counts) labeled "Live call spans" under a
 * Langfuse-Agent heading. No `/api/enhanced/ecosystem/*` route exists for
 * trace/latency data at all -- `langfuse-agent` is only listed as an
 * installed package by `/ecosystem/services`, it has no read endpoint wired
 * here. Removed rather than left displaying invented numbers; a real card
 * requires a backend route first (see BUG-REMEDIATION-DESIGNS.md#bug-008). */
function LangfuseUnavailableCard() {
  return (
    <Card className="border border-border/80 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="text-primary size-5" /> Agent API Execution Latency Traces (Langfuse-Agent)
        </CardTitle>
        <CardDescription>Live call spans, execution times, and token cost tracking logs</CardDescription>
      </CardHeader>
      <CardContent>
        <ServiceNotice
          state={{
            status: 'unavailable',
            reason:
              'No backend endpoint is wired for Langfuse trace data. Add a ' +
              'GET /api/enhanced/ecosystem/langfuse/traces route before this card can show real data.',
          }}
        />
      </CardContent>
    </Card>
  )
}

function ResearchDomain({ ecoStatus, resources, trainedModels, scholarxPapers }: ResearchDomainProps) {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      <SystemGaugesCard ecoStatus={ecoStatus} resources={resources} />
      <TrainedModelsCard ecoStatus={ecoStatus} trainedModels={trainedModels} />
      <ScholarxCard ecoStatus={ecoStatus} scholarxPapers={scholarxPapers} />
      <LangfuseUnavailableCard />
    </div>
  )
}

/* 3. INFRASTRUCTURE HUB DOMAIN */
interface NewHostDraft {
  alias: string
  hostname: string
  user: string
  port: number
  password_ref: string
}

interface InfraDomainProps {
  ecoStatus: Record<string, EcoState>
  uptimeMonitors: UptimeMonitor[]
  searxngQuery: string
  onSearxngQueryChange: (value: string) => void
  onRunSearxngSearch: () => void
  searxngLoading: boolean
  searxngResults: SearxngResult[]
  containerInventoryError: string | null
  containers: ContainerInfo[]
  onRefreshContainers: () => void
  hostsUnavailable: boolean
  hosts: Host[]
  addHostOpen: boolean
  onAddHostOpenChange: (open: boolean) => void
  onAddHostSubmit: (e: SyntheticEvent) => void
  newHost: NewHostDraft
  onNewHostChange: (host: NewHostDraft) => void
  searchProcess: string
  onSearchProcessChange: (value: string) => void
  onRefreshProcesses: () => void
  filteredProcesses: ProcessInfo[]
}

function InfraDomain({
  ecoStatus,
  uptimeMonitors,
  searxngQuery,
  onSearxngQueryChange,
  onRunSearxngSearch,
  searxngLoading,
  searxngResults,
  containerInventoryError,
  containers,
  onRefreshContainers,
  hostsUnavailable,
  hosts,
  addHostOpen,
  onAddHostOpenChange,
  onAddHostSubmit,
  newHost,
  onNewHostChange,
  searchProcess,
  onSearchProcessChange,
  onRefreshProcesses,
  filteredProcesses,
}: InfraDomainProps) {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      {/* Uptime Kuma monitors */}
      <Card className="border border-border/80 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="text-emerald-500 size-5 animate-pulse" /> Service Uptime timelines (Uptime-Kuma-Agent)
          </CardTitle>
          <CardDescription>Active health checks on gateways, DNS databases and storage streams</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServiceNotice state={ecoStatus.uptime} emptyLabel="No monitors reported." />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {ecoStatus.uptime.status === 'ready' &&
              uptimeMonitors.map((m) => (
                <Card
                  key={m.name}
                  className="p-4 bg-accent/5 hover:border-primary/20 transition-all flex flex-col justify-between"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-xs text-foreground truncate">{m.name}</h4>
                      <span className="text-[10px] font-mono text-muted-foreground truncate block">{m.url}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('capitalize scale-90 font-semibold px-2 py-0.5 rounded-full border', {
                        'bg-emerald-500/10 border-emerald-500/25 text-emerald-600': m.status === 'up',
                        'bg-red-500/10 border-red-500/25 text-red-600': m.status === 'down',
                      })}
                    >
                      {m.status}
                    </Badge>
                  </div>
                  <div className="pt-4 space-y-1 border-t mt-3">
                    <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                      <span>Uptime 24h:</span>
                      <span className="font-bold text-foreground">{m.uptime_24h}%</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                      <span>Latency:</span>
                      <span className="font-bold text-primary">{m.latency}ms</span>
                    </div>
                  </div>
                </Card>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* SearXNG searchranks and keyword plotting */}
      <Card className="border border-border/80 shadow-md">
        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between pb-3 gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Search className="text-primary size-5" /> Metasearch Aggregation & Ranks (SearXNG-MCP)
            </CardTitle>
            <CardDescription>
              Aggregate web query rankings parsed across google, duckduckgo and github engines
            </CardDescription>
          </div>
          <div className="flex gap-2 max-w-sm w-full">
            <Input
              placeholder="Search keywords..."
              value={searxngQuery}
              onChange={(e) => {
                onSearxngQueryChange(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRunSearxngSearch()
              }}
            />
            <Button onClick={onRunSearxngSearch} disabled={searxngLoading}>
              {searxngLoading ? <RefreshCw className="size-4 animate-spin" /> : 'Search'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {ecoStatus.searxng.status === 'empty' ? (
            <div className="text-center py-6 text-xs text-muted-foreground font-mono border rounded-md">
              Search something to load results
            </div>
          ) : (
            <ServiceNotice state={ecoStatus.searxng} />
          )}
          {ecoStatus.searxng.status === 'ready' && (
            <div className="space-y-2.5">
              {searxngResults.map((r, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center p-3 border rounded-md bg-accent/5 hover:border-primary/30 transition-all"
                >
                  <div className="space-y-0.5 truncate pr-2">
                    <h4 className="text-xs font-bold text-foreground truncate">{r.title}</h4>
                    <span className="text-[10px] font-mono text-muted-foreground truncate block">{r.url}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant="outline"
                      className="font-mono text-[9px] uppercase tracking-wide bg-primary/5 text-primary border-primary/20"
                    >
                      {r.engine}
                    </Badge>
                    <Badge variant="secondary" className="font-mono text-xs font-bold">
                      Score: {r.score}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Docker socket container grids */}
      <Card className="border border-border/80 shadow-md">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="text-primary size-5" /> Docker Daemon Containers
            </CardTitle>
            <CardDescription>Direct unix-socket queries to /var/run/docker.sock</CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={onRefreshContainers}>
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {containerInventoryError ? (
            <div
              role="status"
              className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300"
            >
              <strong>Live Docker inventory unavailable.</strong> {containerInventoryError} No simulated containers are
              shown.
            </div>
          ) : containers.length === 0 ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">No containers reported.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {containers.map((c, index) => (
                <Card
                  key={c.reference}
                  className="bg-accent/5 border hover:border-primary/20 transition-all flex flex-col justify-between"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-bold truncate tracking-tight text-primary">
                        Container workload {index + 1}
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className={cn('capitalize px-2 py-0.5 text-xs font-semibold rounded-full border', {
                          'bg-emerald-500/10 border-emerald-500/25 text-emerald-600': c.state === 'running',
                          'bg-red-500/10 border-red-500/25 text-red-600': c.state === 'exited',
                          'bg-amber-500/10 border-amber-500/25 text-amber-600': c.state === 'paused',
                        })}
                      >
                        {c.state}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs truncate font-mono text-muted-foreground pt-1">
                      Opaque operational reference
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-3 text-xs leading-relaxed text-muted-foreground flex-1 flex flex-col justify-end">
                    <p>
                      Direct container mutation is disabled. Submit lifecycle changes through governed GraphOS
                      delegation.
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active processes tree and SSH tunnel console */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-6">
          <Card className="border border-border/80 shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Network className="text-primary size-5" /> Host Aliases Inventory
                </CardTitle>
                <CardDescription>Ansible configurations loaded via tunnel-manager</CardDescription>
              </div>
              <Dialog open={addHostOpen} onOpenChange={onAddHostOpenChange}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="size-4" /> Add Host
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={onAddHostSubmit}>
                    <DialogHeader>
                      <DialogTitle>Add SSH Host Alias</DialogTitle>
                      <DialogDescription>Input new node configurations for SSH command forwarding.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-4 items-center gap-4">
                        <label className="text-right text-sm font-medium">Alias</label>
                        <Input
                          className="col-span-3"
                          placeholder="production-node"
                          value={newHost.alias}
                          onChange={(e) => {
                            onNewHostChange({ ...newHost, alias: e.target.value })
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <label className="text-right text-sm font-medium">IP/Host</label>
                        <Input
                          className="col-span-3"
                          placeholder="192.0.2.12"
                          value={newHost.hostname}
                          onChange={(e) => {
                            onNewHostChange({ ...newHost, hostname: e.target.value })
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <label className="text-right text-sm font-medium">User</label>
                        <Input
                          className="col-span-3"
                          placeholder="ubuntu"
                          value={newHost.user}
                          onChange={(e) => {
                            onNewHostChange({ ...newHost, user: e.target.value })
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <label className="text-right text-sm font-medium">Port</label>
                        <Input
                          type="number"
                          className="col-span-3"
                          value={newHost.port}
                          onChange={(e) => {
                            onNewHostChange({ ...newHost, port: parseInt(e.target.value) || 22 })
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <label className="text-right text-sm font-medium">Password ref</label>
                        <Input
                          className="col-span-3"
                          placeholder="secret-provider://reference"
                          value={newHost.password_ref}
                          onChange={(e) => {
                            onNewHostChange({ ...newHost, password_ref: e.target.value })
                          }}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit">Register Host</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {hostsUnavailable && <UnavailableNotice what="The configured hosts inventory" className="mb-4" />}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {hosts.map((h, index) => (
                  <div
                    key={h.reference}
                    className="flex flex-col gap-3 p-4 bg-accent/10 border rounded-lg hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm tracking-wide text-primary">Configured host {index + 1}</h3>
                      <Badge variant={h.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                        {h.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>
                        <strong className="text-foreground">Port:</strong>{' '}
                        {h.port_configured ? 'configured' : 'default'}
                      </p>
                      <p>
                        <strong className="text-foreground">Identity:</strong>{' '}
                        {h.identity_configured ? 'configured' : 'default'}
                      </p>
                      <p>
                        <strong className="text-foreground">Password:</strong>{' '}
                        {h.password_configured ? 'secret reference configured' : 'not configured'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Governed remote execution boundary */}
          <Card className="border border-border/80 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="text-green-500 size-5" /> Governed Remote Operations
              </CardTitle>
              <CardDescription>Remote execution is mediated by GraphOS ActionPolicy.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                Raw shell commands are not accepted by this UI. Use a typed GraphOS delegation action; it will apply
                authorization, approval, argument validation, timeouts, audit references, and redacted results before
                dispatch.
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Active Process tree */}
        <Card className="border border-border/80 shadow-md">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                <Terminal className="text-primary size-4.5" /> Process Workloads
              </CardTitle>
              <Button variant="outline" size="icon" className="size-8" onClick={onRefreshProcesses}>
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            <Input
              placeholder="Filter opaque workload reference..."
              className="h-8 text-xs mt-2"
              value={searchProcess}
              onChange={(e) => {
                onSearchProcessChange(e.target.value)
              }}
            />
          </CardHeader>
          <CardContent className="p-0 border-t max-h-[380px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-accent/40 sticky top-0 border-b">
                <tr>
                  <th className="p-2 font-semibold text-muted-foreground">Workload</th>
                  <th className="p-2 font-semibold text-muted-foreground text-right">CPU</th>
                  <th className="p-2 font-semibold text-muted-foreground text-right">Memory</th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono">
                {filteredProcesses.map((p) => (
                  <tr key={p.reference} className="hover:bg-accent/10 transition-colors">
                    <td className="p-2 text-muted-foreground font-bold">Opaque reference</td>
                    <td className="p-2 text-right text-green-500 font-bold">{p.cpu}%</td>
                    <td className="p-2 text-right text-blue-500 font-bold">{p.memory}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* 4. LIFESTYLE & AUTOMATION DOMAIN */
interface LifestyleDomainProps {
  ecoStatus: Record<string, EcoState>
  haDevices: HaDevice[]
  nextcloudEvents: NextcloudEvent[]
  microsoftEmails: MicrosoftEmail[]
}

function LifestyleDomain({ ecoStatus, haDevices, nextcloudEvents, microsoftEmails }: LifestyleDomainProps) {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      {/* IoT Device sliders (Home-Assistant-Agent) */}
      <Card className="border border-border/80 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sliders className="text-primary size-5" /> IoT Home automation controls (Home-Assistant-Agent)
          </CardTitle>
          <CardDescription>
            Visual dials, thermostats, and lights controls loaded from local Home Assistant server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServiceNotice state={ecoStatus.homeassistant} emptyLabel="No Home Assistant entities reported." />
          {ecoStatus.homeassistant.status === 'ready' && (
            <>
              {/*
                      D-WUI-BUG-008: the brightness slider, thermostat +/-
                      buttons, and power toggle below used to call
                      `updateDeviceState`/`updateThermostatTemp`, which only
                      mutated local React state and showed a
                      `toast.success('IoT command dispatched...')` -- no
                      request was ever sent to Home Assistant. There is no
                      write/command endpoint under
                      `/api/enhanced/ecosystem/homeassistant/*` at all (only
                      the GET .../devices read exists), so this is a
                      read-only view until a real command endpoint is wired.
                    */}
              <ReadOnlyNotice reason="Device state below is read-only. No command endpoint is wired here yet, so controls that would send a write are not shown." />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {haDevices.map((d) => (
                  <Card
                    key={d.entity_id}
                    className="p-4 bg-accent/5 flex flex-col justify-between hover:border-primary/20 transition-all"
                  >
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <h4 className="font-bold text-xs text-foreground truncate">{d.friendly_name}</h4>
                        <Badge
                          variant={d.state === 'on' || d.state === 'heat' ? 'default' : 'secondary'}
                          className="capitalize text-[9px]"
                        >
                          {d.state}
                        </Badge>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">{d.entity_id}</span>
                    </div>

                    {/* Brightness readout for lights */}
                    {d.brightness !== undefined && (
                      <div className="pt-4 space-y-1">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span>Brightness:</span>
                          <span className="font-bold">{d.brightness}%</span>
                        </div>
                        <div className="w-full bg-accent h-1.5 rounded-full overflow-hidden">
                          <div className="bg-primary h-full" style={{ width: `${d.brightness}%` }} />
                        </div>
                      </div>
                    )}

                    {/* Climate readout */}
                    {d.temperature !== undefined && d.target_temp !== undefined && (
                      <div className="pt-4 text-xs font-mono flex justify-between">
                        <span>
                          Room: <strong className="text-foreground">{d.temperature}°C</strong>
                        </span>
                        <span>
                          Target: <strong className="text-primary">{d.target_temp}°C</strong>
                        </span>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Nextcloud Tasks / Calendars & MS Outlook Inbox */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendars Nextcloud */}
        <Card className="border border-border/80 shadow-md lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="text-primary size-5" /> Calendar & Tasks Agenda (Nextcloud-Agent)
            </CardTitle>
            <CardDescription>Productivity synchronizer wiring personal schedule with CalDAV servers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ServiceNotice state={ecoStatus.nextcloud} emptyLabel="No upcoming calendar events reported." />
            <div className="space-y-2">
              <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Upcoming Calendars</h5>
              <div className="space-y-2">
                {ecoStatus.nextcloud.status === 'ready' &&
                  nextcloudEvents.map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between p-2 border rounded-md bg-accent/5">
                      <div className="space-y-0.5">
                        <h4 className="text-xs font-semibold text-foreground">{ev.title}</h4>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {new Date(ev.start).toLocaleString()}
                        </span>
                      </div>
                      <Badge variant="secondary" className="text-[9px] uppercase tracking-wide">
                        {ev.type}
                      </Badge>
                    </div>
                  ))}
              </div>
            </div>

            <div className="border-t pt-4 space-y-2">
              <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Pending Tasks</h5>
              {/* D-WUI-BUG-008: `nextcloudTasks` is always `[]` -- the
                        backend only wires `list_calendars`/
                        `list_calendar_events`, there is no tasks read path.
                        Rendering an empty task grid here was
                        indistinguishable from "you have zero tasks", which
                        is not what's actually true. Say so explicitly. */}
              <ServiceNotice
                state={{
                  status: 'unavailable',
                  reason:
                    'Nextcloud tasks have no backend read path wired (only calendars/events are). ' +
                    'This section cannot show real data until one is added.',
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* MS Exchange / Outlook */}
        <Card className="border border-border/80 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Mail className="text-blue-500 size-4.5" /> Outlook Graph Inbox (Microsoft-Agent)
            </CardTitle>
            <CardDescription>Synced MS Exchange emails summaries</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ServiceNotice state={ecoStatus.microsoft} emptyLabel="No inbox messages reported." />
            <div className="space-y-2.5">
              {ecoStatus.microsoft.status === 'ready' &&
                microsoftEmails.map((mail) => (
                  <div
                    key={mail.id}
                    className="p-3 border rounded-md hover:border-primary/20 transition-all bg-accent/5 space-y-1 relative"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-primary truncate max-w-[120px]">{mail.from}</span>
                      <span className="text-[9px] font-mono text-muted-foreground">{mail.received}</span>
                    </div>
                    <h4 className="text-xs font-bold text-foreground leading-snug truncate pr-6">{mail.subject}</h4>
                    {mail.importance === 'high' && (
                      <span
                        className="absolute top-3 right-3 text-red-500 font-extrabold text-[10px]"
                        title="High Importance"
                      >
                        !
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/*
              D-WUI-BUG-008: this entire section used to be a permanent,
              hardcoded five-day meal plan (real-looking recipe names,
              calories, protein grams) and a hardcoded six-exercise workout
              split, both labeled as if pulled live from Mealie-MCP and
              Wger-Agent. Neither ever fetched anything -- `mealPlan` and
              `workoutRoutines` were `useState` literals with no backing
              request, and the interactive "Servings"/"muscle filter"
              controls only recomputed derived numbers from that invented
              data. No `/api/enhanced/ecosystem/mealie/*` or
              `/api/enhanced/ecosystem/wger/*` read route exists at all
              (`mealie-mcp`/`wger-agent` are only listed as installed
              packages by `/ecosystem/services`). Per BUG-REMEDIATION-DESIGNS
              #bug-008, an honest "unavailable" here is the correct outcome,
              not a regression -- the accompanying "Biometrics & Meal
              Calibration" card was pure marketing copy describing behavior
              that never existed and is removed with it.
            */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border border-border/80 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="text-primary size-5" /> Culinary Meal Planner (Mealie-MCP)
            </CardTitle>
            <CardDescription>Scale ingredients and recipes dynamically</CardDescription>
          </CardHeader>
          <CardContent>
            <ServiceNotice
              state={{
                status: 'unavailable',
                reason:
                  'No backend endpoint is wired for Mealie meal-plan data. Add a ' +
                  'GET /api/enhanced/ecosystem/mealie/plan route before this card can show real data.',
              }}
            />
          </CardContent>
        </Card>

        <Card className="border border-border/80 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="text-orange-500 size-5" /> Workout Splits Builder (Wger-Agent)
            </CardTitle>
            <CardDescription>Tailor strength splits and reps counters</CardDescription>
          </CardHeader>
          <CardContent>
            <ServiceNotice
              state={{
                status: 'unavailable',
                reason:
                  'No backend endpoint is wired for Wger workout-routine data. Add a ' +
                  'GET /api/enhanced/ecosystem/wger/routines route before this card can show real data.',
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* 5. MEDIA & UTILITIES DOMAIN */
interface MediaDomainProps {
  ecoStatus: Record<string, EcoState>
  qbittorrentTorrents: QbittorrentTorrent[]
  mediaDownloads: MediaDownload[]
  stirlingJobs: StirlingJob[]
  repos: RepoInfo[]
  repoInventoryError: string | null
  selectedRepos: string[]
  onSelectedReposChange: (repos: string[]) => void
  bulkActionRunning: boolean
  onRunBulkStatus: () => void
}

function MediaDomain({
  ecoStatus,
  qbittorrentTorrents,
  mediaDownloads,
  stirlingJobs,
  repos,
  repoInventoryError,
  selectedRepos,
  onSelectedReposChange,
  bulkActionRunning,
  onRunBulkStatus,
}: MediaDomainProps) {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      {/* qBittorrent downloads list displaying speed limits */}
      <Card className="border border-border/80 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="text-primary size-5" /> Active Torrents Download speedometers (qBittorrent-Agent)
          </CardTitle>
          <CardDescription>Network traffic speed limiters and seed ratio checks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServiceNotice state={ecoStatus.qbittorrent} emptyLabel="No active torrents reported." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ecoStatus.qbittorrent.status === 'ready' &&
              qbittorrentTorrents.map((t) => (
                <Card key={t.name} className="p-4 bg-accent/5 hover:border-primary/20 transition-all space-y-4">
                  <div className="flex justify-between items-start gap-2">
                    <div className="truncate">
                      <h4 className="font-bold text-xs text-foreground truncate" title={t.name}>
                        {t.name}
                      </h4>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        Size: {t.size} | Status: <strong className="capitalize">{t.status}</strong>
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[9px] uppercase tracking-wide bg-primary/5 text-primary border-primary/20"
                    >
                      {t.progress}%
                    </Badge>
                  </div>

                  <div className="space-y-1.5">
                    <div className="w-full bg-accent h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-primary h-full transition-all duration-300"
                        style={{ width: `${t.progress}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-2 text-[10px] font-mono text-muted-foreground pt-0.5">
                      <div>
                        DL Speed: <span className="font-bold text-green-500">{t.dl_speed}</span>
                      </div>
                      <div className="text-right">
                        UL Speed: <span className="font-bold text-blue-500">{t.ul_speed}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Video downloader yt-dlp form and task list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border border-border/80 shadow-md lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="text-primary size-5" /> yt-dlp Video Downloader queue (Media-Downloader)
            </CardTitle>
            <CardDescription>Submit streaming video URLs to download as local MP3/MP4 files</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/*
                    D-WUI-BUG-008: this form used to call `addMediaDownload`,
                    which never sent the URL anywhere -- it fabricated a
                    queue row client-side with a randomly generated (non-backend) id,
                    then a `setTimeout` swapped in a fixed fake title
                    ("Self-driven coding agents presentation"), 45.2%
                    progress, and "5.8 MB/s" after 2 seconds, regardless of
                    what URL was entered. `media-downloader-mcp` only
                    exposes a fire-and-forget `download_media` action with
                    no way to read back a queue/history (see
                    `get_mediadownloader_downloads` in
                    `api_extensions.py`), so there is no honest "submit and
                    watch progress" UI possible today -- the read-only GET
                    below reports that explicitly instead.
                  */}
            <ReadOnlyNotice reason="Submitting a download is not available: media-downloader-mcp exposes only a fire-and-forget action with no queue to read back or show progress from." />
            <div className="border-t pt-4 space-y-2">
              <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Queue Status</h5>
              <ServiceNotice state={ecoStatus.mediadownloader} emptyLabel="No active downloads reported." />
              <div className="space-y-2.5">
                {ecoStatus.mediadownloader.status === 'ready' &&
                  mediaDownloads.map((dl) => (
                    <div
                      key={dl.id}
                      className="p-3 border rounded-md bg-accent/5 hover:border-primary/20 transition-all space-y-2"
                    >
                      <div className="flex justify-between items-center text-xs">
                        <h4 className="font-bold text-foreground truncate max-w-[280px]" title={dl.title}>
                          {dl.title}
                        </h4>
                        <span className="font-mono font-bold text-primary">{dl.progress}%</span>
                      </div>
                      <div className="w-full bg-accent h-1.5 rounded-full overflow-hidden">
                        <div className="bg-primary h-full transition-all" style={{ width: `${dl.progress}%` }} />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground pt-0.5">
                        <span>
                          Status: <strong className="capitalize text-foreground">{dl.status}</strong>
                        </span>
                        <span>Speed: {dl.speed}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stirling PDF action split/merge/compress triggers */}
        <Card className="border border-border/80 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <FileText className="text-red-500 size-4.5" /> Stirling PDF Actions (StirlingPDF-Agent)
            </CardTitle>
            <CardDescription>Convert, split, or merge files</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/*
                    D-WUI-BUG-008: these four buttons used to call
                    `submitStirlingPdf`, which fabricated a job entirely
                    client-side (a randomly generated, non-backend id, filename
                    `processed_<action>_doc.pdf`, no file was ever selected
                    or uploaded) and showed `toast.success('...launched
                    successfully')` immediately, then a `setTimeout` flipped
                    it to "completed" after 3s with another toast -- no PDF
                    was ever processed. `stirlingpdf-mcp` exposes only a
                    synchronous one-shot `pdf_action` with no persistent job
                    list (see `get_stirlingpdf_jobs`), so a queued-jobs UI
                    cannot be honest here without a file-upload + durable
                    job store this lane does not own.
                  */}
            <ReadOnlyNotice reason="PDF actions are not available in this view: Stirling-PDF processes synchronously (no file upload/job queue is wired here)." />
            <div className="border-t pt-4 space-y-2">
              <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Jobs Status</h5>
              <ServiceNotice state={ecoStatus.stirlingpdf} emptyLabel="No PDF jobs reported." />
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {ecoStatus.stirlingpdf.status === 'ready' &&
                  stirlingJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex justify-between items-center p-2 border rounded-md text-xs bg-accent/5"
                    >
                      <div className="truncate max-w-[120px] pr-2">
                        <span className="font-bold block truncate" title={job.filename}>
                          {job.filename}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground uppercase">
                          {job.action} | {job.timestamp}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn('capitalize scale-90', {
                          'bg-emerald-500/10 text-emerald-600 border-emerald-500/25': job.status === 'completed',
                          'bg-amber-500/10 text-amber-600 border-amber-500/25': job.status === 'running',
                        })}
                      >
                        {job.status}
                      </Badge>
                    </div>
                  ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cloned git repositories branches */}
      <Card className="border border-border/80 shadow-md">
        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between pb-3 gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitPullRequest className="text-primary size-5" /> Repositories Workspace Matrix
            </CardTitle>
            <CardDescription>Monitor branches, structural drift, and staging modifications</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={onRunBulkStatus}
              disabled={bulkActionRunning || selectedRepos.length === 0}
            >
              <RefreshCw className={cn('size-4', { 'animate-spin': bulkActionRunning })} />
              Check Status ({selectedRepos.length})
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 border-t">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-accent/40 border-b">
              <tr>
                <th className="p-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={repos.length > 0 && selectedRepos.length === repos.length}
                    disabled={repos.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onSelectedReposChange(repos.map((r) => r.reference))
                      } else {
                        onSelectedReposChange([])
                      }
                    }}
                    className="rounded border-gray-300 focus:ring-primary size-4 cursor-pointer"
                  />
                </th>
                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Repository
                </th>
                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Branch State
                </th>
                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Local Drift
                </th>
                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Sync status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {repoInventoryError && (
                <tr>
                  <td colSpan={5} className="p-4 text-sm text-amber-700 dark:text-amber-300">
                    <strong>Live repository inventory unavailable.</strong> {repoInventoryError} No simulated
                    repositories are shown.
                  </td>
                </tr>
              )}
              {!repoInventoryError && repos.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-sm text-muted-foreground">
                    No Git repositories were discovered in the configured workspace.
                  </td>
                </tr>
              )}
              {repos.map((r) => (
                <tr key={r.reference} className="hover:bg-accent/10 transition-colors">
                  <td className="p-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedRepos.includes(r.reference)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onSelectedReposChange([...selectedRepos, r.reference])
                        } else {
                          onSelectedReposChange(selectedRepos.filter((n) => n !== r.reference))
                        }
                      }}
                      className="rounded border-gray-300 focus:ring-primary size-4 cursor-pointer"
                    />
                  </td>
                  <td className="p-4 font-bold text-foreground tracking-tight flex flex-col pt-3 pb-3">
                    <span>{r.label}</span>
                  </td>
                  <td className="p-4 font-semibold text-muted-foreground">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {r.branch_state}
                    </Badge>
                  </td>
                  <td className="p-4 font-mono font-bold text-xs text-amber-500">
                    {r.modified_count < 0
                      ? 'unavailable'
                      : r.modified_count > 0
                        ? 'tracked drift detected'
                        : 'no tracked drift'}
                  </td>
                  <td className="p-4">
                    <Badge
                      variant="outline"
                      className={cn('capitalize px-2 py-0.5 text-xs font-semibold rounded-full border', {
                        'bg-emerald-500/10 border-emerald-500/25 text-emerald-600': r.status === 'clean',
                        'bg-amber-500/10 border-amber-500/25 text-amber-600': r.status === 'modified',
                        'bg-red-500/10 border-red-500/25 text-red-600': r.status === 'unavailable',
                      })}
                    >
                      {r.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

type DomainKey = 'devops' | 'research' | 'infra' | 'lifestyle' | 'media' | 'other'

const DOMAIN_NAV_ITEMS: { key: DomainKey; label: string; icon: typeof GitPullRequest }[] = [
  { key: 'devops', label: 'DevOps & Tasks', icon: GitPullRequest },
  { key: 'research', label: 'Data & Research', icon: BarChart2 },
  { key: 'infra', label: 'Infrastructure Hub', icon: Network },
  { key: 'lifestyle', label: 'Lifestyle & Home', icon: Heart },
  { key: 'media', label: 'Media & Utilities', icon: Download },
  { key: 'other', label: 'Other Integrations', icon: Compass },
]

function DomainNavButton({
  active,
  label,
  icon: Icon,
  badge,
  onClick,
}: {
  active: boolean
  label: string
  icon: typeof GitPullRequest
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
        active
          ? 'bg-primary text-primary-foreground shadow-md'
          : 'hover:bg-accent text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="size-4" />
      {label}
      {badge !== undefined && (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {badge}
        </Badge>
      )}
    </button>
  )
}

/** Premium Glassmorphic Domain Selection Navbar */
function DomainNavbar({
  activeDomain,
  onDomainChange,
  otherBadgeCount,
  loading,
  onRefresh,
}: {
  activeDomain: DomainKey
  onDomainChange: (domain: DomainKey) => void
  otherBadgeCount: number | null
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2 p-1.5 bg-accent/30 rounded-lg border border-border shadow-sm items-center justify-between">
      <div className="flex flex-wrap gap-2">
        {DOMAIN_NAV_ITEMS.map((item) => (
          <DomainNavButton
            key={item.key}
            active={activeDomain === item.key}
            label={item.label}
            icon={item.icon}
            badge={item.key === 'other' && otherBadgeCount !== null ? otherBadgeCount : undefined}
            onClick={() => {
              onDomainChange(item.key)
            }}
          />
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
        <RefreshCw className={cn('size-3.5', { 'animate-spin': loading })} />
        Refresh
      </Button>
    </div>
  )
}

/* 1. DEVOPS & TASKS DOMAIN */

/** Jira / Atlassian Kanban board */
function KanbanBoardCard({
  ecoStatus,
  kanbanColumns,
}: {
  ecoStatus: Record<string, EcoState>
  kanbanColumns: KanbanColumn[]
}) {
  return (
    <Card className="border border-border/80 shadow-md">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="text-primary size-5" /> Agile Scrum Board (Atlassian-Agent)
            </CardTitle>
            <CardDescription>Visual Sprint logs and backlog mapping inside Atlassian APIs</CardDescription>
          </div>
          <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">
            Active Sprint
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ServiceNotice state={ecoStatus.kanban} emptyLabel="No sprint columns reported." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ecoStatus.kanban.status === 'ready' &&
            kanbanColumns.map((col) => (
              <div key={col.id} className="bg-accent/15 p-4 rounded-lg border border-border/40 space-y-3">
                <div className="flex justify-between items-center border-b pb-2">
                  <span className="font-bold text-xs uppercase tracking-wide text-muted-foreground">{col.title}</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {col.issues.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {col.issues.map((iss) => (
                    <div
                      key={iss.id}
                      className="p-3 bg-background border rounded-md hover:border-primary/30 transition-all shadow-sm space-y-2"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-[10px] font-bold text-primary">{iss.id}</span>
                        <Badge
                          className="text-[9px] uppercase tracking-wide scale-90"
                          variant={iss.priority === 'Highest' || iss.priority === 'High' ? 'destructive' : 'secondary'}
                        >
                          {iss.priority}
                        </Badge>
                      </div>
                      <h4 className="text-xs font-semibold text-foreground leading-snug">{iss.title}</h4>
                      <div className="flex justify-end pt-1">
                        <span className="size-5 rounded-full bg-accent text-[9px] font-extrabold flex items-center justify-center border uppercase text-muted-foreground">
                          {iss.assignee.substring(0, 2)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {col.issues.length === 0 && (
                    <div className="text-center py-6 text-xs text-muted-foreground font-mono">Column Empty</div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  )
}

function GithubCard({
  ecoStatus,
  githubRepo,
  onGithubRepoChange,
  onLoadGithubRepo,
  githubPrs,
  githubWorkflows,
}: {
  ecoStatus: Record<string, EcoState>
  githubRepo: string
  onGithubRepoChange: (value: string) => void
  onLoadGithubRepo: () => void
  githubPrs: GithubPr[]
  githubWorkflows: GithubWorkflow[]
}) {
  return (
    <Card className="border border-border/80 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <GitBranch className="text-purple-500 size-4.5" /> Pull Requests & Workflows (GitHub-Agent)
        </CardTitle>
        <CardDescription>Live actions CI execution streams</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* BUG-012: `get_github_prs` requires an explicit
            `owner/name` selector -- a PR list is inherently
            per-repository, and the backend returns
            `needs_input` (not an error, not fabricated data)
            without one. This is the only place the selector can
            come from. */}
        <div className="flex items-center gap-2">
          <Input
            value={githubRepo}
            onChange={(e) => {
              onGithubRepoChange(e.target.value)
            }}
            placeholder="owner/name"
            className="h-7 text-xs font-mono"
            aria-label="GitHub repository (owner/name)"
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onLoadGithubRepo}>
            Load
          </Button>
        </div>
        <ServiceNotice state={ecoStatus.github} emptyLabel="No open pull requests reported." />
        <div className="space-y-2.5">
          {ecoStatus.github.status === 'ready' &&
            githubPrs.map((pr) => (
              <div key={pr.id} className="flex items-center justify-between p-2.5 border rounded-md bg-accent/5">
                <div className="space-y-1 truncate pr-2">
                  <h4 className="text-xs font-bold text-foreground truncate flex items-center gap-1.5">
                    #{pr.id}{' '}
                    {isRenderableUrl(pr.web_url) ? (
                      <a href={pr.web_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {pr.title}
                      </a>
                    ) : (
                      pr.title
                    )}
                  </h4>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">
                    by {pr.author ?? 'unknown'} | branch:{' '}
                    <span className="text-primary font-semibold">{pr.branch ?? 'unknown'}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Badge
                    variant="outline"
                    className="capitalize text-[10px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20"
                  >
                    {pr.status}
                  </Badge>
                </div>
              </div>
            ))}
        </div>

        <div className="border-t pt-4 space-y-2">
          <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">CI Actions Runs</h5>
          <div className="space-y-1.5 text-xs">
            {ecoStatus.github.status === 'ready' &&
              githubWorkflows.map((wf, idx) => (
                <div key={wf.id ?? idx} className="flex justify-between items-center font-mono">
                  <span className="text-foreground">
                    Run #{wf.run_number ?? '?'} - {wf.name ?? 'unnamed workflow'}
                  </span>
                  <Badge variant="default" className="text-[9px] px-1 py-0">
                    {wf.conclusion ?? wf.status ?? 'unknown'}
                  </Badge>
                </div>
              ))}
            {ecoStatus.github.status === 'ready' && githubWorkflows.length === 0 && (
              <div className="text-muted-foreground">No CI runs reported.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function GitlabCard({
  ecoStatus,
  gitlabMrs,
  gitlabPipelines,
}: {
  ecoStatus: Record<string, EcoState>
  gitlabMrs: GitlabMr[]
  gitlabPipelines: GitlabPipeline[]
}) {
  return (
    <Card className="border border-border/80 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <GitMerge className="text-orange-500 size-4.5" /> Merge Requests & Pipelines (GitLab-API)
        </CardTitle>
        <CardDescription>GitLab server integration logs</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ServiceNotice state={ecoStatus.gitlab} emptyLabel="No open merge requests reported." />
        <div className="space-y-2.5">
          {ecoStatus.gitlab.status === 'ready' &&
            gitlabMrs.map((mr) => (
              <div key={mr.id} className="flex items-center justify-between p-2.5 border rounded-md bg-accent/5">
                <div className="space-y-1 truncate pr-2">
                  <h4 className="text-xs font-bold text-foreground truncate">
                    !{mr.id}{' '}
                    {isRenderableUrl(mr.web_url) ? (
                      <a href={mr.web_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {mr.title}
                      </a>
                    ) : (
                      mr.title
                    )}
                  </h4>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    by {mr.author ?? 'unknown'} | target: {mr.target_branch}
                  </p>
                </div>
                <Badge className="text-[9px] uppercase">{mr.status}</Badge>
              </div>
            ))}
        </div>

        <div className="border-t pt-4 space-y-2">
          <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Pipelines Runs</h5>
          <div className="space-y-1.5 text-xs">
            {ecoStatus.gitlab.status === 'ready' &&
              gitlabPipelines.map((p) => (
                <div key={p.id} className="flex justify-between items-center font-mono">
                  <span className="text-foreground">
                    Pipeline #{p.id} ({p.ref})
                  </span>
                  {p.duration && <span className="text-muted-foreground text-[10px]">{p.duration}</span>}
                  <Badge variant="secondary" className="text-[9px]">
                    {p.status}
                  </Badge>
                </div>
              ))}
            {ecoStatus.gitlab.status === 'ready' && gitlabPipelines.length === 0 && (
              <div className="text-muted-foreground">No pipeline runs reported.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Portainer stack list */
function PortainerCard({
  ecoStatus,
  portainerStacks,
}: {
  ecoStatus: Record<string, EcoState>
  portainerStacks: PortainerStack[]
}) {
  return (
    <Card className="border border-border/80 shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="text-primary size-5" /> Docker Compose Stacks (Portainer-Agent)
        </CardTitle>
        <CardDescription>Multi-host service stacks loaded dynamically from Portainer environments</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ServiceNotice state={ecoStatus.portainer} emptyLabel="No Portainer stacks reported." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ecoStatus.portainer.status === 'ready' &&
            portainerStacks.map((stack) => (
              <Card
                key={stack.name}
                className="p-4 bg-accent/5 hover:border-primary/30 transition-all flex flex-col justify-between"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-sm text-foreground leading-snug">{stack.name}</h4>
                    <p className="text-xs text-muted-foreground pt-1">{stack.services} services configured</p>
                  </div>
                  <Badge
                    variant="outline"
                    className="capitalize scale-90 bg-emerald-500/10 text-emerald-600 border-emerald-500/25"
                  >
                    {stack.status}
                  </Badge>
                </div>
                <div className="pt-4 flex justify-between items-center text-[10px] font-mono text-muted-foreground border-t mt-3">
                  <span>Deploy Type:</span>
                  <span className="font-bold text-foreground">{stack.type}</span>
                </div>
              </Card>
            ))}
        </div>
      </CardContent>
    </Card>
  )
}

function DevOpsDomain({
  ecoStatus,
  kanbanColumns,
  githubRepo,
  onGithubRepoChange,
  onLoadGithubRepo,
  githubPrs,
  githubWorkflows,
  gitlabMrs,
  gitlabPipelines,
  portainerStacks,
}: DevOpsDomainProps) {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
      <KanbanBoardCard ecoStatus={ecoStatus} kanbanColumns={kanbanColumns} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GithubCard
          ecoStatus={ecoStatus}
          githubRepo={githubRepo}
          onGithubRepoChange={onGithubRepoChange}
          onLoadGithubRepo={onLoadGithubRepo}
          githubPrs={githubPrs}
          githubWorkflows={githubWorkflows}
        />
        <GitlabCard ecoStatus={ecoStatus} gitlabMrs={gitlabMrs} gitlabPipelines={gitlabPipelines} />
      </div>

      <PortainerCard ecoStatus={ecoStatus} portainerStacks={portainerStacks} />
    </div>
  )
}

export default function EcosystemView() {
  const [activeDomain, setActiveDomain] = useState<'devops' | 'research' | 'infra' | 'lifestyle' | 'media' | 'other'>(
    'devops',
  )
  const [loading, setLoading] = useState(false)

  // Core Hosts & Systems States
  const [hosts, setHosts] = useState<Host[]>([])
  const [newHost, setNewHost] = useState({ alias: '', hostname: '', user: '', port: 22, password_ref: '' })
  const [addHostOpen, setAddHostOpen] = useState(false)

  const [resources, setResources] = useState<SystemResources | null>(null)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [searchProcess, setSearchProcess] = useState('')

  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [containerInventoryError, setContainerInventoryError] = useState<string | null>(null)

  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [bulkActionRunning, setBulkActionRunning] = useState(false)
  const [repoInventoryError, setRepoInventoryError] = useState<string | null>(null)

  // D-WUI-BUG-008: one truthful-state slot per ecosystem/system section,
  // keyed by service id. Every fetch below sets this via `classifyEcosystemList`
  // / `classifyEcosystemFailure` instead of letting a failure collapse into a
  // silently-empty array. `ServiceNotice` renders the honest state; see the
  // type/helper definitions above the component.
  const [ecoStatus, setEcoStatus] = useState<Record<string, EcoState>>({
    resources: LOADING_STATE,
    processes: LOADING_STATE,
    kanban: LOADING_STATE,
    github: LOADING_STATE,
    gitlab: LOADING_STATE,
    portainer: LOADING_STATE,
    training: LOADING_STATE,
    scholarx: LOADING_STATE,
    uptime: LOADING_STATE,
    searxng: { status: 'empty' },
    homeassistant: LOADING_STATE,
    nextcloud: LOADING_STATE,
    microsoft: LOADING_STATE,
    mediadownloader: LOADING_STATE,
    qbittorrent: LOADING_STATE,
    stirlingpdf: LOADING_STATE,
  })
  const setStatus = (key: string, state: EcoState) => {
    setEcoStatus((prev) => ({ ...prev, [key]: state }))
  }

  // BUG-018 (GOC-25): the live MCP/agent-package catalog, sourced from
  // `/api/enhanced/ecosystem/services` rather than any hard-coded list.
  const [catalogServices, setCatalogServices] = useState<string[]>([])
  const [catalogState, setCatalogState] = useState<EcoState>(LOADING_STATE)

  // 14 Services States
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>([])
  // BUG-012: `get_github_prs` requires an explicit `owner/name` repository
  // selector (a PR list is inherently per-repository) -- this view used to
  // never supply one, so the card was permanently `needs_input` unless an
  // operator happened to set the server-side `GITHUB_REPO` env var. This is
  // the persisted selector the fetch below sends as `?repo=`.
  const [githubRepo, setGithubRepo] = useState(() => window.localStorage.getItem('ecosystem.githubRepo') ?? '')
  const [githubPrs, setGithubPrs] = useState<GithubPr[]>([])
  const [githubWorkflows, setGithubWorkflows] = useState<GithubWorkflow[]>([])
  const [gitlabMrs, setGitlabMrs] = useState<GitlabMr[]>([])
  const [gitlabPipelines, setGitlabPipelines] = useState<GitlabPipeline[]>([])
  const [portainerStacks, setPortainerStacks] = useState<PortainerStack[]>([])

  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([])
  const [scholarxPapers, setScholarxPapers] = useState<ScholarxPaper[]>([])
  const [uptimeMonitors, setUptimeMonitors] = useState<UptimeMonitor[]>([])
  const [searxngQuery, setSearxngQuery] = useState('agent-utilities')
  const [searxngResults, setSearxngResults] = useState<SearxngResult[]>([])
  const [searxngLoading, setSearxngLoading] = useState(false)

  const [haDevices, setHaDevices] = useState<HaDevice[]>([])
  const [nextcloudEvents, setNextcloudEvents] = useState<NextcloudEvent[]>([])
  const [microsoftEmails, setMicrosoftEmails] = useState<MicrosoftEmail[]>([])

  const [mediaDownloads, setMediaDownloads] = useState<MediaDownload[]>([])
  const [qbittorrentTorrents, setQbittorrentTorrents] = useState<QbittorrentTorrent[]>([])
  const [stirlingJobs, setStirlingJobs] = useState<StirlingJob[]>([])

  // BUG-008 (dashboard-wide follow-on, GOC-28-W06): unlike every other fetch
  // in this file (which routes through `classifyEcosystemList`/
  // `ServiceNotice`), `fetchHosts` swallowed both a non-OK response and a
  // network exception with no state update and no visible error at all --
  // the "Host Aliases Inventory" grid rendered identically blank whether
  // zero hosts are configured or the tunnel-manager endpoint is down.
  const [hostsUnavailable, setHostsUnavailable] = useState(false)

  // Core functions
  const fetchHosts = async () => {
    try {
      const res = await fetch('/api/enhanced/tunnel-manager/hosts')
      if (res.ok) {
        const data = (await res.json()) as { hosts?: Host[] }
        setHosts(data.hosts ?? [])
        setHostsUnavailable(false)
      } else {
        setHostsUnavailable(true)
      }
    } catch {
      console.error('Failed to load configured hosts')
      setHostsUnavailable(true)
    }
  }

  const handleAddHost = async (e: SyntheticEvent) => {
    e.preventDefault()
    if (!newHost.alias || !newHost.hostname || !newHost.user) {
      toast.error('Please complete all required host parameters')
      return
    }
    try {
      const res = await fetch('/api/enhanced/tunnel-manager/hosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHost),
      })
      if (res.ok) {
        toast.success('Host added successfully')
        setNewHost({ alias: '', hostname: '', user: '', port: 22, password_ref: '' })
        setAddHostOpen(false)
        void fetchHosts()
      } else {
        // Previously fell through silently on a non-ok response (403/409/500/…):
        // the dialog stayed open with no feedback at all, indistinguishable from
        // a click that hadn't registered. A backend refusal must be visible.
        const detail = await res.text().catch(() => '')
        toast.error(`Failed to save host configuration: HTTP ${String(res.status)}${detail ? `: ${detail}` : ''}`)
      }
    } catch {
      console.error('Failed to save host configuration')
      toast.error('Failed to save host configuration')
    }
  }

  const fetchSystems = async () => {
    try {
      const [resRes, procRes] = await Promise.all([
        fetch('/api/enhanced/systems-manager/resources'),
        fetch('/api/enhanced/systems-manager/processes'),
      ])
      if (resRes.ok) {
        const rawRes: unknown = await resRes.json()
        const parsed = systemResourcesSchema.safeParse(rawRes)
        if (parsed.success) {
          setResources(parsed.data)
          setStatus('resources', { status: 'ready' })
        } else {
          // D-WUI-BUG-008: a shape violation must not leave the fallback
          // constants on screen looking like real telemetry -- surface it.
          setResources(null)
          setStatus('resources', {
            status: 'error',
            reason: 'The resource response did not match the expected shape.',
          })
        }
      } else {
        const body = (await resRes.json().catch(() => ({}))) as { detail?: string }
        setResources(null)
        setStatus('resources', {
          status: 'error',
          reason: body.detail ?? `System resources unavailable (${resRes.status})`,
        })
      }
      if (procRes.ok) {
        const raw: unknown = await procRes.json()
        const parsedProcesses = validateShape(processInfoListSchema, raw, '/api/enhanced/systems-manager/processes')
        setProcesses(parsedProcesses)
        setStatus('processes', { status: parsedProcesses.length > 0 ? 'ready' : 'empty' })
      } else {
        const body = (await procRes.json().catch(() => ({}))) as { detail?: string }
        setProcesses([])
        setStatus('processes', {
          status: 'error',
          reason: body.detail ?? `Process listing unavailable (${procRes.status})`,
        })
      }
    } catch (err) {
      console.error(err)
      setResources(null)
      setProcesses([])
      setStatus('resources', {
        status: 'error',
        reason: 'System telemetry unavailable: the API could not be reached.',
      })
      setStatus('processes', { status: 'error', reason: 'Process listing unavailable: the API could not be reached.' })
    }
  }

  const fetchContainers = async () => {
    try {
      const res = await fetch('/api/enhanced/container-manager/containers')
      if (res.ok) {
        setContainers((await res.json()) as ContainerInfo[])
        setContainerInventoryError(null)
      } else {
        const body = (await res.json().catch(() => ({}))) as { detail?: string }
        setContainers([])
        setContainerInventoryError(body.detail ?? `Docker inventory unavailable (${res.status})`)
      }
    } catch (err) {
      console.error(err)
      setContainers([])
      setContainerInventoryError('Docker inventory unavailable: the API could not be reached')
    }
  }

  const fetchRepos = async () => {
    try {
      const res = await fetch('/api/enhanced/repository-manager/repos')
      if (res.ok) {
        setRepos((await res.json()) as RepoInfo[])
        setRepoInventoryError(null)
      } else {
        const body = (await res.json().catch(() => ({}))) as { detail?: string }
        setRepos([])
        setRepoInventoryError(body.detail ?? `Repository inventory unavailable (${res.status})`)
      }
    } catch (err) {
      console.error(err)
      setRepos([])
      setRepoInventoryError('Repository inventory unavailable: the API could not be reached')
    }
  }

  // BUG-018 (GOC-25): `/api/enhanced/ecosystem/services` is a raw
  // `list[str]`, not the `{status, ...}` envelope `classifyEcosystemList`
  // expects for the other `/ecosystem/*` routes -- validate its own shape
  // directly instead of forcing it through that helper.
  const fetchEcosystemCatalog = async () => {
    setCatalogState(LOADING_STATE)
    try {
      const res = await fetch('/api/enhanced/ecosystem/services')
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const detail =
          body && typeof body === 'object' && typeof (body as Record<string, unknown>).detail === 'string'
            ? (body as Record<string, unknown>).detail
            : `HTTP ${res.status}`
        setCatalogServices([])
        setCatalogState({ status: 'error', reason: String(detail) })
        return
      }
      const parsed = validateShape(catalogServicesSchema, body, '/api/enhanced/ecosystem/services')
      setCatalogServices(parsed)
      setCatalogState({ status: parsed.length > 0 ? 'ready' : 'empty' })
    } catch (err) {
      console.error(err)
      setCatalogServices([])
      setCatalogState({ status: 'error', reason: 'The live integration catalog could not be reached.' })
    }
  }

  const runBulkRepoAction = async (action: 'status') => {
    if (selectedRepos.length === 0) {
      toast.warning('Please select at least one target repository')
      return
    }
    setBulkActionRunning(true)
    try {
      const res = await fetch('/api/enhanced/repository-manager/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, targets: selectedRepos }),
      })
      if (res.ok) {
        toast.success(`Bulk ${action} triggered successfully across ${selectedRepos.length} repos`)
        setTimeout(() => {
          setBulkActionRunning(false)
          void fetchRepos()
        }, 2000)
      } else {
        // Previously only reset on `res.ok` or a thrown exception: a non-ok
        // HTTP response (403/409/500/…) left `bulkActionRunning` stuck `true`
        // forever -- the refresh button showed a permanent spinner with no
        // error, indistinguishable from "still working" for a request that had
        // already failed.
        const detail = await res.text().catch(() => '')
        setBulkActionRunning(false)
        toast.error(`Bulk ${action} failed: HTTP ${String(res.status)}${detail ? `: ${detail}` : ''}`)
      }
    } catch (err) {
      console.error(err)
      setBulkActionRunning(false)
      toast.error(`Bulk ${action} failed: the request could not be reached`)
    }
  }

  // Load the ecosystem endpoints. Every response is classified through
  // `classifyEcosystemList` (D-WUI-BUG-008) instead of the old bare
  // `if (res.ok) setX(d.field ?? [])`, which rendered a backend error or a
  // "no backend at all" (`capability_unavailable`) response as an
  // indistinguishable empty list.
  const loadEcosystemData = async () => {
    setLoading(true)
    try {
      // 1. DevOps Services
      const githubPrsUrl = githubRepo.trim()
        ? `/api/enhanced/ecosystem/github/prs?repo=${encodeURIComponent(githubRepo.trim())}`
        : '/api/enhanced/ecosystem/github/prs'
      const [atlassianRes, githubRes, gitlabRes, portainerRes] = await Promise.all([
        fetch('/api/enhanced/ecosystem/atlassian/kanban'),
        fetch(githubPrsUrl),
        fetch('/api/enhanced/ecosystem/gitlab/mrs'),
        fetch('/api/enhanced/ecosystem/portainer/stacks'),
      ])

      const kanbanJson = await readEcosystemResponse(atlassianRes)
      const kanban = classifyEcosystemList<KanbanColumn>(kanbanJson, 'columns')
      setKanbanColumns(kanban.items)
      setStatus('kanban', kanban.state)

      const githubJson = await readEcosystemResponse(githubRes)
      const ghPrs = classifyEcosystemList<GithubPr>(githubJson, 'prs', githubPrItemSchema)
      const ghWorkflows = classifyEcosystemList<GithubWorkflow>(githubJson, 'workflows', githubWorkflowItemSchema)
      setGithubPrs(ghPrs.items)
      setGithubWorkflows(ghWorkflows.items)
      setStatus('github', ghPrs.state)

      const gitlabJson = await readEcosystemResponse(gitlabRes)
      const glMrs = classifyEcosystemList<GitlabMr>(gitlabJson, 'mrs', gitlabMrItemSchema)
      const glPipelines = classifyEcosystemList<GitlabPipeline>(gitlabJson, 'pipelines', gitlabPipelineItemSchema)
      setGitlabMrs(glMrs.items)
      setGitlabPipelines(glPipelines.items)
      setStatus('gitlab', glMrs.state)

      const portainerJson = await readEcosystemResponse(portainerRes)
      const stacks = classifyEcosystemList<PortainerStack>(portainerJson, 'stacks')
      setPortainerStacks(stacks.items)
      setStatus('portainer', stacks.state)

      // 2. Data & Research Services
      const [dsRes, scholarRes] = await Promise.all([
        fetch('/api/enhanced/ecosystem/datascience/training'),
        fetch('/api/enhanced/ecosystem/scholarx/papers'),
      ])

      const trainingJson = await readEcosystemResponse(dsRes)
      const models = classifyEcosystemList<TrainedModel>(trainingJson, 'models')
      setTrainedModels(models.items)
      setStatus('training', models.state)

      const scholarJson = await readEcosystemResponse(scholarRes)
      const papers = classifyEcosystemList<ScholarxPaper>(scholarJson, 'papers')
      setScholarxPapers(papers.items)
      setStatus('scholarx', papers.state)

      // 3. Infrastructure Hub Services
      const uptimeRes = await fetch('/api/enhanced/ecosystem/uptime/status')
      const uptimeJson = await readEcosystemResponse(uptimeRes)
      const monitors = classifyEcosystemList<UptimeMonitor>(uptimeJson, 'monitors')
      setUptimeMonitors(monitors.items)
      setStatus('uptime', monitors.state)

      // 4. Lifestyle & Productivity Services
      const [haRes, ncRes, msRes] = await Promise.all([
        fetch('/api/enhanced/ecosystem/homeassistant/devices'),
        fetch('/api/enhanced/ecosystem/nextcloud/events'),
        fetch('/api/enhanced/ecosystem/microsoft/emails'),
      ])

      const haJson = await readEcosystemResponse(haRes)
      // D-WUI-BUG-008: the backend returns raw HA states as
      // `{entity_id, friendly_name, state, attributes}` -- `brightness`/
      // `temperature`/`target_temp` live inside `attributes`, not at the top
      // level. The previous cast (`as { devices?: HaDevice[] }`) skipped
      // this mapping entirely, so `d.brightness`/`d.temperature` were
      // always `undefined` and every device silently rendered as a generic
      // on/off switch regardless of its real domain.
      interface RawHaDevice {
        entity_id: string
        friendly_name?: string
        state: string
        attributes?: Record<string, unknown>
      }
      const haRaw = classifyEcosystemList<RawHaDevice>(haJson, 'devices')
      const devices: HaDevice[] = haRaw.items.map((d) => {
        const attrs = d.attributes ?? {}
        const brightness = typeof attrs.brightness === 'number' ? attrs.brightness : undefined
        const temperature = typeof attrs.current_temperature === 'number' ? attrs.current_temperature : undefined
        const targetTemp = typeof attrs.temperature === 'number' ? attrs.temperature : undefined
        return {
          entity_id: d.entity_id,
          friendly_name: d.friendly_name ?? d.entity_id,
          state: d.state,
          brightness,
          temperature,
          target_temp: targetTemp,
        }
      })
      setHaDevices(devices)
      setStatus('homeassistant', haRaw.state)

      const ncJson = await readEcosystemResponse(ncRes)
      const ncEvents = classifyEcosystemList<NextcloudEvent>(ncJson, 'events')
      // The backend has no read path for Nextcloud tasks at all (only
      // `list_calendars`/`list_calendar_events` are wired) -- the "Pending
      // Tasks" card below always shows a permanent unavailable notice
      // rather than an empty (and misleading) task state.
      setNextcloudEvents(ncEvents.items)
      setStatus('nextcloud', ncEvents.state)

      const msJson = await readEcosystemResponse(msRes)
      const emails = classifyEcosystemList<MicrosoftEmail>(msJson, 'emails')
      setMicrosoftEmails(emails.items)
      setStatus('microsoft', emails.state)

      // 5. Media & Utilities Services
      const [dlRes, qbtRes, stirlingRes] = await Promise.all([
        fetch('/api/enhanced/ecosystem/mediadownloader/downloads'),
        fetch('/api/enhanced/ecosystem/qbittorrent/torrents'),
        fetch('/api/enhanced/ecosystem/stirlingpdf/jobs'),
      ])

      const dlJson = await readEcosystemResponse(dlRes)
      const downloads = classifyEcosystemList<MediaDownload>(dlJson, 'queue')
      setMediaDownloads(downloads.items)
      setStatus('mediadownloader', downloads.state)

      const qbtJson = await readEcosystemResponse(qbtRes)
      const torrents = classifyEcosystemList<QbittorrentTorrent>(qbtJson, 'torrents')
      setQbittorrentTorrents(torrents.items)
      setStatus('qbittorrent', torrents.state)

      const stirlingJson = await readEcosystemResponse(stirlingRes)
      const jobs = classifyEcosystemList<StirlingJob>(stirlingJson, 'jobs')
      setStirlingJobs(jobs.items)
      setStatus('stirlingpdf', jobs.state)
    } catch (err) {
      console.error('Failed to load full ecosystem payloads', err)
    } finally {
      setLoading(false)
    }
  }

  // SearXNG Search action
  const runSearxngSearch = async () => {
    if (!searxngQuery.trim()) return
    setSearxngLoading(true)
    try {
      const res = await fetch(`/api/enhanced/ecosystem/searxng/search?q=${encodeURIComponent(searxngQuery)}`)
      const json = await readEcosystemResponse(res)
      const results = classifyEcosystemList<SearxngResult>(json, 'results')
      setSearxngResults(results.items)
      setStatus('searxng', results.state)
      if (results.state.status === 'error' || results.state.status === 'unavailable') {
        toast.error(results.state.reason ?? 'SearXNG lookup failed')
      }
    } catch (err) {
      console.error(err)
      setSearxngResults([])
      setStatus('searxng', { status: 'error', reason: 'SearXNG could not be reached.' })
      toast.error('SearXNG lookup failed')
    } finally {
      setSearxngLoading(false)
    }
  }

  useEffect(() => {
    void fetchHosts()
    void fetchSystems()
    void fetchContainers()
    void fetchRepos()
    void fetchEcosystemCatalog()
    void loadEcosystemData()
    // Periodic refresh
    const interval = setInterval(() => {
      void fetchSystems()
      void fetchContainers()
    }, 15000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  const filteredProcesses = processes.filter((p) => p.reference.toLowerCase().includes(searchProcess.toLowerCase()))

  return (
    <div className="w-full h-full flex flex-col gap-6 text-foreground bg-background">
      <DomainNavbar
        activeDomain={activeDomain}
        onDomainChange={setActiveDomain}
        otherBadgeCount={
          catalogState.status === 'ready'
            ? catalogServices.filter((s) => !COVERED_ECOSYSTEM_SERVICES.has(s)).length
            : null
        }
        loading={loading}
        onRefresh={() => {
          void loadEcosystemData()
          void fetchHosts()
          void fetchSystems()
          void fetchContainers()
          void fetchRepos()
          void fetchEcosystemCatalog()
        }}
      />

      {/* Primary content areas rendering */}
      <div className="flex-1 min-h-[600px] space-y-6">
        {/* 1. DEVOPS & TASKS DOMAIN */}
        {activeDomain === 'devops' && (
          <DevOpsDomain
            ecoStatus={ecoStatus}
            kanbanColumns={kanbanColumns}
            githubRepo={githubRepo}
            onGithubRepoChange={setGithubRepo}
            onLoadGithubRepo={() => {
              window.localStorage.setItem('ecosystem.githubRepo', githubRepo.trim())
              void loadEcosystemData()
            }}
            githubPrs={githubPrs}
            githubWorkflows={githubWorkflows}
            gitlabMrs={gitlabMrs}
            gitlabPipelines={gitlabPipelines}
            portainerStacks={portainerStacks}
          />
        )}

        {/* 2. DATA & RESEARCH DOMAIN */}
        {activeDomain === 'research' && (
          <ResearchDomain
            ecoStatus={ecoStatus}
            resources={resources}
            trainedModels={trainedModels}
            scholarxPapers={scholarxPapers}
          />
        )}

        {/* 3. INFRASTRUCTURE HUB DOMAIN */}
        {activeDomain === 'infra' && (
          <InfraDomain
            ecoStatus={ecoStatus}
            uptimeMonitors={uptimeMonitors}
            searxngQuery={searxngQuery}
            onSearxngQueryChange={setSearxngQuery}
            onRunSearxngSearch={() => {
              void runSearxngSearch()
            }}
            searxngLoading={searxngLoading}
            searxngResults={searxngResults}
            containerInventoryError={containerInventoryError}
            containers={containers}
            onRefreshContainers={() => {
              void fetchContainers()
            }}
            hostsUnavailable={hostsUnavailable}
            hosts={hosts}
            addHostOpen={addHostOpen}
            onAddHostOpenChange={setAddHostOpen}
            onAddHostSubmit={(e) => {
              void handleAddHost(e)
            }}
            newHost={newHost}
            onNewHostChange={setNewHost}
            searchProcess={searchProcess}
            onSearchProcessChange={setSearchProcess}
            onRefreshProcesses={() => {
              void fetchSystems()
            }}
            filteredProcesses={filteredProcesses}
          />
        )}

        {/* 4. LIFESTYLE & AUTOMATION DOMAIN */}
        {activeDomain === 'lifestyle' && (
          <LifestyleDomain
            ecoStatus={ecoStatus}
            haDevices={haDevices}
            nextcloudEvents={nextcloudEvents}
            microsoftEmails={microsoftEmails}
          />
        )}

        {/* 5. MEDIA & UTILITIES DOMAIN */}
        {activeDomain === 'media' && (
          <MediaDomain
            ecoStatus={ecoStatus}
            qbittorrentTorrents={qbittorrentTorrents}
            mediaDownloads={mediaDownloads}
            stirlingJobs={stirlingJobs}
            repos={repos}
            repoInventoryError={repoInventoryError}
            selectedRepos={selectedRepos}
            onSelectedReposChange={setSelectedRepos}
            bulkActionRunning={bulkActionRunning}
            onRunBulkStatus={() => {
              void runBulkRepoAction('status')
            }}
          />
        )}

        {/* 6. OTHER INTEGRATIONS DOMAIN (BUG-018, GOC-25) — the live catalog
            is the availability authority here, not a hard-coded list. Every
            server `/api/enhanced/ecosystem/services` reports that has no
            dedicated card elsewhere in this view (COVERED_ECOSYSTEM_SERVICES)
            gets a generic descriptor with an explicit "no dedicated
            dashboard yet" reason instead of being silently omitted. */}
        {activeDomain === 'other' && <OtherDomain catalogState={catalogState} catalogServices={catalogServices} />}
      </div>
    </div>
  )
}
