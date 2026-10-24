// spec: WEBUI-APPS-R005.4, WEBUI-APPS-R049.1.3
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ApprovalCard } from '../ApprovalCard'
import { Tool, ToolHeader } from '../ai-elements/tool'

it.each(['Approve', 'Reject'])('exposes only the current canonical pending card before %s', async (decision) => {
  const approve = vi.fn()
  const reject = vi.fn()
  render(
    <ApprovalCard
      toolPart={{ toolCallId: 'review-1', toolName: 'synthetic', input: { target: 'fixture' } }}
      onApprove={approve}
      onReject={reject}
    />,
  )
  expect(screen.getByRole('group', { name: 'Required approval' })).toHaveAttribute('data-chat-approval-pending')
  expect(approve).not.toHaveBeenCalled()
  expect(reject).not.toHaveBeenCalled()
  await userEvent.setup().click(screen.getByRole('button', { name: decision }))
  expect(document.querySelector('[data-chat-approval-pending]')).toBeNull()
  expect(decision === 'Approve' ? approve : reject).toHaveBeenCalledExactlyOnceWith('review-1')
  expect(decision === 'Approve' ? reject : approve).not.toHaveBeenCalled()
})

it('marks a native tool approval only while its canonical state requests review', () => {
  const view = render(
    <Tool>
      <ToolHeader type="tool-synthetic" state="approval-requested" />
    </Tool>,
  )
  expect(screen.getByRole('button', { name: /Needs approval/ })).toHaveAttribute('data-chat-approval-pending')
  view.rerender(
    <Tool>
      <ToolHeader type="tool-synthetic" state="approval-responded" />
    </Tool>,
  )
  expect(document.querySelector('[data-chat-approval-pending]')).toBeNull()
  expect(screen.getByRole('button', { name: /Approval sent/ })).toBeInTheDocument()
})
