import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import KnowledgeView from '@/components/views/KnowledgeView'

/**
 * KnowledgeView fetches `GET /api/enhanced/skills` on mount and filters to
 * `*-docs` entries. These tests exercise the DS-05 status language
 * (`StatusMessage`) its skill list renders: loading while the request is in
 * flight, and the shared empty state when no documentation skills exist.
 */

const DOC_SKILL = {
  id: 'repo-utilities-docs',
  name: 'Repo Utilities Docs',
  description: 'Reference documentation for repo utilities.',
  kind: 'skill' as const,
  status: 'active' as const,
  authority: 'agent_component' as const,
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('KnowledgeView skill-list status language (DS-05)', () => {
  it('shows the shared loading status message while the skill list is in flight', () => {
    global.fetch = vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch
    render(<KnowledgeView />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the shared empty status message when no documentation skills are returned', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([]))) as unknown as typeof fetch
    render(<KnowledgeView />)
    await waitFor(() => {
      expect(screen.getByText('No documentation found.')).toBeInTheDocument()
    })
  })

  it('renders the matching documentation skill once the list resolves', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([DOC_SKILL]))) as unknown as typeof fetch
    render(<KnowledgeView />)
    await waitFor(() => {
      expect(screen.getAllByText('Repo Utilities Docs').length).toBeGreaterThan(0)
    })
  })
})
