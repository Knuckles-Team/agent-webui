# Responsive Arbora workspace coverage and dependency contract

Owner: OVERSTORY-APPS-R045–R050. Snapshot: main `4c77201c4d96bfa8287d6b663df9c69eb56d7d51`, inspected 2026-10-23. This document is the current-state inventory and planned acceptance matrix. It creates no routing authority and claims no backend acceptance. Runtime registry remains `src/lib/nav-registry.ts` plus contributed app routes. Update this current-state document as delivery changes; Git retains history.

## Complete registered destination baseline

Each destination retains its role/capability restriction, compatible URL and deepest detail/action surface. Its standalone page layout is not preserved. It preserves all visible states and manual/WebMCP equivalence. Dynamic route parameters require valid, stale, missing and unauthorized fixtures. Public pages and 404 also remain reachable. Existing `mobile: unsupported` classifications are explicit unresolved migration obligations under OVERSTORY-DESIGN-R004.1, not permission to omit features. Marking a route adapted without functional acceptance does not close that obligation.

| Stable destination | Canonical path | Minimum role | Existing mobile class | Source surface |
|---|---|---|---|---|
| `chat.console` | `/chat` | reader | full | `App.tsx persistent/public surface` |
| `workspace.files` | `/files` | admin | adapted | `@/components/views/FilesView` |
| `workspace.dashboards` | `/data-dashboards` | reader | adapted | `@/components/dashboards/DashboardsView` |
| `workspace.ide` | `/ide` | user | unsupported | `@/components/views/WorkspaceIDEView` |
| `control-plane.sessions` | `/sessions` | user | adapted | `@/components/views/SessionsView` |
| `control-plane.fleet` | `/fleet` | admin | adapted | `@/components/views/FleetView` |
| `control-plane.goals` | `/goals` | admin | adapted | `@/components/views/GoalsView` |
| `control-plane.workflows` | `/workflows` | admin | unsupported | `@/components/views/WorkflowEditorView` |
| `control-plane.prompts` | `/prompts` | admin | adapted | `@/components/views/PromptsView` |
| `control-plane.skills` | `/skills` | maintainer | adapted | `@/components/views/SkillsView` |
| `control-plane.scheduler` | `/scheduling` | admin | adapted | `@/components/views/SchedulingView` |
| `control-plane.sdd` | `/sdd` | maintainer | unsupported | `@/components/views/SDDView` |
| `control-plane.agent-library` | `/agent-library` | maintainer | adapted | `@/components/views/AgentLibraryView` |
| `control-plane.llm-templates` | `/llm-templates` | maintainer | unsupported | `@/components/views/LLMTemplatesView` |
| `control-plane.mcp-apps` | `/mcp-apps` | user | unsupported | `@/components/views/McpAppsView` |
| `console.confirm` | `/console/confirm/:planRef` | reader | adapted | `@/components/views/ConsoleConfirmView` |
| `knowledge.atlas` | `/explore` | reader | adapted | `@/components/views/AtlasView` |
| `knowledge.graph` | `/graph` | reader | adapted | `@/components/views/GraphView` |
| `knowledge.graph-3d` | `/graph-3d` | reader | unsupported | `@/components/views/Graph3DView` |
| `knowledge.graph-3d-lod` | `/graph-3d/lod` | reader | unsupported | `@/components/views/Graph3DLodView` |
| `knowledge.temporal-graph` | `/temporal-graph` | reader | unsupported | `@/components/views/TemporalGraphView` |
| `knowledge.code-graph` | `/code-graph` | admin | unsupported | `@/components/views/CodeGraphView` |
| `knowledge.viz` | `/viz` | reader | adapted | `@/components/views/VizDemoView` |
| `knowledge.extraction` | `/extraction` | user | unsupported | `@/components/views/ExtractionView` |
| `knowledge.object-explorer` | `/explorer` | user | adapted | `@/components/views/ObjectExplorerView` |
| `knowledge.object-detail` | `/object/:id` | reader | adapted | `@/components/views/ObjectView` |
| `knowledge.vertex-explorer` | `/vertex` | user | unsupported | `@/components/views/VertexView` |
| `knowledge.schema` | `/schema` | reader | adapted | `@/components/views/SchemaView` |
| `knowledge.sparql` | `/sparql` | maintainer | unsupported | `@/components/views/SparqlView` |
| `knowledge.cypher` | `/cypher` | admin | unsupported | `@/components/views/CypherReplView` |
| `knowledge.catalogue` | `/catalogue` | user | adapted | `@/components/views/CatalogueView` |
| `knowledge.perspectives` | `/magma` | user | unsupported | `@/components/views/MagmaView` |
| `knowledge.data-analyst` | `/data-analyst` | user | adapted | `@/components/views/DataAnalystView` |
| `knowledge.table-explorer` | `/table-explorer` | admin | unsupported | `@/components/views/TableExplorerView` |
| `knowledge.base` | `/knowledge` | admin | full | `@/components/views/KnowledgeBaseView` |
| `knowledge.memories` | `/memories` | user | adapted | `@/components/views/MemoryView` |
| `observability.dashboard` | `/overview` | reader | full | `@/components/views/DashboardView` |
| `observability.live-dashboards` | `/dashboards` | user | unsupported | `@/components/views/dashboards/LiveDashboardsView` |
| `observability.system-status` | `/system-status` | reader | full | `@/components/views/SystemStatusView` |
| `observability.arbora-readiness` | `/arbora-readiness` | reader | full | `@/components/views/ArboraReadinessView` |
| `observability.observability` | `/observability` | maintainer | unsupported | `@/components/views/ObservabilityView` |
| `observability.broker` | `/broker` | maintainer | unsupported | `@/components/views/BrokerView` |
| `observability.usage` | `/usage` | user | adapted | `@/components/views/UsageView` |
| `integrations.ecosystem` | `/ecosystem` | maintainer | unsupported | `@/components/views/EcosystemView` |
| `integrations.catalog` | `/integrations` | user | adapted | `@/components/views/IntegrationsView` |
| `documentation.learn` | `/learn` | reader | adapted | `@/components/views/LearnView` |
| `documentation.docs` | `/docs` | reader | full | `@/components/views/KnowledgeView` |
| `admin.console` | `/admin` | admin | unsupported | `@/components/views/AdminView` |
| `admin.users` | `/users` | admin | unsupported | `@/components/views/UserManagementView` |
| `admin.ops` | `/ops` | admin | unsupported | `@/components/views/OpsPanelView` |
| `admin.configuration` | `/configuration` | admin | adapted | `@/components/views/ConfigurationView` |
| `public.thank-you` | `/thank-you` | reader | full | `@/components/public/ThankYouPage` |
| `public.privacy` | `/privacy` | reader | full | `@/components/public/PrivacyPage` |
| `public.terms` | `/terms` | reader | full | `@/components/public/TermsPage` |
| `public.contact` | `/contact` | reader | full | `@/components/public/ContactPage` |
| `apps.markets` | `/apps/markets` | user | adapted | `./components/MarketsHome` |
| `apps.markets.news` | `/apps/markets/news` | user | adapted | `./components/MarketsNews` |
| `apps.markets.calendar` | `/apps/markets/calendar` | user | adapted | `./components/MarketsCalendar` |
| `apps.markets.portfolio` | `/apps/markets/portfolio` | user | adapted | `./components/MarketsPortfolio` |
| `apps.markets.menu` | `/apps/markets/menu` | user | adapted | `./components/MarketsMenu` |
| `apps.markets.chart` | `/apps/markets/chart/:listing` | user | adapted | `./components/ChartPage` |
| `apps.markets.share` | `/apps/markets/share/:lease` | user | full | `./components/SharePage` |

