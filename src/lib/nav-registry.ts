/**
 * @file nav-registry.ts
 * @description The single declarative source of truth for every page in agent-webui.
 *
 * `ROUTES` is what the sidebar, the router, the mobile layout, and (eventually) the
 * role filter and the agent's page-navigation tool all derive from. Adding a page
 * means adding one entry here — there is no second place that declares a page.
 *
 * A route whose `path` contains a `:segment` (e.g. `/object/:id`) is a detail/drill-down
 * route reached by navigating from another page rather than a top-level destination, so
 * `routesBySection` (used by the sidebar) excludes it; `matchRoute` still resolves it.
 */
import { createElement, lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  Activity,
  Bot,
  Book,
  BookOpen,
  Boxes,
  Brain,
  Calendar,
  Code2,
  Compass,
  Coins,
  Cpu,
  Database,
  FileCheck2,
  Files,
  Gauge,
  GraduationCap,
  History,
  Inbox,
  LayoutDashboard,
  LibraryBig,
  ListTodo,
  MessageCircle,
  Network,
  ScrollText,
  Settings,
  Shapes,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Terminal,
  Waypoints,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** Minimum role required to see/use a route. Enforced in two places, both derived from
 * this same field: {@link roleAtLeast} filters the sidebar and gates route rendering in
 * `App.tsx` (UI), and `agent/agent_webui/rbac.py` enforces the equivalent ladder
 * server-side in `WebUIAuthorizationMiddleware` — a hidden nav item alone is not a
 * permission. */
export type Role = 'reader' | 'user' | 'maintainer' | 'admin'

/** Ascending privilege order — index is the rank `roleAtLeast` compares. */
export const ROLE_ORDER: readonly Role[] = ['reader', 'user', 'maintainer', 'admin']

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLE_ORDER as readonly string[]).includes(value)
}

/** True when `role` carries at least the privilege of `minimum` on the reader<user<
 * maintainer<admin ladder. Unknown roles rank below every declared role (fail closed). */
export function roleAtLeast(role: Role | null | undefined, minimum: Role): boolean {
  const roleRank = role ? ROLE_ORDER.indexOf(role) : -1
  return roleRank >= ROLE_ORDER.indexOf(minimum)
}

/** The eight top-level information-architecture sections (charter: agent-webui IA table). */
export type SectionId =
  'chat' | 'workspace' | 'control-plane' | 'knowledge' | 'observability' | 'integrations' | 'documentation' | 'admin'

export interface SectionMeta {
  id: SectionId
  label: string
}

/** Section display order, top to bottom in the sidebar. */
export const SECTIONS: readonly SectionMeta[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'control-plane', label: 'Control Plane' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'observability', label: 'Observability' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'admin', label: 'Admin' },
]

export interface RouteDef {
  /** Stable identifier, e.g. 'knowledge.graph'. Never reused, never renumbered. */
  id: string
  path: string
  label: string
  section: SectionId
  /** One plain-English sentence: what this page does FOR THE USER. No jargon. Mandatory. */
  blurb: string
  /** Slug into the Documentation section's "What is this?" entry, once one exists. */
  docs?: string
  icon: LucideIcon
  minRole: Role
  /** Backend capability id gating visibility; hidden unless the backend reports it available. */
  capability?: string
  element: LazyExoticComponent<ComponentType>
  mobile: 'full' | 'adapted' | 'unsupported'
}

