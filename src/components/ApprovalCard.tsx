/**
 * @file ApprovalCard.tsx
 * @description UI component for human-in-the-loop tool execution approval.
 *
 * Provides a focused card for reviewing pending tool calls that require
 * explicit user permission. Displays the tool name, arguments (as JSON),
 * and provides Approve/Reject actions. Once a decision is made, the card
 * transitions to a compact status summary.
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ShieldAlertIcon, CheckIcon, XIcon } from 'lucide-react'
import { useState, type ComponentProps } from 'react'
import { CodeBlock } from './ai-elements/code-block'
import { getToolIcon } from '@/lib/tool-icons'

/**
 * Props for the ApprovalCard component
 */
export interface ApprovalCardProps extends Omit<ComponentProps<'div'>, 'part'> {
  /**
   * The tool call metadata requiring approval
   */
  toolPart: {
    toolName?: string
    toolCallId: string
    type?: string
    input?: unknown
    state?: string
  }
  /** Callback triggered when the user clicks 'Approve' */
  onApprove: (toolCallId: string) => void
  /** Callback triggered when the user clicks 'Reject' */
  onReject: (toolCallId: string) => void
}

/**
 * ApprovalCard Component
 *
 * Used within the chat feed to intercept security-sensitive tool calls.
 * Prevents the agent from proceeding until the user has reviewed the input.
 */
export function ApprovalCard({ toolPart, onApprove, onReject, className, ...props }: ApprovalCardProps) {
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null)
  const toolId = toolPart.toolName ?? toolPart.type ?? 'tool'
  const toolIcon = getToolIcon(toolId, 'size-5 text-amber-500')

  /**
   * Finalizes the 'Approve' decision and notifies the chat logic
   */
  const handleApprove = () => {
    setDecided('approved')
    onApprove(toolPart.toolCallId)
  }

  /**
   * Finalizes the 'Reject' decision and notifies the chat logic
   */
  const handleReject = () => {
    setDecided('rejected')
    onReject(toolPart.toolCallId)
  }

  // Render the post-decision summary state
  if (decided) {
    return (
      <div
        className={cn(
          'mb-4 w-full rounded-md border p-3',
          decided === 'approved' ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5',
          className,
        )}
        {...props}
      >
        <div className="flex items-center gap-2">
          {decided === 'approved' ? (
            <CheckIcon className="size-4 text-green-500" />
          ) : (
            <XIcon className="size-4 text-red-500" />
          )}
          <span className="font-medium text-sm">
            {toolId} — {decided === 'approved' ? 'Approved' : 'Rejected'}
          </span>
        </div>
      </div>
    )
  }

  // Render the active review state
  return (
    <div
      className={cn('mb-4 w-full rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden', className)}
      {...props}
    >
      {/* Header section with tool identity */}
      <div className="flex items-center justify-between gap-4 p-3 border-b border-amber-500/20">
        <div className="flex items-center gap-2">
          <ShieldAlertIcon className="size-5 text-amber-500" />
          <span className="font-medium text-sm">Approval Required</span>
          <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
            {toolIcon}
            {toolId}
          </Badge>
        </div>
      </div>

      {/* Parameter review section */}
      {!!toolPart.input && (
        <div className="p-3 space-y-1">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Parameters</h4>
          <div className="rounded-md bg-muted/50 max-h-48 overflow-auto">
            <CodeBlock code={JSON.stringify(toolPart.input, null, 2)} language="json" />
          </div>
        </div>
      )}

      {/* Action footer */}
      <div className="flex items-center gap-2 p-3 border-t border-amber-500/20">
        <Button size="sm" onClick={handleApprove} className="gap-1.5">
          <CheckIcon className="size-3.5" />
          Approve
        </Button>
        <Button size="sm" variant="destructive" onClick={handleReject} className="gap-1.5">
          <XIcon className="size-3.5" />
          Reject
        </Button>
      </div>
    </div>
  )
}