## Feature preservation and existing specification owners

| Capability family | Existing implementation seams | Existing owner and proof obligations |
|---|---|---|
| Persistent chat, previous conversations, streaming parts, approvals, elicitation, voice. | `src/Chat.tsx`, `src/components/ChatPanel.tsx`, Part/ApprovalCard/ElicitationModal/VoiceDictationButton; host chat adapters. | OVERSTORY-APPS-R004/R005/R006; preserve shared sessions, run provenance, cancellation, resume and upstream-produced usage, not browser-owned execution. |
| Agents, fleet, goals, sessions, workflow editor, scheduler, prompts, tools, models, SDD. | Existing views and workflow node/inspector/palette; typed clients; `agent/agent_webui/api_extensions.py`. | OVERSTORY-APPS-R004/R005/R006 and OVERSTORY-API-R009; preserve CRUD, validation, role checks and server-owned admission. |
| Atlas query/filter/projection, tables, chart/viz, catalogue/schema/object detail, graph2D/3D/LOD/temporal/code/MAGMA. | `src/lib/atlas/`, `src/components/atlas/`, graph renderers/layout worker and `src/lib/kg-lod/`. | OVERSTORY-APPS-R030, OVERSTORY-API-R002/R008, OVERSTORY-DECIDE; preserve typed query semantics, cursor/purpose/tenant, graph selection and accessible alternatives. |
| Memory, KB ingestion/search/articles, extraction, bookmarks, generated explanations. | Memory/KnowledgeBase/Extraction views and host adapters. | OVERSTORY-APPS-R031/R036/R001.8, OVERSTORY-API-R009; retain source/revision/provenance and explicit unavailable providers. |
| Editor, workspace files, remote extension compatibility. | FilesView, WorkspaceIDEView and editor-context bridge. | OVERSTORY-APPS-R034, OVERSTORY-API-R010; preserve containment and existing admin restriction for unscoped files. Mobile must offer complete usable operations, not a desktop warning. |
| Dashboards and user/agent construction. | `src/lib/dashboards/`, dashboard views/controllers/tools. | OVERSTORY-DASH-R001–R016; existing R003 pie/map/graph, R005 NL/fleet/EG sources, R010 catalog/CAS, R012 sharing and R016 discovery remain open. Local storage is not durable catalog success. |
| Markets scanner/chart/layers/search/calendar/export/share/offline states. | `src/apps/markets/`. | FIN-UI; News and Portfolio currently have explicit unavailable-provider states. Preserve notices, leases and non-trading boundary. Do not fabricate providers. |
| Admin, users, roles, tenant policy, configuration, operations, readiness. | Admin/UserManagement/Configuration/Ops/Readiness views; auth/user-management clients. | OVERSTORY-IDENTITY, OVERSTORY-API-R007/R011; preserve login/logout, policy, step-up, revocation and role gates at every size. |
| Usage, live dashboards, logs/traces/metrics, broker, integrations, ecosystem. | Observability/SystemStatus/Usage/Dashboards/Broker views and API clients. | OVERSTORY-APPS-R004/R006, OVERSTORY-API; source token metrics/timing upstream and bound live streams; never infer live status from mock data. |
| MCP apps and contributed app surfaces. | McpAppHost/McpAppFrame, `src/lib/apps/contract.ts`. | OVERSTORY-APPS-R040–R044/R037; preserve sandbox/manifest validation and no privilege expansion. |
| Public/legal/contact/docs/learn and brand/storage continuity. | Public routes, metadata/site assets, consent and host contact delivery boundary. | OVERSTORY-APPS-R038/R039/R043/R049, OVERSTORY-DESIGN-R008/R009; retain legal content, contact safety, no new telemetry and existing technical identifiers. |

