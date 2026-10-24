// spec: WEBUI-APPS-R049.1.2, WEBUI-APPS-R049.1.3
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { parseWorkState, navigateWork, workHref } from '@/lib/work-workspace'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import type { Role } from '@/lib/nav-registry'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { WorkPromptLens } from '../WorkPromptLens'
const captured = vi.hoisted(() => ({ tool: null as WebMcpToolDefinition | null }))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    captured.tool = tools[0]
  },
}))
const writes: unknown[] = []
function Harness({ userRole = 'admin', owner = 'owner-a' }: { userRole?: Role; owner?: string }) {
  const state = parseWorkState(useWorkspaceLocation())
  return <WorkPromptLens key={`${owner}:${userRole}`} role={userRole} state={state} />
}
beforeEach(() => {
  writes.length = 0
  captured.tool = null
  window.history.replaceState({}, '', '/workspace/work?conversation=conversation-a&task=task-a&run=trace-a')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        writes.push(JSON.parse(init.body as string))
        return Response.json({ status: 'success' })
      }
      return Response.json(
        url.endsWith('/prompts')
          ? [{ name: 'sample', title: 'Sample prompt', goal: '', core_directive: '', file_path: 'sample.json' }]
          : { title: 'Sample prompt', identity: { role: 'Original role' }, tools: [] },
      )
    }),
  )
})
it('round trips strict lens URLs without leaking drafts or losing task context', () => {
  const state = parseWorkState('/workspace/work?conversation=c&task=t&run=r&node=n&lens=prompts')
  expect(parseWorkState(workHref(state))).toEqual(state)
  expect(() => parseWorkState('/workspace/work?lens=prompts&lens=investigation')).toThrow()
  expect(() => parseWorkState('/workspace/work?lens=other')).toThrow()
  expect(() => parseWorkState('/workspace/work?lens=prompts&draft=private')).toThrow()
  expect(() => navigateWork(state, 'user')).toThrow('not permitted')
})
it('uses the existing editor and preserves unsaved edits across lenses without saving', async () => {
  renderWithProviders(<Harness />)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('link', { name: 'Prompt authoring' }))
  const role = await screen.findByRole('textbox', { name: 'Role / Title' })
  fireEvent.change(role, { target: { value: 'Unsaved investigation instructions' } })
  fireEvent.click(screen.getByRole('link', { name: 'Investigation' }))
  expect(screen.queryByRole('textbox', { name: 'Role / Title' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Prompt authoring' }))
  expect(screen.getByRole('textbox', { name: 'Role / Title' })).toHaveValue('Unsaved investigation instructions')
  expect(window.location.search).toContain('task=task-a')
  expect(window.location.search).toContain('conversation=conversation-a')
  expect(window.location.search).toContain('run=trace-a')
  expect(window.location.search).not.toContain('Unsaved')
  expect(writes).toEqual([])
})
it('shares semantic selection while retiring old handles after navigation and admission changes', async () => {
  const view = renderWithProviders(<Harness />)
  const old = captured.tool!
  await act(async () => {
    await old.execute({ lens: 'prompts' }, { signal: new AbortController().signal })
  })
  await screen.findByRole('textbox', { name: 'Role / Title' })
  await expect(old.execute({ lens: 'investigation' }, { signal: new AbortController().signal })).rejects.toThrow(
    'stale',
  )
  const previousOwner = captured.tool!
  fireEvent.change(screen.getByRole('textbox', { name: 'Role / Title' }), { target: { value: 'Private draft' } })
  view.rerender(<Harness owner="owner-b" />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Role / Title' })).toHaveValue('Original role'))
  await expect(previousOwner.execute({ lens: 'prompts' }, { signal: new AbortController().signal })).rejects.toThrow(
    'stale',
  )
  expect(writes).toEqual([])
})
it('refuses non-admin deep links and tool selection without fetching prompt data', async () => {
  window.history.replaceState({}, '', '/workspace/work?lens=prompts')
  renderWithProviders(<Harness userRole="user" />)
  expect(screen.getByRole('alert')).toHaveTextContent('administrator access')
  expect(screen.queryByRole('link', { name: 'Prompt authoring' })).not.toBeInTheDocument()
  await expect(captured.tool!.execute({ lens: 'prompts' }, { signal: new AbortController().signal })).rejects.toThrow(
    'not permitted',
  )
  expect(fetch).not.toHaveBeenCalled()
})

it('saves edited prompt content only through the existing explicit save control', async () => {
  window.history.replaceState({}, '', '/workspace/work?task=task-a&lens=prompts')
  renderWithProviders(<Harness />)
  const field = await screen.findByRole('textbox', { name: 'Role / Title' })
  fireEvent.change(field, { target: { value: 'Updated instructions' } })
  expect(writes).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Save Config' }))
  await waitFor(() => {
    expect(writes).toHaveLength(1)
  })
  expect(writes[0]).toMatchObject({ identity: { role: 'Updated instructions' } })
  expect(window.location.search).toContain('task=task-a')
})