export const ROUTES: readonly RouteDef[] = [
  // ---------------------------------------------------------------- Chat
  {
    id: 'chat.console',
    path: '/chat',
    label: 'Chat',
    section: 'chat',
    blurb: 'Talk with the assistant and pick up any past conversation.',
    icon: MessageCircle,
    minRole: 'reader',
    mobile: 'full',
    // ChatPanel is a persistent, prop-driven singleton (full-page on /chat, drawer
    // elsewhere) mounted once at the App shell rather than swapped in by route — see
    // App.tsx. This element exists so Chat is still a first-class registry entry for
    // the sidebar/docs/role metadata; the router does not use it to mount the page.
    element: lazy(() =>
      import('@/components/ChatPanel').then((mod) => ({
        default: () => createElement(mod.default, { currentView: 'chat', isPrimary: true }),
      })),
    ),
  },

  // ------------------------------------------------------------ Workspace
  {
    id: 'workspace.files',
    path: '/files',
    label: 'Workspace Files',
    section: 'workspace',
    blurb: 'Browse, open, and edit the files in your project workspace.',
    icon: Files,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/FilesView')),
  },
  {
    id: 'workspace.ide',
    path: '/ide',
    label: 'IDE',
    section: 'workspace',
    blurb:
      'A full VS Code editor on your workspace, right inside the app -- the agent can see what file and selection you have open.',
    icon: Code2,
    minRole: 'user',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/WorkspaceIDEView')),
  },
  // -------------------------------------------------------- Control Plane
  {
    id: 'control-plane.sessions',
    path: '/sessions',
    label: 'Active Sessions',
    section: 'control-plane',
    blurb: "See every agent session that's running or has run, and jump back into one.",
    icon: Terminal,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/SessionsView')),
  },
  {
    id: 'control-plane.fleet',
    path: '/fleet',
    label: 'Fleet Supervisor',
    section: 'control-plane',
    blurb: 'Watch the health of every agent group and pause or stop them in an emergency.',
    icon: Activity,
    minRole: 'maintainer',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/FleetView')),
  },
  {
    id: 'control-plane.goals',
    path: '/goals',
    label: 'Autonomous Goals',
    section: 'control-plane',
    blurb: 'Set a goal in plain English and let agents work toward it on their own.',
    icon: Compass,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/GoalsView')),
  },
  {
    id: 'control-plane.workflows',
    path: '/workflows',
    label: 'Workflows',
    section: 'control-plane',
    blurb: 'Build and run step-by-step automations by connecting agent actions together.',
    icon: Workflow,
    minRole: 'user',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/WorkflowEditorView')),
  },
  {
    id: 'control-plane.prompts',
    path: '/prompts',
    label: 'Prompts Registry',
    section: 'control-plane',
    blurb: 'Write and save the instructions that tell an agent how to behave.',
    icon: ScrollText,
    minRole: 'maintainer',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/PromptsView')),
  },
  {
    id: 'control-plane.skills',
    path: '/skills',
    label: 'Tools',
    section: 'control-plane',
    blurb: 'Turn agent tools, MCP servers, and skills on or off.',
    icon: Zap,
    minRole: 'maintainer',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/SkillsView')),
  },
  {
    id: 'control-plane.scheduler',
    path: '/scheduling',
    label: 'Scheduler',
    section: 'control-plane',
    blurb: 'See upcoming and past scheduled jobs, and set up new ones to run automatically.',
    icon: Calendar,
    minRole: 'maintainer',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/SchedulingView')),
  },
  {
    id: 'control-plane.sdd',
    path: '/sdd',
    label: 'Specs & Plans',
    section: 'control-plane',
    blurb: 'Turn a feature idea into a written spec, an implementation plan, and trackable tasks.',
    icon: ListTodo,
    minRole: 'maintainer',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/SDDView')),
  },
  {
    id: 'control-plane.agent-library',
    path: '/agent-library',
    label: 'Agent Library',
    section: 'control-plane',
    blurb:
      'Compose your own agents from prompts and tools, or add outside agents, and call on them whenever you need.',
    icon: Bot,
    minRole: 'maintainer',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/AgentLibraryView')),
  },
  {
    id: 'control-plane.unified-agent-view',
    path: '/agent-view',
    label: 'Unified Agent View',
    section: 'control-plane',
    blurb: 'Browse and try every action, tool, and skill your agents can use, and watch runs execute live.',
    icon: Sparkles,
    minRole: 'user',
    mobile: 'unsupported',
    // Replaces the floating "Capabilities" button — same component, now a page.
    element: lazy(() =>
      import('@/components/capabilities/CapabilityWorkbench').then((mod) => ({ default: mod.CapabilityWorkbench })),
    ),
  },
  {
    id: 'control-plane.llm-templates',
    path: '/llm-templates',
    label: 'LLM Templates',
    section: 'control-plane',
    blurb: 'Pick a model, tune its parameters, and pair it with a system prompt to build a reusable agent template.',
    icon: SlidersHorizontal,
    minRole: 'maintainer',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/LLMTemplatesView')),
  },

  // ------------------------------------------------------------- Knowledge
  {
    id: 'knowledge.graph',
    path: '/graph',
    label: 'Knowledge Graph',
    section: 'knowledge',
    blurb: 'Explore how people, systems, and ideas connect as an interactive graph.',
    icon: Network,
    minRole: 'reader',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/GraphView')),
  },
  {
    id: 'knowledge.temporal-graph',
    path: '/temporal-graph',
    label: 'Temporal Graph',
    section: 'knowledge',
    blurb: 'Rewind the knowledge graph to see what it looked like at any point in time.',
    icon: History,
    minRole: 'reader',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/TemporalGraphView')),
  },
  {
    id: 'knowledge.code-graph',
    path: '/code-graph',
    label: 'Code Graph',
    section: 'knowledge',
    blurb: 'Trace how a piece of code is used and what it depends on, across every repository.',
    icon: Code2,
    minRole: 'user',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/CodeGraphView')),
  },
  {
    id: 'knowledge.viz',
    path: '/viz',
    label: 'Visualizations',
    section: 'knowledge',
    blurb: 'High-density charts and graph renders, generated server-side through the eg-viz LOD pipeline.',
    icon: Zap,
    minRole: 'reader',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/VizDemoView')),
  },
  {
    id: 'knowledge.extraction',
    path: '/extraction',
    label: 'KG Extraction',
    section: 'knowledge',
    blurb: 'Turn a document or web page into structured knowledge-graph facts.',
    icon: Network,
    minRole: 'user',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/ExtractionView')),
  },
  {
    id: 'knowledge.object-explorer',
    path: '/explorer',
    label: 'Object Explorer',
    section: 'knowledge',
    blurb: 'Search, filter, and bulk-edit sets of knowledge-graph objects at once.',
    icon: Boxes,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/ObjectExplorerView')),
  },
  {
    id: 'knowledge.object-detail',
    path: '/object/:id',
    label: 'Object',
    section: 'knowledge',
    blurb: 'See everything known about one object: its properties, links, and history.',
    icon: Boxes,
    minRole: 'reader',
    mobile: 'adapted',
    // Requires an `id` route param the generic zero-prop element cannot carry; the
    // router special-cases this path the same way it special-cases Chat (see App.tsx),
    // so this element is never mounted through the generic contract — the cast only
    // satisfies RouteDef's shared type.
    element: lazy(() => import('@/components/views/ObjectView')) as unknown as LazyExoticComponent<ComponentType>,
  },
  {
    id: 'knowledge.vertex-explorer',
    path: '/vertex',
    label: 'Vertex Explorer',
    section: 'knowledge',
    blurb: "Expand outward from an object on a graph canvas and test 'what if' changes.",
    icon: Waypoints,
    minRole: 'user',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/VertexView')),
  },
  {
    id: 'knowledge.schema',
    path: '/schema',
    label: 'Schema View',
    section: 'knowledge',
    blurb: 'See the types of things the knowledge graph can hold and how they relate.',
    icon: Shapes,
    minRole: 'reader',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/SchemaView')),
  },
  {
    id: 'knowledge.sparql',
    path: '/sparql',
    label: 'SPARQL & SHACL',
    section: 'knowledge',
    blurb: 'Write advanced graph queries and check data against validation rules.',
    icon: FileCheck2,
    minRole: 'maintainer',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/SparqlView')),
  },
  {
    id: 'knowledge.cypher',
    path: '/cypher',
    label: 'Cypher Console',
    section: 'knowledge',
    blurb: 'Run raw graph-database queries directly against the knowledge graph.',
    icon: Terminal,
    minRole: 'maintainer',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/CypherReplView')),
  },
  {
    id: 'knowledge.catalogue',
    path: '/catalogue',
    label: 'Ontology Catalogue',
    section: 'knowledge',
    blurb: 'Browse, search, and import ready-made ontologies to extend the knowledge graph.',
    icon: LibraryBig,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/CatalogueView')),
  },
  {
    id: 'knowledge.perspectives',
    path: '/magma',
    label: 'Perspective Views',
    section: 'knowledge',
    blurb: 'Look at the same knowledge through different lenses, like cause-and-effect or time.',
    icon: Compass,
    minRole: 'user',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/MagmaView')),
  },
  {
    id: 'knowledge.data-analyst',
    path: '/data-analyst',
    label: 'Data Analyst',
    section: 'knowledge',
    blurb: 'Ask a question in plain English and get back a chart or table of the answer.',
    icon: Database,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/DataAnalystView')),
  },
  {
    id: 'knowledge.base',
    path: '/knowledge',
    label: 'Knowledge Base',
    section: 'knowledge',
    blurb: 'Search the documents and notes the agent has been given to work from.',
    icon: Book,
    minRole: 'reader',
    mobile: 'full',
    element: lazy(() => import('@/components/views/KnowledgeBaseView')),
  },
  {
    id: 'knowledge.memories',
    path: '/memories',
    label: 'Memories',
    section: 'knowledge',
    blurb: 'See and manage the facts the agent has chosen to remember about you and your work.',
    icon: Brain,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/MemoryView')),
  },

  // ---------------------------------------------------------- Observability
  {
    id: 'observability.dashboard',
    path: '/',
    label: 'Dashboard',
    section: 'observability',
    blurb: "See an at-a-glance overview of your agent system's health and recent activity.",
    icon: LayoutDashboard,
    minRole: 'reader',
    mobile: 'full',
    element: lazy(() => import('@/components/views/DashboardView')),
  },
  {
    id: 'observability.live-dashboards',
    path: '/dashboards',
    label: 'Live Dashboards',
    section: 'observability',
    blurb: 'Build live charts of metrics, logs, and traces from across the system.',
    icon: LayoutDashboard,
    minRole: 'user',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/dashboards/LiveDashboardsView')),
  },
  {
    id: 'observability.system-status',
    path: '/system-status',
    label: 'System Status',
    section: 'observability',
    blurb: 'Check whether every backend capability the agent depends on is up and responding.',
    icon: Gauge,
    minRole: 'reader',
    mobile: 'full',
    element: lazy(() => import('@/components/views/SystemStatusView')),
  },
  {
    id: 'observability.observability',
    path: '/observability',
    label: 'Observability',
    section: 'observability',
    blurb: "Dig into performance metrics and request traces to find what's slow or broken.",
    icon: Activity,
    minRole: 'maintainer',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/ObservabilityView')),
  },
  {
    id: 'observability.broker',
    path: '/broker',
    label: 'Message Broker',
    section: 'observability',
    blurb: 'See what messages are queued between agents and publish a message yourself.',
    icon: Inbox,
    minRole: 'maintainer',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/BrokerView')),
  },
  {
    id: 'observability.usage',
    path: '/usage',
    label: 'Usage & Cost',
    section: 'observability',
    blurb: 'See how much every agent costs to run, broken down by model and time.',
    icon: Coins,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/UsageView')),
  },

  // ---------------------------------------------------------- Integrations
  {
    id: 'integrations.ecosystem',
    path: '/ecosystem',
    label: 'Ecosystem Hub',
    section: 'integrations',
    blurb: 'See every host, container, and network tunnel your agents run on, mapped out.',
    icon: Cpu,
    minRole: 'maintainer',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/EcosystemView')),
  },

  // --------------------------------------------------------- Documentation
  {
    id: 'documentation.learn',
    path: '/learn',
    label: 'Ontology School',
    section: 'documentation',
    blurb: 'Take short lessons and quizzes that teach you how the knowledge graph works.',
    icon: GraduationCap,
    minRole: 'reader',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/LearnView')),
  },
  {
    id: 'documentation.docs',
    path: '/docs',
    label: 'Documentation',
    section: 'documentation',
    blurb: 'Read the guide for any tool or feature to see what it does and how to use it.',
    icon: BookOpen,
    minRole: 'reader',
    mobile: 'full',
    element: lazy(() => import('@/components/views/KnowledgeView')),
  },

  // ---------------------------------------------------------------- Admin
  {
    id: 'admin.console',
    path: '/admin',
    label: 'Admin Console',
    section: 'admin',
    blurb: 'Manage tenants, storage shards, access roles, and backups for the whole system.',
    icon: ShieldCheck,
    minRole: 'admin',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/AdminView')),
  },
  {
    id: 'admin.ops',
    path: '/ops',
    label: 'Ops Panel',
    section: 'admin',
    blurb: 'Run maintenance jobs and check on background pipelines and resources.',
    icon: Wrench,
    minRole: 'maintainer',
    mobile: 'unsupported',
    element: lazy(() => import('@/components/views/OpsPanelView')),
  },
  {
    id: 'admin.configuration',
    path: '/configuration',
    label: 'Global Settings',
    section: 'admin',
    blurb: 'Change system-wide agent and workspace configuration settings.',
    icon: Settings,
    minRole: 'admin',
    mobile: 'adapted',
    element: lazy(() => import('@/components/views/ConfigurationView')),
  },
]

/** True if `path` contains a `:param` segment (a detail route, not a nav destination). */
export function isDynamicPath(path: string): boolean {
  return path.includes(':')
}

/** Routes belonging to `section`, in declaration order, excluding dynamic-param routes. */
export function routesBySection(section: SectionId): RouteDef[] {
  return ROUTES.filter((route) => route.section === section && !isDynamicPath(route.path))
}

/** Matches a pathname against a route `path` pattern, extracting any `:param` segments. */
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i]
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i])
    } else if (part !== pathParts[i]) {
      return null
    }
  }
  return params
}

/** Resolves a pathname to its RouteDef and any extracted params, or null if unregistered. */
export function matchRoute(pathname: string): { route: RouteDef; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (!isDynamicPath(route.path)) {
      if (route.path === pathname) return { route, params: {} }
      continue
    }
    const params = matchPath(route.path, pathname)
    if (params) return { route, params }
  }
  return null
}