Rows above establish owner families, not acceptance for every operation. The implementation census must list each control/form and join it to its precise existing requirement and backend disposition. Unclassified leaf actions block R045. A declared upstream service operation is checked only against the composed deployment, never from documentation alone.

### Core jobs and evidence disposition (2026-10-25 source review)

These entries extend the existing census, not a new capability registry. They do
not establish installed-provider acceptance or close R045/R049/R050.

| User job and primary control | Exact operation / current disposition | Minimum role | Evidence class and next proof |
|---|---|---|---|
| Give an agent work: visible Chat composer. | Existing chat adapter calls `agents.run`; response text is yielded after the completed turn, not a live step feed. | Reader for `/chat`; user for Chat & tasks. | Source adapter and rendered fixtures; configured provider and actual result still need served proof. |
| Review a returned task: View task details when a real reference exists. | `agents.tasks.list/get`; plan/dependency reads require the selected task's explicit run binding. Independent traces do not establish a conversation association. | User. | Source plus rendered fixtures; complete producer-bound journey remains open. |
| Find stored knowledge: Search knowledge / Record details. | `ontologySearch` and object-detail adapters; checked-in default ontology search/detail handlers explicitly report unavailable. | User. | Source refusal; synthetic records are presentation fixtures, not successful installed search. |
| Check tools and services: Tools & connections. | Fleet status, capability catalog, enhanced tools and readiness reads. Registration does not prove connectivity, authentication or execution permission. | Reader for context; individual controls retain their roles. | Source plus fixtures; check actual composed services independently. |
| Reuse instructions: Saved instructions. | Existing prompt editor; editing does not run or bind a prompt to a task. Workflow Save/Run handlers remain unavailable. | Admin. | Source local/editor behavior; no workflow execution claim. |

