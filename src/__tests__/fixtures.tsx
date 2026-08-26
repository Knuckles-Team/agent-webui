import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'

// Create a custom render function with providers.
//
// We mount sonner's raw <Toaster /> (not the themed `@/components/ui/sonner`
// wrapper, which depends on a next-themes provider) so that `toast.*` calls the
// views make render into the DOM and success/error messages become assertable —
// mirroring how App.tsx mounts the toaster in production.
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0, // Disable caching for tests
      },
      mutations: {
        retry: false,
      },
    },
  })

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        {ui}
        <Toaster />
      </QueryClientProvider>,
    ),
  }
}

// Mock data fixtures
export const mockGraphStats = {
  total_nodes: 100,
  total_relationships: 200,
}

// The per-type breakdown is its own endpoint (`/graph/node-types`) and its own
// fixture: it is a real engine-side GROUP BY over ALL nodes, not a grouping of
// whatever node page the canvas happens to hold. Note the counts sum to
// `mockGraphStats.total_nodes` on purpose — an aggregate that does not is a
// sample, and telling those apart is the whole point of the split.
export const mockGraphNodeTypes = {
  by_type: {
    Memory: 50,
    Article: 30,
    Tool: 20,
  },
  type_count: 3,
  total_typed_nodes: 100,
  truncated: false,
  available: true,
  source_graphs: ['tenant__test____commons__'],
  degraded_graphs: [],
  partial: false,
}

export const mockGraphNodes = [
  {
    id: 'node1',
    labels: ['Memory'],
    properties: {
      name: 'Test Memory',
      content: 'Test content',
      importance: 0.8,
    },
  },
  {
    id: 'node2',
    labels: ['Article'],
    properties: {
      title: 'Test Article',
      content: 'Article content',
    },
  },
]

export const mockGraphRelationships = [
  {
    source: 'node1',
    type: 'RELATED_TO',
    target: 'node2',
  },
]

export const mockKnowledgeBase = {
  id: 'test_kb',
  name: 'Test Knowledge Base',
  article_count: 10,
  topics: ['AI', 'Testing', 'Documentation'],
  health_status: 'healthy' as const,
  last_updated: new Date().toISOString(),
}

export const mockMemoryNode = {
  id: 'mem1',
  content: 'Test memory content',
  importance: 0.8,
  tags: ['test', 'memory'],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export const mockArticle = {
  id: 'article1',
  title: 'Test Article',
  content: 'Article content here',
  kb_id: 'test_kb',
  concepts: ['AI', 'Testing'],
  created_at: new Date().toISOString(),
}

export const mockSpec = {
  id: 'spec1',
  title: 'Test Feature',
  description: 'Test feature description',
  user_stories: ['As a user, I want...'],
  acceptance_criteria: ['Given... When... Then...'],
  status: 'draft' as const,
  created_at: new Date().toISOString(),
}

export const mockPlan = {
  id: 'plan1',
  spec_id: 'spec1',
  technical_approach: 'Test technical approach',
  status: 'draft' as const,
  created_at: new Date().toISOString(),
}

export const mockTask = {
  id: 'task1',
  plan_id: 'plan1',
  title: 'Test Task',
  description: 'Test task description',
  dependencies: [],
  status: 'pending' as const,
  parallel: false,
}
