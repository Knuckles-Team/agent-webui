/**
 * @file App.tsx
 * @description Root application component for the Agent Web Quickstart.
 *
 * Orchestrates the overall layout, theme management, sidebar navigation,
 * and routing between different views (Chat, Files, Skills, Scheduling, etc.).
 * Initializes the React Query client and MCP context provider.
 */

import { useState, useEffect, useMemo } from 'react'
import { AppSidebar } from './components/app-sidebar.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'
import { SidebarProvider, SidebarTrigger } from './components/ui/sidebar.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import { cn } from './lib/utils.ts'
import ChatPanel from './components/ChatPanel'
import { CapabilityWorkbench } from './components/capabilities/CapabilityWorkbench'
import DashboardView from './components/views/DashboardView'
import FilesView from './components/views/FilesView'
import SkillsView from './components/views/SkillsView'
import SchedulingView from './components/views/SchedulingView'
import ConfigurationView from './components/views/ConfigurationView'
import KnowledgeBaseView from './components/views/KnowledgeBaseView'
import GraphView from './components/views/GraphView'
import TemporalGraphView from './components/views/TemporalGraphView'
import CodeGraphView from './components/views/CodeGraphView'
import ExtractionView from './components/views/ExtractionView'
import OpsPanelView from './components/views/OpsPanelView'
import MagmaView from './components/views/MagmaView'
import CypherReplView from './components/views/CypherReplView'
import PromptsView from './components/views/PromptsView'
import SessionsView from './components/views/SessionsView'
import GoalsView from './components/views/GoalsView'
import FleetView from './components/views/FleetView'
import EcosystemView from './components/views/EcosystemView'
import WorkflowEditorView from './components/views/WorkflowEditorView'
import ObjectExplorerView from './components/views/ObjectExplorerView'
import ObjectView from './components/views/ObjectView'
import VertexView from './components/views/VertexView'
import SchemaView from './components/views/SchemaView'
import SparqlView from './components/views/SparqlView'
import CatalogueView from './components/views/CatalogueView'
import LearnView from './components/views/LearnView'
import UsageView from './components/views/UsageView'
import SweView from './components/views/SweView'
import ObservabilityView from './components/views/ObservabilityView'
import DataAnalystView from './components/views/DataAnalystView'
import BrokerView from './components/views/BrokerView'
import SystemStatusView from './components/views/SystemStatusView'
import LiveDashboardsView from './components/views/dashboards/LiveDashboardsView'
import AdminView from './components/views/AdminView'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MCPProvider } from './lib/mcp-context.tsx'
import { getDefaultPageActions, PageContextProvider, type PageContextSelection } from './lib/page-context.tsx'

/**
 * Global React Query client instance for managing server state.
 */
const queryClient = new QueryClient()

/**
 * Root Application Component
 *
 * Manages view state based on URL path and provides the necessary context
 * providers for theme, sidebar, MCP tools, and data fetching.
 */