## WebMCP baseline and gap closure

Existing five core tools are page context, navigate, Atlas get-state/set-filters/select in `src/lib/webmcp/`. Seven dashboard tools are create/add_panel/update_panel/remove_panel/set_layout/list_data_sources/preview_query in `src/lib/dashboards/tools.ts`. Markets conditionally exposes get-view/search-listings/open-listing/set-scanner-filters/set-chart in `src/apps/markets/webmcp.ts`. This is not complete action coverage. Preserve stable IDs, the existing 64-tool catalog ceiling, schema/result bounds and mounted-context lifecycle. Lazy contextual discovery must keep arbitrary-depth leaves reachable without registering an unbounded catalog.

R047 adds semantic bounded discovery/navigation/read-state/selection/focus/inspector/form-edit/action/undo contracts, not arbitrary clicks. For every action, fixtures compare manual, keyboard and tool paths. Compare visible state, validation failure, ownership/role, exact confirmation, cancellation and stale revision. Security ceremonies can remain explicitly human-only, but the navigation and form context must remain addressable. Browser capability support is recorded separately from application features. No supported browser may lose manual features when WebMCP is absent.

## Dependency and acceptance sequence

| Sequence | Owner | Exit evidence |
|---|---|---|
| Baseline deployment. | OVERSTORY-API-R011.1, OVERSTORY-APPS-R050. | Exact installed WebUI/Arbora/EG/AU/SDK revisions, origin/auth mode, capability availability and positive/negative real-service smoke receipts. |
| Current-state inventory. | OVERSTORY-APPS-R045, OVERSTORY-API-R003.2. | Every route, dynamic leaf, control and backend route is classified with existing spec ownership; orphan/unclassified additions fail CI. |
| Semantic shell/action foundation. | OVERSTORY-APPS-R046/R047/R049. | Existing URLs, persistent chat, map/list/search/back/focus and action-dispatch equivalence; no dropped destinations. |
| Domain reflow. | OVERSTORY-DESIGN-R004.1/R004.2. | Every migrated capability/action usable at narrow, tall, short, wide, zoomed and changing viewports; unsupported cohort eliminated only with evidence. |
| Native tooling and security. | OVERSTORY-APPS-R048, OVERSTORY-IDENTITY, OVERSTORY-API-R007/R011. | Actual supported-browser native tool registration and execution; unsupported fallback and adversarial identity/receipt/cancel tests. |
| Full release qualification. | OVERSTORY-DESIGN-R005.1/R010, OVERSTORY-APPS-R050. | Deepest-leaf keyboard/touch/screen-reader/reduced-motion, measured performance and composed auth/no-auth evidence on exact release candidate. |

Independent presentation/spec work can proceed while missing upstream operations are delivered. Conversation continuation, agent scheduling, approvals/renewal, models, host launch, coding effects, images and session metrics remain backend-owned. They use the same contracts as TUI and geniusbot. WebUI never forks those semantics. Feature-family availability and producer acceptance are separate from UI completeness; unfinished producers remain tracked, not removed from the UI specification.

