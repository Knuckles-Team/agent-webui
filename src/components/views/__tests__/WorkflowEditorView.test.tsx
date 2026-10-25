// spec: WEBUI-APPS-R049.1.15
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import WorkflowEditorView from '@/components/views/WorkflowEditorView'
import { api } from '@/lib/api'
import { toWorkflowSpec, fromWorkflowSpec } from '@/lib/workflow'
import { workflowCanvas } from '@/components/workflow/workflow-editor-state'
const identity = vi.hoisted(() => ({ role: 'admin', owner: 'owner-a', expiry: 1 }))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    loading: false,
    identity: {
      userKey: identity.owner,
      role: identity.role,
      needsSignIn: false,
      raw: { roles: [], expires_at: identity.expiry },
    },
  }),
}))
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<object>()),
  ReactFlow: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  useReactFlow: () => ({ screenToFlowPosition: (position: unknown) => position }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    listWorkflowCapabilities: vi.fn(),
    listWorkflows: vi.fn(),
    saveWorkflow: vi.fn(),
    runWorkflow: vi.fn(),
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
  identity.role = 'admin'
  identity.owner = 'owner-a'
  identity.expiry = 1
  vi.mocked(api.listWorkflowCapabilities).mockResolvedValue({ agents: [], tools: [], skills: [] })
  vi.mocked(api.listWorkflows).mockResolvedValue([])
})
describe('WorkflowEditorView compatibility wrapper', () => {
  it('mounts the contextual editor without nested old page chrome', async () => {
    render(<WorkflowEditorView />)
    await screen.findByText('No saved workflows were returned.')
    expect(screen.getByRole('region', { name: 'Workflow plan editor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Step' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })
  it('round-trips the demo workflow with the existing serializer', () => {
    const canvas = fromWorkflowSpec({ name: 'Demo', steps: ['a'], orchestrates: ['agent:planner'] })
    expect(toWorkflowSpec(canvas.nodes, canvas.edges, 'Demo')).toEqual({
      name: 'Demo',
      steps: ['a'],
      orchestrates: ['agent:planner'],
    })
  })
  it('preserves the explicit read error instead of rendering an empty catalog', async () => {
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    vi.mocked(api.listWorkflows).mockRejectedValueOnce(new Error('Knowledge Graph workflow query failed'))
    render(<WorkflowEditorView />)
    await screen.findByRole('alert')
    expect(toastErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load saved workflows'))
    expect(screen.queryByText('No saved workflows were returned.')).not.toBeInTheDocument()
    toastErrorSpy.mockRestore()
  })
  it('withdraws a draft on admission renewal and refuses lower roles', async () => {
    const view = render(<WorkflowEditorView />)
    await screen.findByText('No saved workflows were returned.')
    fireEvent.change(screen.getByRole('textbox', { name: 'workflow name' }), { target: { value: 'Private draft' } })
    identity.expiry = 2
    view.rerender(<WorkflowEditorView />)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'workflow name' })).toHaveValue('Untitled Workflow'),
    )
    const reads = vi.mocked(api.listWorkflows).mock.calls.length
    identity.role = 'user'
    view.rerender(<WorkflowEditorView />)
    expect(screen.getByRole('alert')).toHaveTextContent('administrator access')
    expect(api.listWorkflows).toHaveBeenCalledTimes(reads)
  })
})

describe('Saved workflow canvas boundary', () => {
  const node = {
    id: 'step-a',
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind: 'step' as const, label: '<img onerror=alert(1)>', status: 'done' as const },
  }
  const saved = { id: 'workflow:a', name: 'A', steps: ['A'], orchestrates: [] }
  it('retains plain-text labels but does not restore an old execution success', () => {
    const canvas = workflowCanvas({ ...saved, canvas: { nodes: [node], edges: [] } })
    expect(canvas.nodes[0].data.label).toBe(node.data.label)
    expect(canvas.nodes[0].data.status).toBeUndefined()
  })
  it('refuses duplicate node identities', () => {
    expect(() => workflowCanvas({ ...saved, canvas: { nodes: [node, node], edges: [] } })).toThrow('duplicate')
  })
  it('refuses an edge that references an unreturned node', () => {
    expect(() =>
      workflowCanvas({
        ...saved,
        canvas: { nodes: [node], edges: [{ id: 'edge-a', source: 'step-a', target: 'absent' }] },
      }),
    ).toThrow('outside')
  })
})