export default function App() {
  /** Possible views: 'dashboard', 'chat', 'files', 'skills', 'scheduling', 'configuration', 'knowledge', 'graph', 'workflows', 'ops', 'magma', 'cypher', 'prompts', 'sessions', 'goals', 'ecosystem', 'explorer', 'object', 'vertex', 'schema', 'sparql', 'catalogue', 'learn', 'observability', 'dataanalyst', 'broker', 'systemstatus' */
  const [currentView, setCurrentView] = useState('dashboard')
  /** Selected ontology object id, parsed from the `/object/:id` path. */
  const [objectId, setObjectId] = useState('')
  /** Exact route included in the assistant's typed page-context envelope. */
  const [currentRoute, setCurrentRoute] = useState(() => `${window.location.pathname}${window.location.search}`)

  /**
   * Effect hook to synchronize the current view with the browser URL path.
   * Listens for custom 'history-state-changed' events for reactive navigation.
   */
  useEffect(() => {
    const handleNavigation = () => {
      const path = window.location.pathname
      setCurrentRoute(`${path}${window.location.search}`)
      if (path === '/') setCurrentView('dashboard')
      else if (path === '/chat') setCurrentView('chat')
      else if (path === '/files') setCurrentView('files')
      else if (path === '/skills') setCurrentView('skills')
      else if (path === '/scheduling') setCurrentView('scheduling')
      else if (path === '/configuration') setCurrentView('configuration')
      else if (path === '/knowledge') setCurrentView('knowledge')
      else if (path === '/graph') setCurrentView('graph')
      else if (path === '/temporal-graph') setCurrentView('temporalgraph')
      else if (path === '/code-graph') setCurrentView('codegraph')
      else if (path === '/extraction') setCurrentView('extraction')
      else if (path === '/ops') setCurrentView('ops')
      else if (path === '/magma') setCurrentView('magma')
      else if (path === '/cypher') setCurrentView('cypher')
      else if (path === '/prompts') setCurrentView('prompts')
      else if (path === '/sessions') setCurrentView('sessions')
      else if (path === '/goals') setCurrentView('goals')
      else if (path === '/fleet') setCurrentView('fleet')
      else if (path === '/ecosystem') setCurrentView('ecosystem')
      else if (path === '/usage') setCurrentView('usage')
      else if (path === '/swe') setCurrentView('swe')
      else if (path === '/observability') setCurrentView('observability')
      else if (path === '/data-analyst') setCurrentView('dataanalyst')
      else if (path === '/broker') setCurrentView('broker')
      else if (path === '/system-status') setCurrentView('systemstatus')
      else if (path === '/dashboards') setCurrentView('dashboards')
      else if (path === '/admin') setCurrentView('admin')
      else if (path === '/workflows') setCurrentView('workflows')
      else if (path === '/explorer') setCurrentView('explorer')
      else if (path === '/vertex') setCurrentView('vertex')
      else if (path === '/schema') setCurrentView('schema')
      else if (path === '/sparql') setCurrentView('sparql')
      else if (path === '/catalogue') setCurrentView('catalogue')
      else if (path === '/learn') setCurrentView('learn')
      else if (path.startsWith('/object/')) {
        setObjectId(decodeURIComponent(path.slice('/object/'.length)))
        setCurrentView('object')
      } else setCurrentView('chat')
    }

    // Listen for custom navigation events emitted by sidebar/links
    window.addEventListener('history-state-changed', handleNavigation)
    handleNavigation() // Initial check on mount

    return () => {
      window.removeEventListener('history-state-changed', handleNavigation)
    }
  }, [])

  const baseSelection = useMemo<PageContextSelection[]>(
    () => (currentView === 'object' && objectId ? [{ kind: 'ontology-object', id: objectId, label: objectId }] : []),
    [currentView, objectId],
  )
  const allowedActions = useMemo(() => getDefaultPageActions(currentView), [currentView])

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MCPProvider>
          <ThemeProvider defaultTheme="system" storageKey="pydantic-chat-ui-theme">
            <PageContextProvider
              route={currentRoute}
              view={currentView}
              baseSelection={baseSelection}
              allowedActions={allowedActions}
            >
              <SidebarProvider defaultOpen>
                <AppSidebar />

                <div className="flex flex-col justify-center flex-1 h-screen overflow-hidden">
                  {/* Mobile Header: Only visible on small screens */}
                  <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:hidden">
                    <SidebarTrigger className="-ml-1" />
                    <div className="flex items-center gap-2 px-3">
                      <span className="text-lg">🤖</span>
                      <span className="text-sm font-bold truncate">Genius Agent</span>
                    </div>
                  </header>

                  {/* Dashboard View — Agent-OS Homepage (default landing) */}
                  <div
                    className={cn(
                      'flex flex-col w-full h-full overflow-hidden',
                      currentView === 'dashboard' ? 'block' : 'hidden',
                    )}
                  >
                    <DashboardView />
                  </div>

                  {/* Secondary Views (Rendered conditionally) */}
                  {currentView !== 'chat' && currentView !== 'dashboard' && (
                    <div className="flex flex-col flex-1 h-screen overflow-auto p-8">
                      <div className="mx-auto w-full">
                        {currentView === 'files' && (
                          <>
                            <h1 className="text-2xl font-bold mb-4">Files</h1>
                            <FilesView />
                          </>
                        )}
                        {currentView === 'skills' && (
                          <>
                            <h1 className="text-2xl font-bold mb-4">Tools</h1>
                            <SkillsView />
                          </>
                        )}
                        {currentView === 'scheduling' && (
                          <>
                            <h1 className="text-2xl font-bold mb-4">Scheduling</h1>
                            <SchedulingView />
                          </>
                        )}
                        {currentView === 'configuration' && (
                          <>
                            <h1 className="text-2xl font-bold mb-4">Configuration</h1>
                            <ConfigurationView />
                          </>
                        )}
                        {currentView === 'knowledge' && (
                          <>
                            <h1 className="text-2xl font-bold mb-4">Knowledge</h1>
                            <KnowledgeBaseView />
                          </>
                        )}
                        {currentView === 'graph' && <GraphView />}
                        {currentView === 'temporalgraph' && <TemporalGraphView />}
                        {currentView === 'codegraph' && <CodeGraphView />}
                        {currentView === 'extraction' && <ExtractionView />}
                        {currentView === 'workflows' && <WorkflowEditorView />}
                        {currentView === 'ops' && <OpsPanelView />}
                        {currentView === 'magma' && <MagmaView />}
                        {currentView === 'cypher' && <CypherReplView />}
                        {currentView === 'prompts' && (
                          <>
                            <h1 className="text-2xl font-bold mb-4">Prompts</h1>
                            <PromptsView />
                          </>
                        )}
                        {currentView === 'sessions' && <SessionsView />}
                        {currentView === 'goals' && <GoalsView />}
                        {currentView === 'fleet' && <FleetView />}
                        {currentView === 'ecosystem' && <EcosystemView />}
                        {currentView === 'usage' && <UsageView />}
                        {currentView === 'swe' && <SweView />}
                        {currentView === 'observability' && <ObservabilityView />}
                        {currentView === 'dataanalyst' && <DataAnalystView />}
                        {currentView === 'broker' && <BrokerView />}
                        {currentView === 'systemstatus' && <SystemStatusView />}
                        {currentView === 'dashboards' && <LiveDashboardsView />}
                        {currentView === 'admin' && <AdminView />}
                        {currentView === 'explorer' && <ObjectExplorerView />}
                        {currentView === 'vertex' && <VertexView />}
                        {currentView === 'schema' && <SchemaView />}
                        {currentView === 'sparql' && <SparqlView />}
                        {currentView === 'catalogue' && <CatalogueView />}
                        {currentView === 'learn' && <LearnView />}
                        {currentView === 'object' && (
                          <ObjectView
                            objectId={objectId}
                            onNavigate={(id) => {
                              window.history.pushState({}, '', `/object/${encodeURIComponent(id)}`)
                              window.dispatchEvent(new Event('history-state-changed'))
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                  {/* Live catalog, schema-generated actions, results, and run inspection — mounted once for every route. */}
                  <CapabilityWorkbench />
                  {/* One stable assistant instance: full-page on /chat, drawer everywhere else. */}
                  <ChatPanel currentView={currentView} isPrimary={currentView === 'chat'} />
                </div>
              </SidebarProvider>
            </PageContextProvider>
          </ThemeProvider>
        </MCPProvider>
        <Toaster richColors />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