## Quality and release gates

Run repository bootstrap, spec-standard/spec-status, typecheck, lint and unit/coverage checks. Run browser E2E, production build, host pytest, public-surface and strict documentation checks. Apply configured CCCC/jscpd/dupehound/KISS/native gates without adding duplicate authority. Retain CSP, secret redaction, same-origin policy and no unsolicited telemetry. Evidence records exact commits, commands, browser/device/fixture versions, pass/fail and remaining gaps. New rows remain SPECIFIED until their respective implementation and acceptance actually land.

### Checked composition dependency

Initial co-service startup exposed a missing identity composition seam. The WebUI factory requires a host-provided `SessionBoundary` or complete JWT verifier, including on loopback. The attempted Arbora composition did not provide it and WebUI startup failed. A boundary owns `/auth/*` and presents admitted requests to the existing identity gate. It excludes the built-in WebUI OIDC browser flow. The implementation must resolve this in the correct Arbora identity/composition owner and validate it here under OVERSTORY-APPS-R050 and OVERSTORY-API-R011/R011.1. Do not substitute a no-op boundary, fake bearer or disabled enforcement. OVERSTORY-IDENTITY-R003.1 owns explicit browser no-auth mode. Built-in EG R003.2 and external OIDC R003.3 share lifecycle R010. Implement real anonymous-policy admission rather than weakening authenticated mode. Upstream no-auth support alone does not complete browser no-auth; qualify each intentionally selected composition separately.

Catalog and source discovery use Arbora `query.nl`/`query.uql` through its existing intent tools, not provisional catalog methods. The API consumer plan defines producer ownership. Explicit no-auth and EG integration depend on canonical dispatcher/effect migration and qualified caller/WebSocket contracts. The identity plan documents those dependencies. Conservative refusal scaffolds preserve safety but do not complete the requested features or mobile/WebMCP equivalence.

## Destination absorption map

OVERSTORY-APPS-R049.1 owns this migration. All 58 app destinations below become workspace states, not independent feature pages. Each row retires the old standalone layout after capability acceptance. Legacy addresses remain typed compatibility adapters. Work, Explore and Operate are the only primary contexts. Help is a utility, not a fourth context. Public legal/contact content and the 404 fallback remain available.

