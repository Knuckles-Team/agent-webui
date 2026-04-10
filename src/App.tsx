import { useState, useEffect } from 'react'
import Chat from './Chat.tsx'
import { AppSidebar } from './components/app-sidebar.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'
import { SidebarProvider, SidebarTrigger } from './components/ui/sidebar.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import { cn } from './lib/utils.ts'
import FilesView from './components/views/FilesView'
import SkillsView from './components/views/SkillsView'
import SchedulingView from './components/views/SchedulingView'
import ConfigurationView from './components/views/ConfigurationView'
import KnowledgeView from './components/views/KnowledgeView'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MCPProvider } from './lib/mcp-context.tsx'

const queryClient = new QueryClient()

export default function App() {
  const [currentView, setCurrentView] = useState('chat')

  useEffect(() => {
    const handleNavigation = () => {
      const path = window.location.pathname
      if (path === '/files') setCurrentView('files')
      else if (path === '/skills') setCurrentView('skills')
      else if (path === '/scheduling') setCurrentView('scheduling')
      else if (path === '/configuration') setCurrentView('configuration')
      else if (path === '/knowledge') setCurrentView('knowledge')
      else setCurrentView('chat')
    }

    window.addEventListener('history-state-changed', handleNavigation)
    handleNavigation()

    return () => {
      window.removeEventListener('history-state-changed', handleNavigation)
    }
  }, [])

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MCPProvider>
          <ThemeProvider defaultTheme="system" storageKey="pydantic-chat-ui-theme">
            <SidebarProvider defaultOpen>
              <AppSidebar />

              <div className="flex flex-col justify-center flex-1 h-screen overflow-hidden">
                {}
                <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:hidden">
                  <SidebarTrigger className="-ml-1" />
                  <div className="flex items-center gap-2 px-3">
                    <span className="text-lg">🤖</span>
                    <span className="text-sm font-bold truncate">Genius Agent</span>
                  </div>
                </header>

                <div
                  className={cn(
                    'flex flex-col mx-auto relative w-full basis-[100vh] overflow-hidden px-4 md:px-8',
                    currentView === 'chat' ? 'block' : 'hidden',
                  )}
                >
                  <Chat />
                </div>

                {currentView !== 'chat' && (
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
                          <h1 className="text-2xl font-bold mb-4">Skills</h1>
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
                          <KnowledgeView />
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </SidebarProvider>
          </ThemeProvider>
        </MCPProvider>
        <Toaster richColors />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
