// spec: OVERSTORY-APPS-R049.1.3
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import {
  readConversationMessages,
  readLocalConversationEntry,
  saveConversationEntry,
  useConversations,
  writeConversationMessages,
} from '@/lib/chat-store'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { WorkConversationControls } from '../WorkConversationControls'
const captured = vi.hoisted(() => ({ tool: null as WebMcpToolDefinition | null }))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    captured.tool = tools[0]
  },
}))
const onNew = vi.fn()
function Harness({ owner = 'owner-a', conversation = '/saved', attended = true }) {
  useConversations(owner)
  return (
    <WorkConversationControls
      owner={owner}
      conversation={conversation}
      onNew={onNew}
      isAttendedGesture={attended ? () => true : undefined}
    />
  )
}
beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  onNew.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([{ id: '/remote', firstMessage: 'Remote' }]))),
  )
  saveConversationEntry('owner-a', '/saved', 'Original')
  writeConversationMessages('owner-a', '/saved', [{ id: 'message-a', role: 'user' }])
  saveConversationEntry('owner-b', '/saved', 'Other owner')
})
it('renames the selected local label through visible review and shared store', async () => {
  renderWithProviders(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Rename local copy…' }))
  fireEvent.change(screen.getByLabelText('Local conversation label'), { target: { value: 'Investigation' } })
  expect(readLocalConversationEntry('owner-a', '/saved')?.firstMessage).toBe('Original')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm conversation change' }))
  expect(await screen.findByText('Local label: Investigation')).toBeInTheDocument()
  expect(readLocalConversationEntry('owner-b', '/saved')?.firstMessage).toBe('Other owner')
  expect(onNew).not.toHaveBeenCalled()
})
it('removes only this owner’s local copy and starts fresh without a server mutation', async () => {
  renderWithProviders(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove local copy…' }))
  expect(screen.getByText(/Server history is not deleted/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm conversation change' }))
  expect(readConversationMessages('owner-a', '/saved')).toBeNull()
  expect(readLocalConversationEntry('owner-a', '/saved')).toBeNull()
  expect(readLocalConversationEntry('owner-b', '/saved')).not.toBeNull()
  expect(onNew).toHaveBeenCalledOnce()
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})
it('semantic requests open review but cannot confirm with a synthetic event', async () => {
  renderWithProviders(<Harness attended={false} />)
  await act(async () => captured.tool!.execute({ action: 'new' }, { signal: new AbortController().signal }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(onNew).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm conversation change' }))
  expect(screen.getByRole('alert')).toHaveTextContent('browser interaction')
  expect(onNew).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('refuses remote-only rename and removal without creating a local record', async () => {
  renderWithProviders(<Harness conversation="/remote" />)
  expect(screen.getByRole('button', { name: 'Rename local copy…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Remove local copy…' })).toBeDisabled()
  await expect(
    captured.tool!.execute({ action: 'rename', label: 'Fake' }, { signal: new AbortController().signal }),
  ).rejects.toThrow('No local index')
  expect(readLocalConversationEntry('owner-a', '/remote')).toBeNull()
})
it('retires review and old tool handles when the owner changes', async () => {
  const view = renderWithProviders(<Harness />)
  const old = captured.tool!
  fireEvent.click(screen.getByRole('button', { name: 'Remove local copy…' }))
  view.rerender(<Harness owner="owner-b" />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await expect(old.execute({ action: 'remove' }, { signal: new AbortController().signal })).rejects.toThrow('stale')
  expect(readLocalConversationEntry('owner-a', '/saved')).not.toBeNull()
})
it('retires review when a different conversation is selected', () => {
  const view = renderWithProviders(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove local copy…' }))
  view.rerender(<Harness conversation="/remote" />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(readLocalConversationEntry('owner-a', '/saved')).not.toBeNull()
})
it('refuses a changed message snapshot rather than remove newer cached content', () => {
  renderWithProviders(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove local copy…' }))
  writeConversationMessages('owner-a', '/saved', [{ id: 'newer' }])
  fireEvent.click(screen.getByRole('button', { name: 'Confirm conversation change' }))
  expect(screen.getByRole('alert')).toHaveTextContent('local copy changed')
  expect(readConversationMessages('owner-a', '/saved')).toEqual([{ id: 'newer' }])
  expect(onNew).not.toHaveBeenCalled()
})
it('reports failed local storage readback instead of claiming rename success', () => {
  renderWithProviders(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Rename local copy…' }))
  fireEvent.change(screen.getByLabelText('Local conversation label'), { target: { value: 'Unsaved' } })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm conversation change' }))
  expect(screen.getByRole('alert')).toHaveTextContent('could not be saved')
  expect(readLocalConversationEntry('owner-a', '/saved')?.firstMessage).toBe('Original')
})

it('does not register controls for an invalid Work destination', () => {
  captured.tool = null
  renderWithProviders(<WorkConversationControls enabled={false} owner="owner-a" conversation="/saved" onNew={onNew} />)
  expect(screen.queryByRole('region', { name: 'Conversation lifecycle' })).not.toBeInTheDocument()
  expect(captured.tool).toBeNull()
})

it('allows local rename while cached messages update and reveals a newly cached remote copy', async () => {
  const view = renderWithProviders(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Rename local copy…' }))
  fireEvent.change(screen.getByLabelText('Local conversation label'), { target: { value: 'Stable label' } })
  act(() => {
    writeConversationMessages('owner-a', '/saved', [{ id: 'streamed' }])
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm conversation change' }))
  expect(await screen.findByText('Local label: Stable label')).toBeInTheDocument()
  view.rerender(<Harness conversation="/remote" />)
  expect(screen.getByRole('button', { name: 'Remove local copy…' })).toBeDisabled()
  act(() => {
    writeConversationMessages('owner-a', '/remote', [{ id: 'downloaded' }])
  })
  expect(screen.getByRole('button', { name: 'Remove local copy…' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Rename local copy…' })).toBeDisabled()
})

it('keeps a failed new-conversation transition visible in review', () => {
  onNew.mockImplementationOnce(() => {
    throw new Error('Browser storage is unavailable')
  })
  renderWithProviders(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'New conversation…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm conversation change' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is unavailable')
  expect(readLocalConversationEntry('owner-a', '/saved')).not.toBeNull()
})
