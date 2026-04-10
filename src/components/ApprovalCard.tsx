import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ShieldAlertIcon, CheckIcon, XIcon } from 'lucide-react'
import { useState, type ComponentProps } from 'react'
import { CodeBlock } from './ai-elements/code-block'
import { getToolIcon } from '@/lib/tool-icons'

export interface ApprovalCardProps extends Omit<ComponentProps<'div'>, 'part'> {
  toolPart: {
    toolName?: string
    toolCallId: string
    type?: string
    input?: unknown
    state?: string
  }
  onApprove: (toolCallId: string) => void
  onReject: (toolCallId: string) => void
}

export function ApprovalCard({ toolPart, onApprove, onReject, className, ...props }: ApprovalCardProps) {
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null)
  const toolId = toolPart.toolName ?? toolPart.type ?? 'tool'
  const toolIcon = getToolIcon(toolId, 'size-5 text-amber-500')

  const handleApprove = () => {
    setDecided('approved')
    onApprove(toolPart.toolCallId)
  }

  const handleReject = () => {
    setDecided('rejected')
    onReject(toolPart.toolCallId)
  }

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

  return (
    <div
      className={cn('mb-4 w-full rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden', className)}
      {...props}
    >
      {}
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

      {}
      {!!toolPart.input && (
        <div className="p-3 space-y-1">
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Parameters</h4>
          <div className="rounded-md bg-muted/50 max-h-48 overflow-auto">
            <CodeBlock code={JSON.stringify(toolPart.input, null, 2)} language="json" />
          </div>
        </div>
      )}

      {}
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