| Legacy destination | Compatible address | Context | Replacement state | Absorbed capability |
|---|---|---|---|---|
| `chat.console` | `/chat` | Work. | Conversation / active run. | Persistent conversation, not a chat page. |
| `workspace.files` | `/files` | Work. | Task assets / files. | Scoped file tool in task context. |
| `workspace.dashboards` | `/data-dashboards` | Explore. | Saved analysis / dashboard lens. | Saved workspace composition. |
| `workspace.ide` | `/ide` | Work. | Task assets / editor. | Editor tool over selected repository/file. |
| `control-plane.sessions` | `/sessions` | Work. | Session / run history. | Session switcher and run timeline. |
| `control-plane.fleet` | `/fleet` | Operate. | Fleet / selected host or agent. | Fleet collection and entity inspector. |
| `control-plane.goals` | `/goals` | Work. | Goal / plan. | Goal tree and execution plan. |
| `control-plane.workflows` | `/workflows` | Work. | Plan / workflow editor. | Plan topology tool, not separate app. |
| `control-plane.prompts` | `/prompts` | Work. | Build assets / prompt. | Typed prompt editor. |
| `control-plane.skills` | `/skills` | Work. | Build assets / skill. | Skill library and definition editor. |
| `control-plane.scheduler` | `/scheduling` | Work. | Plan / schedule. | Schedule lens over plans and runs. |
| `control-plane.sdd` | `/sdd` | Work. | Plan / specification. | Specification and evidence tool. |
| `control-plane.agent-library` | `/agent-library` | Work. | Build assets / agent. | Agent definition picker/editor. |
| `control-plane.llm-templates` | `/llm-templates` | Work. | Build assets / model template. | Model template definition editor. |
| `control-plane.mcp-apps` | `/mcp-apps` | Work. | Task tools / sandboxed app. | Scoped sandbox tool surface. |
| `console.confirm` | `/console/confirm/:planRef` | Work. | Active run / approval. | Receipt-bound approval inspector. |
| `knowledge.atlas` | `/explore` | Explore. | Evidence / collection. | Shared query and projection workspace. |
| `knowledge.graph` | `/graph` | Explore. | Evidence / graph lens. | 2D renderer over current selection. |
| `knowledge.graph-3d` | `/graph-3d` | Explore. | Evidence / graph lens. | 3D renderer over same selection. |
| `knowledge.graph-3d-lod` | `/graph-3d/lod` | Explore. | Evidence / graph lens. | LOD setting of same graph renderer. |
| `knowledge.temporal-graph` | `/temporal-graph` | Explore. | Evidence / timeline lens. | Time dimension of same collection. |
| `knowledge.code-graph` | `/code-graph` | Explore. | Evidence / code lens. | Repository relationships with source inspector. |
| `knowledge.viz` | `/viz` | Explore. | Evidence / visualization lens. | Chart/visualization tool, no demo destination. |
| `knowledge.extraction` | `/extraction` | Explore. | Sources / extraction. | Source ingest/extract task inspector. |
| `knowledge.object-explorer` | `/explorer` | Explore. | Evidence / results. | Search/results collection stage. |
| `knowledge.object-detail` | `/object/:id` | Explore. | Evidence / selected entity. | Entity inspector with properties/relationships/history. |
| `knowledge.vertex-explorer` | `/vertex` | Explore. | Evidence / selected entity. | Vertex traversal tool on same entity. |
| `knowledge.schema` | `/schema` | Explore. | Evidence / schema. | Schema lens and type inspector. |
| `knowledge.sparql` | `/sparql` | Explore. | Evidence / query editor. | SPARQL language mode, existing authority retained. |
| `knowledge.cypher` | `/cypher` | Explore. | Evidence / query editor. | Cypher language mode, existing authority retained. |
| `knowledge.catalogue` | `/catalogue` | Explore. | Sources / catalogue. | Discover sources and inspect contracts. |
| `knowledge.perspectives` | `/magma` | Explore. | Evidence / perspective. | Perspective lens on same selected evidence. |
| `knowledge.data-analyst` | `/data-analyst` | Explore. | Evidence / analysis. | Analysis tool attached to collection. |
| `knowledge.table-explorer` | `/table-explorer` | Explore. | Evidence / table lens. | Table projection, not separate page. |
| `knowledge.base` | `/knowledge` | Explore. | Sources / knowledge base. | Ingestion/search/article context. |
| `knowledge.memories` | `/memories` | Explore. | Sources / memory. | Memory collection and record inspector. |
| `observability.dashboard` | `/overview` | Work. | Active work / overview. | Recent work and live run summary, no catalogue home. |
| `observability.live-dashboards` | `/dashboards` | Operate. | Health / dashboard lens. | Live telemetry composition. |
| `observability.system-status` | `/system-status` | Operate. | Health / status. | Health indicators and dependency inspector. |
| `observability.arbora-readiness` | `/arbora-readiness` | Operate. | Health / readiness. | Typed compatibility address replaces history into Operate; contextual diagnostics, full evidence and reprobe preserve supported actions. |
| `observability.observability` | `/observability` | Operate. | Health / trace. | Logs/metrics/traces lenses with run cross-reference. |
| `observability.broker` | `/broker` | Operate. | Services / broker. | Broker entity inspector and controls. |
| `observability.usage` | `/usage` | Operate. | Health / usage. | Usage/cost/token lens with shared run metrics. |
| `integrations.ecosystem` | `/ecosystem` | Operate. | Services / topology. | Integration topology lens. |
| `integrations.catalog` | `/integrations` | Operate. | Services / connectors. | Connector discovery/configuration inspector. |
| `documentation.learn` | `/learn` | Utility. | Help / guided learning. | Contextual help drawer; no primary destination. |
| `documentation.docs` | `/docs` | Utility. | Help / reference. | Searchable reference drawer preserving deep anchors. |
| `admin.console` | `/admin` | Operate. | Policy / administration. | Administration action palette and scoped tools. |
| `admin.users` | `/users` | Operate. | Policy / principals. | Principal/role inspector. |
| `admin.ops` | `/ops` | Operate. | Services / operations. | Existing privileged operations tools. |
| `admin.configuration` | `/configuration` | Operate. | Policy / configuration. | Scoped configuration inspector. |
| `apps.markets` | `/apps/markets` | Explore. | Markets / scanner. | Markets source collection lens. |
| `apps.markets.news` | `/apps/markets/news` | Explore. | Markets / news. | News lens; unavailable provider remains honest. |
| `apps.markets.calendar` | `/apps/markets/calendar` | Explore. | Markets / calendar. | Calendar lens over same market scope. |
| `apps.markets.portfolio` | `/apps/markets/portfolio` | Explore. | Markets / portfolio. | Portfolio lens; unavailable provider remains honest. |
| `apps.markets.menu` | `/apps/markets/menu` | Explore. | Markets / tools. | Contextual action palette, retire menu page. |
| `apps.markets.chart` | `/apps/markets/chart/:listing` | Explore. | Markets / listing. | Selected listing inspector with chart tool. |
| `apps.markets.share` | `/apps/markets/share/:lease` | Explore. | Markets / shared analysis. | Lease-bound read-only workspace state. |

