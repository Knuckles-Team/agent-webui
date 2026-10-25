// spec: WEBUI-APPS-R049.1.15
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/api-validation'
import { parseWorkState, navigateWork, workHref } from '@/lib/work-workspace'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import type { Role } from '@/lib/nav-registry'
import type { SavedWorkflow, WorkflowNode } from '@/lib/workflow'
import type { OnSelectionChangeParams } from '@xyflow/react'
import { WorkWorkflowLens } from '../WorkWorkflowLens'

vi.mock('@xyflow/react', async (original) => {
  const { useEffect } = await import('react')
  return {
    ...(await original<object>()),
    ReactFlow: function SelectionFlow({
      children,
      nodes,
      onSelectionChange,
    }: {
      children?: React.ReactNode
      nodes: WorkflowNode[]
      onSelectionChange: (selection: OnSelectionChangeParams<WorkflowNode>) => void
    }) {
      // ReactFlow notifies when callback identity changes, not only after clicks.
      useEffect(() => {
        onSelectionChange({ nodes: [], edges: [] })
      }, [onSelectionChange])
      return (
        <div>
          {children}
          <button
            onClick={() => {
              onSelectionChange({ nodes: nodes.slice(0, 1), edges: [] })
            }}
          >
            Select first canvas node
          </button>
          <button
            onClick={() => {
              onSelectionChange({ nodes: [], edges: [] })
            }}
          >
            Clear canvas selection
          </button>
        </div>
      )
    },
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Background: () => null,
    Controls: () => null,
    useReactFlow: () => ({ screenToFlowPosition: (position: unknown) => position }),
  }
})
vi.mock('@/lib/api', () => ({
  api: {
    listWorkflowCapabilities: vi.fn(),
    listWorkflows: vi.fn(),
    saveWorkflow: vi.fn(),
    runWorkflow: vi.fn(),
  },
}))
const capabilities = {
  agents: [{ id: 'planner', name: 'Planner', kind: 'agent' as const, tools: ['files'] }],
  tools: [],
  skills: [],
}
const workflows: SavedWorkflow[] = [
  { id: 'workflow:demo', name: 'Demo', steps: ['Check'], orchestrates: ['agent:planner'] },
]
function Harness({ userRole = 'admin', owner = 'owner-a' }: { userRole?: Role; owner?: string }) {
  const state = parseWorkState(useWorkspaceLocation())
  return <WorkWorkflowLens key={`${owner}:${userRole}`} role={userRole} state={state} />
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listWorkflowCapabilities).mockResolvedValue(capabilities)
  vi.mocked(api.listWorkflows).mockResolvedValue(workflows)
  window.history.replaceState({}, '', '/workspace/work?conversation=c&task=t&run=r&node=n')
})
describe('Contextual Work workflows', () => {
  it('round trips workflow identity without losing investigation context or serializing a draft', () => {
    const state = parseWorkState(
      '/workspace/work?conversation=c&task=t&run=r&node=n&lens=workflows&workflow=workflow%3Ademo',
    )
    expect(parseWorkState(workHref(state))).toEqual(state)
    expect(() => parseWorkState('/workspace/work?workflow=a&workflow=b')).toThrow()
    expect(() => parseWorkState('/workspace/work?lens=workflows&draft=private')).toThrow()
    expect(() => navigateWork(state, 'user')).toThrow('not permitted')
  })
  it('retains workflow identity, unsaved draft, warnings and loaded capabilities through inspection and return', async () => {
    render(<Harness />)
    expect(api.listWorkflows).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Workflow plans' }))
    await screen.findByRole('option', { name: 'Demo' })
    fireEvent.change(screen.getByLabelText('Saved workflow'), { target: { value: 'workflow:demo' } })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'workflow name' })).toHaveValue('Demo'))
    fireEvent.change(screen.getByRole('textbox', { name: 'workflow name' }), {
      target: { value: 'Private local plan' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add Step' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Node label' }), { target: { value: 'Search now' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Required capability' }), { target: { value: 'web-search' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Planner' }))
    const inspect = screen.getByLabelText('Inspect node')
    const options = within(inspect).getAllByRole('option')
    const step = options.find((option) => option.textContent?.includes('Search now')) as HTMLOptionElement
    const planner = options.at(-1) as HTMLOptionElement
    fireEvent.change(inspect, { target: { value: step.value } })
    fireEvent.change(screen.getByLabelText('Connect selected node to'), { target: { value: planner.value } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect nodes' }))
    expect(screen.getByText(/lacks required capability/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Inspect tasks and traces' }))
    expect(screen.queryByRole('textbox', { name: 'workflow name' })).not.toBeInTheDocument()
    await act(async () => {
      navigateWork({ ...parseWorkState(window.location.href), task: 'other-task' }, 'admin')
    })
    fireEvent.click(screen.getByRole('link', { name: 'Workflow plans' }))
    expect(screen.getByRole('textbox', { name: 'workflow name' })).toHaveValue('Private local plan')
    expect(screen.getByRole('textbox', { name: 'Node label' })).toHaveValue('Search now')
    expect(screen.getByText(/lacks required capability/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Planner' })).toBeInTheDocument()
    expect(parseWorkState(window.location.href)).toMatchObject({
      conversation: 'c',
      task: 'other-task',
      run: 'r',
      node: 'n',
      workflow: 'workflow:demo',
    })
    expect(window.location.search).not.toContain('Private')
    expect(api.listWorkflows).toHaveBeenCalledTimes(1)
    expect(api.listWorkflowCapabilities).toHaveBeenCalledTimes(1)
    expect(api.saveWorkflow).not.toHaveBeenCalled()
    expect(api.runWorkflow).not.toHaveBeenCalled()
  })
  it('supports keyboard-only add, select, edit and delete without a drag gesture', async () => {
    window.history.replaceState({}, '', '/workspace/work?lens=workflows')
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByRole('button', { name: 'Add Planner' })
    screen.getByRole('button', { name: 'Add Step' }).focus()
    await user.keyboard('{Enter}')
    const field = screen.getByRole('textbox', { name: 'Node label' })
    await user.clear(field)
    await user.type(field, 'Keyboard step')
    await user.selectOptions(screen.getByLabelText('Inspect node'), '')
    expect(screen.queryByRole('textbox', { name: 'Node label' })).not.toBeInTheDocument()
    const option = within(screen.getByLabelText('Inspect node')).getByRole('option', {
      name: '1. Keyboard step',
    }) as HTMLOptionElement
    await user.selectOptions(screen.getByLabelText('Inspect node'), option.value)
    expect(screen.getByRole('textbox', { name: 'Node label' })).toHaveValue('Keyboard step')
    screen.getByRole('button', { name: 'delete node' }).focus()
    await user.keyboard(' ')
    expect(screen.queryByRole('option', { name: '1. Keyboard step' })).not.toBeInTheDocument()
  })
  it('still follows real canvas selection and deselection after local inspector edits', async () => {
    window.history.replaceState({}, '', '/workspace/work?lens=workflows')
    render(<Harness />)
    await screen.findByRole('button', { name: 'Add Planner' })
    fireEvent.click(screen.getByRole('button', { name: 'Add Step' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Node label' }), { target: { value: 'First step' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Team' }))
    expect(screen.getByRole('textbox', { name: 'Node label' })).toHaveValue('Team')
    fireEvent.click(screen.getByRole('button', { name: 'Select first canvas node' }))
    expect(screen.getByRole('textbox', { name: 'Node label' })).toHaveValue('First step')
    fireEvent.click(screen.getByRole('button', { name: 'Clear canvas selection' }))
    expect(screen.queryByRole('textbox', { name: 'Node label' })).not.toBeInTheDocument()
  })
  it('does not fetch workflow data for a non-admin deep link', () => {
    window.history.replaceState({}, '', '/workspace/work?lens=workflows&workflow=private')
    render(<Harness userRole="user" />)
    expect(screen.getByRole('alert')).toHaveTextContent('administrator access')
    expect(api.listWorkflows).not.toHaveBeenCalled()
    expect(api.listWorkflowCapabilities).not.toHaveBeenCalled()
  })
  it('retires the owner draft and ignores its late catalog results', async () => {
    const old = deferred<SavedWorkflow[]>()
    vi.mocked(api.listWorkflows).mockReturnValueOnce(old.promise)
    window.history.replaceState({}, '', '/workspace/work?lens=workflows')
    const view = render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: 'workflow name' }), {
      target: { value: 'Old private draft' },
    })
    view.rerender(<Harness owner="owner-b" />)
    await screen.findByRole('option', { name: 'Demo' })
    await act(async () => {
      old.resolve([{ ...workflows[0], id: 'private-old', name: 'Old owner record' }])
    })
    expect(screen.queryByRole('option', { name: 'Old owner record' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'workflow name' })).toHaveValue('Untitled Workflow')
  })
  it('ignores older refresh responses and never calls disabled Save or Run', async () => {
    const old = deferred<SavedWorkflow[]>()
    vi.mocked(api.listWorkflows).mockReturnValueOnce(old.promise)
    window.history.replaceState({}, '', '/workspace/work?lens=workflows')
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workflow catalog' }))
    await screen.findByRole('option', { name: 'Demo' })
    await act(async () => {
      old.resolve([{ ...workflows[0], id: 'obsolete', name: 'Obsolete record' }])
    })
    expect(screen.queryByRole('option', { name: 'Obsolete record' })).not.toBeInTheDocument()
    for (const name of ['Save', 'Run']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(screen.getByText(/Edits are in-memory previews/)).toBeInTheDocument()
    expect(api.saveWorkflow).not.toHaveBeenCalled()
    expect(api.runWorkflow).not.toHaveBeenCalled()
  })
  it.each([403, 501, 503])(
    'renders refused or unavailable reads (%s) instead of a successful empty catalog',
    async (status) => {
      vi.mocked(api.listWorkflows).mockRejectedValueOnce(new ApiError(status, 'read failed'))
      vi.mocked(api.listWorkflowCapabilities).mockRejectedValueOnce(new ApiError(status, 'read failed'))
      window.history.replaceState({}, '', '/workspace/work?lens=workflows')
      render(<Harness />)
      await waitFor(() => {
        expect(screen.getAllByRole('alert')).toHaveLength(2)
      })
      expect(screen.queryByText('No saved workflows were returned.')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add Planner' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    },
  )
  it('does not substitute another workflow or mount a malformed saved canvas', async () => {
    vi.mocked(api.listWorkflows).mockResolvedValueOnce([{ ...workflows[0], canvas: { nodes: null } as never }])
    window.history.replaceState({}, '', '/workspace/work?lens=workflows&workflow=workflow%3Ademo')
    render(<Harness />)
    await screen.findByText('This workflow has an invalid canvas. It was not loaded.')
    expect(screen.queryByRole('textbox', { name: 'workflow name' })).not.toBeInTheDocument()
    expect(api.saveWorkflow).not.toHaveBeenCalled()
  })
})

it('keeps the existing 512-byte workflow identity bound without truncation', () => {
  const workflow = 'w'.repeat(512)
  const state = parseWorkState(`/workspace/work?lens=workflows&workflow=${workflow}`)
  expect(parseWorkState(workHref(state)).workflow).toBe(workflow)
  expect(() => parseWorkState(`/workspace/work?workflow=${'w'.repeat(513)}`)).toThrow()
  expect(() => parseWorkState(`/workspace/work?workflow=${encodeURIComponent('é'.repeat(257))}`)).toThrow()
})
it('rejects malformed loaded workflow identities without retargeting the investigation', async () => {
  vi.mocked(api.listWorkflows).mockResolvedValueOnce([{ ...workflows[0], id: 'bad\u0001id' }])
  window.history.replaceState({}, '', '/workspace/work?task=t&conversation=c&lens=workflows')
  render(<Harness />)
  await screen.findByRole('option', { name: 'Demo' })
  fireEvent.change(screen.getByLabelText('Saved workflow'), { target: { value: 'bad\u0001id' } })
  expect(screen.getByRole('alert')).toHaveTextContent('workflow identity is invalid')
  expect(parseWorkState(window.location.href)).toMatchObject({ task: 't', conversation: 'c' })
  expect(parseWorkState(window.location.href).workflow).toBeUndefined()
  expect(screen.getByRole('textbox', { name: 'workflow name' })).toHaveValue('Untitled Workflow')
})
