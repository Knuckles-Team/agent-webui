/**
 * @file nodes.tsx
 * @description Custom React Flow node components for the workflow editor.
 *
 * Each kind (Agent, Tool, Skill, Step, Team, Router) renders with distinct
 * Tailwind styling, a title + subtitle, and typed source/target handles.
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Bot, Wrench, Sparkles, ListOrdered, Users, GitBranch } from 'lucide-react'
import type { WorkflowNodeData, WorkflowNodeKind, WorkflowNodeStatus } from '@/lib/workflow'
import { cn } from '@/lib/utils'

interface KindStyle {
  icon: typeof Bot
  ring: string
  accent: string
  subtitle: string
}

/** Visual treatment + default subtitle per node kind. */
const KIND_STYLES: Record<WorkflowNodeKind, KindStyle> = {
  agent: { icon: Bot, ring: 'border-emerald-500/60', accent: 'text-emerald-400', subtitle: 'Agent' },
  tool: { icon: Wrench, ring: 'border-sky-500/60', accent: 'text-sky-400', subtitle: 'Tool' },
  skill: { icon: Sparkles, ring: 'border-violet-500/60', accent: 'text-violet-400', subtitle: 'Skill' },
  step: { icon: ListOrdered, ring: 'border-amber-500/60', accent: 'text-amber-400', subtitle: 'Step' },
  team: { icon: Users, ring: 'border-rose-500/60', accent: 'text-rose-400', subtitle: 'Team' },
  router: { icon: GitBranch, ring: 'border-cyan-500/60', accent: 'text-cyan-400', subtitle: 'Router' },
}

/** Maps a live status to a ring/animation class. */
function statusClass(status?: WorkflowNodeStatus): string {
  switch (status) {
    case 'running':
      return 'ring-2 ring-yellow-400/80 animate-pulse'
    case 'done':
      return 'ring-2 ring-emerald-400/80'
    case 'error':
      return 'ring-2 ring-red-500/80'
    default:
      return ''
  }
}

/**
 * Shared node shell. Kind-specific components delegate here.
 */
function WorkflowNodeShell({ data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const style = KIND_STYLES[data.kind]
  const Icon = style.icon

  return (
    <div
      data-testid={`wf-node-${data.kind}`}
      className={cn(
        'min-w-[160px] max-w-[220px] rounded-lg border bg-card/90 backdrop-blur px-3 py-2 shadow-md transition-all',
        style.ring,
        selected && 'ring-2 ring-primary',
        statusClass(data.status),
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', style.accent)} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{data.label}</div>
          <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            {data.refId ?? style.subtitle}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-muted-foreground" />
    </div>
  )
}

const AgentNode = (props: NodeProps) => <WorkflowNodeShell {...props} data={props.data as WorkflowNodeData} />
const ToolNode = (props: NodeProps) => <WorkflowNodeShell {...props} data={props.data as WorkflowNodeData} />
const SkillNode = (props: NodeProps) => <WorkflowNodeShell {...props} data={props.data as WorkflowNodeData} />
const StepNode = (props: NodeProps) => <WorkflowNodeShell {...props} data={props.data as WorkflowNodeData} />
const TeamNode = (props: NodeProps) => <WorkflowNodeShell {...props} data={props.data as WorkflowNodeData} />
const RouterNode = (props: NodeProps) => <WorkflowNodeShell {...props} data={props.data as WorkflowNodeData} />

/**
 * Map of `type` → component, passed to React Flow as `nodeTypes`.
 */
export const workflowNodeTypes = {
  agent: memo(AgentNode),
  tool: memo(ToolNode),
  skill: memo(SkillNode),
  step: memo(StepNode),
  team: memo(TeamNode),
  router: memo(RouterNode),
}

export { KIND_STYLES }