The first redesign proof combines search results, selected entity, relationship traversal and history in one Explore workspace. Retain search and conversation state during traversal. Do not mount the old explorer and detail pages behind tabs. Extract useful domain widgets and clients into the new composition. Native controls, keyboard, touch, deep links and WebMCP use the same controller. Real browser evidence must distinguish mock-service presentation proof from served API acceptance.


### Supported Operate migration evidence

The readiness address now replaces its standalone layout with the contextual Operate panel.
Installed synthetic qualification covered cold entry, heading focus, Back/Forward, keyboard inspection and mobile reprobe.
Catalog filtering, connector selection, tool/skill definitions and refresh remain reachable in the same workspace.
This retires only the readiness layout; other operational destinations and complete migration acceptance remain open.

### Work prompt-authoring source continuation

The Work prompts lens now composes the existing validated admin editor without a second
page wrapper. It preserves investigation selection and in-memory edits across lenses.
It retires editor state at admission changes and keeps `/prompts` as an admin-only compatibility entry into this shared lens.
Lens navigation has manual/WebMCP parity and cannot save a document. Prompt document selection and editing remain local to the shared editor.
Full semantic editor parity, served-provider and native-browser acceptance remain open under R049.1.2.

## Workspace entry migration slice

R045/R049.1/R049.1.2: `/` is now the registry-owned workspace entry, choosing
Work for admitted user-or-higher identities and Operate for readers. Identity
loading and sign-in do not redirect. The unmigrated dashboard remains intact
at `/overview`, reachable through registry navigation. No dashboard feature is
claimed absorbed into Work. `/prompts` resolves to the same Work prompt-authoring
panel with the original admin guard; no other standalone capability is retired.

Browser compatibility replaces the entry rather than adding a Back stop. It keeps
query/fragment context and rejects malformed/conflicting Work state. Tool
navigation uses the same resolution while still rejecting arbitrary provided
query/fragment state. Mounted App tests cover entry, reader fallback, sign-in,
Back/Forward, alias draft continuity and admission retirement. Existing prompt
panel tests retain the manual field/create/save/validation contract. Native
rendered acceptance and semantic prompt form-edit/save parity remain open.

Reader Operate happy-path qualification depends on the narrow fleet-read
classification repair in agent-webui #158. This entry change does not widen
service grants or classify forbidden responses as available data.

The entry tests now mount the actual persistent frame and map from the consolidated shell.
An inert fragment survives entry without hiding the selected Work branch. Map
presentation changes and compatibility links retain the same prompt editor DOM.
This source-mounted integration does not replace native-browser acceptance.
