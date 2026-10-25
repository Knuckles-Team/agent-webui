// spec: WEBUI-APPS-R049.1.3
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { ApiError } from '@/lib/api-validation'
import { workApi } from '@/lib/work-workspace'
import { WorkTaskControls } from '../WorkTaskControls'
import { createTaskCancellation } from '../task-cancellation'
const state = vi.hoisted(() => ({
  tools: [] as WebMcpToolDefinition[],
  confirm: (() => undefined) as () => void,
  close: (() => undefined) as () => void,
}))
vi.mock('@/components/ui/dialog', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/ui/dialog')>()
  return {
    ...original,
    DialogContent: (props: ComponentProps<typeof original.DialogContent>) => {
      function capture(children: ReactNode) {
        Children.forEach(children, (child) => {
          if (!isValidElement<{ children?: ReactNode; onClick?: (event: unknown) => void }>(child)) return
          if (child.type === 'button' && child.props.children === 'Confirm task cancellation')
            state.confirm = () => child.props.onClick?.({})
          if (child.type === 'button' && child.props.children === 'Keep task running')
            state.close = () => child.props.onClick?.({})
          capture(child.props.children)
        })
      }
      capture(props.children)
      return <original.DialogContent {...props} />
    },
  }
})
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    state.tools = tools
  },
}))
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<{ status: 'cancelled'; task: unknown }>((yes, no) => {
    resolve = () => {
      yes({ status: 'cancelled', task: {} })
    }
    reject = no
  })
  return { promise, resolve, reject }
}
function setup(trusted = true) {
  const cancellation = createTaskCancellation()
  cancellation.activate()
  const props = {
    taskId: 'task-a',
    taskState: 'working',
    context: 'work-a',
    refreshing: false,
    onRefresh: vi.fn(),
    cancellation,
    ...(trusted ? { isAttendedGesture: () => true } : {}),
  }
  return { ...renderWithProviders(<WorkTaskControls {...props} />), props, cancellation }
}
async function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Cancel task…' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm task cancellation' }))
  })
}
beforeEach(() => {
  state.tools = []
  vi.spyOn(workApi, 'cancelTask').mockResolvedValue({ status: 'cancelled', task: {} })
})
afterEach(() => vi.restoreAllMocks())
describe('Work task lifecycle', () => {
  it('semantic review is local, and script-dispatched confirmation cannot cancel a task', async () => {
    setup(false)
    await act(async () => {
      await state.tools[0].execute({}, { signal: new AbortController().signal })
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('task-a')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm task cancellation' }))
    expect(screen.getByRole('alert')).toHaveTextContent('browser interaction')
    expect(workApi.cancelTask).not.toHaveBeenCalled()
  })
  it('shares manual review with one confirmed request and reports acceptance without inventing final state', async () => {
    const { props } = setup()
    await confirm()
    expect(workApi.cancelTask).toHaveBeenCalledExactlyOnceWith('task-a')
    expect(screen.getByRole('status')).toHaveTextContent('Cancellation requested for task task-a')
    expect(props.onRefresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh task' }))
    expect(props.onRefresh).toHaveBeenCalledOnce()
  })
  it('holds the synchronous lock across selection away and back while ignoring late completion in another context', async () => {
    const pending = deferred()
    vi.mocked(workApi.cancelTask).mockReturnValue(pending.promise)
    const { rerender, props } = setup()
    await confirm()
    rerender(<WorkTaskControls {...props} taskId="task-b" />)
    expect(screen.queryByText(/Cancellation requested/)).not.toBeInTheDocument()
    rerender(<WorkTaskControls {...props} />)
    expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeDisabled()
    expect(workApi.cancelTask).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeEnabled()
    expect(screen.queryByText(/Cancellation requested/)).not.toBeInTheDocument()
  })
  it('refuses simultaneous controller submissions and retired admission callbacks', async () => {
    const pending = deferred()
    vi.mocked(workApi.cancelTask).mockReturnValue(pending.promise)
    const { cancellation } = setup()
    let first!: Promise<boolean>
    await act(async () => {
      first = cancellation.cancel('task-a')
      expect(await cancellation.cancel('task-a')).toBe(false)
    })
    expect(workApi.cancelTask).toHaveBeenCalledTimes(1)
    cancellation.retire()
    await expect(cancellation.cancel('task-b')).rejects.toThrow('admission is stale')
    await act(async () => {
      pending.resolve()
      await first
    })
  })
  it('retires held tools and an open review when the task or context changes', async () => {
    const { props, rerender } = setup()
    const held = state.tools[0]
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task…' }))
    rerender(<WorkTaskControls {...props} context="work-b" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(held.execute({}, { signal: new AbortController().signal })).rejects.toThrow('stale')
    expect(workApi.cancelTask).not.toHaveBeenCalled()
  })
  it('retires held review and confirmation across refresh without replacing its refresh control', async () => {
    const cancellation = createTaskCancellation()
    cancellation.activate()
    const props = {
      taskId: 'task-a',
      taskState: 'working',
      context: 'work-a',
      refreshing: false,
      onRefresh: vi.fn(),
      cancellation,
      isAttendedGesture: () => true,
    }
    const { rerender } = render(<WorkTaskControls {...props} />)
    const held = state.tools[0]
    const refresh = screen.getByRole('button', { name: 'Refresh task' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task…' }))
    const oldConfirm = state.confirm
    rerender(<WorkTaskControls {...props} refreshing />)
    expect(screen.getByRole('button', { name: 'Refresh task' })).toBe(refresh)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(state.tools).toEqual([])
    expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeDisabled()
    await expect(held.execute({}, { signal: new AbortController().signal })).rejects.toThrow('stale')
    rerender(<WorkTaskControls {...props} />)
    expect(screen.getByRole('button', { name: 'Refresh task' })).toBe(refresh)
    await expect(held.execute({}, { signal: new AbortController().signal })).rejects.toThrow('stale')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task…' }))
    await act(async () => {
      oldConfirm()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(workApi.cancelTask).not.toHaveBeenCalled()
    await act(async () => {
      state.confirm()
    })
    expect(workApi.cancelTask).toHaveBeenCalledExactlyOnceWith('task-a')
  })
  it('does not offer cancellation for terminal or unknown states', () => {
    const { props, rerender } = setup()
    for (const taskState of ['completed', 'failed', 'cancelled', 'unrecognized']) {
      rerender(<WorkTaskControls {...props} taskState={taskState} />)
      expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeDisabled()
      expect(state.tools).toEqual([])
    }
    expect(workApi.cancelTask).not.toHaveBeenCalled()
  })
  it('reports an unknown outcome after a lost response and releases the request lock for explicit retry', async () => {
    vi.mocked(workApi.cancelTask).mockRejectedValueOnce(new Error('denied'))
    setup()
    await confirm()
    expect(screen.getByRole('alert')).toHaveTextContent('Cancellation outcome is unknown')
    expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeEnabled()
    expect(screen.queryByText(/Cancellation requested/)).not.toBeInTheDocument()
  })
})

it('refuses callbacks retained from a dismissed review without consuming its replacement', async () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel task…' }))
  const oldConfirm = state.confirm
  const oldClose = state.close
  fireEvent.click(screen.getByRole('button', { name: 'Keep task running' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel task…' }))
  await act(async () => {
    oldClose()
    oldConfirm()
  })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(workApi.cancelTask).not.toHaveBeenCalled()
  await act(async () => {
    state.confirm()
  })
  expect(workApi.cancelTask).toHaveBeenCalledTimes(1)
})
it('sends only one request when a confirmation callback is invoked twice before React commits', async () => {
  const pending = deferred()
  vi.mocked(workApi.cancelTask).mockReturnValue(pending.promise)
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel task…' }))
  const held = state.confirm
  await act(async () => {
    held()
    held()
  })
  expect(workApi.cancelTask).toHaveBeenCalledTimes(1)
  await act(async () => {
    pending.resolve()
    await pending.promise
  })
})

it('reports an explicit authorization refusal without claiming cancellation or exposing the response body', async () => {
  vi.mocked(workApi.cancelTask).mockRejectedValueOnce(new ApiError(403, 'private service detail'))
  setup()
  await confirm()
  expect(screen.getByRole('alert')).toHaveTextContent('Task cancellation was refused')
  expect(screen.queryByText(/private service detail/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Cancellation requested/)).not.toBeInTheDocument()
})
