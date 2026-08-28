/**
 * @file Inspector.tsx
 * @description Right-hand inspector panel for editing the selected node.
 *
 * Reuses the shared shadcn/ui primitives. Edits the node label and
 * kind-specific config (model, system_prompt, tool tags, required capability)
 * and emits patches up to the editor view.
 */

import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Trash2 } from 'lucide-react'
import type { WorkflowNode, WorkflowNodeConfig } from '@/lib/workflow'

interface InspectorProps {
  node: WorkflowNode | null
  onPatch: (id: string, patch: { label?: string; config?: Partial<WorkflowNodeConfig> }) => void
  onDelete: (id: string) => void
}

type PatchConfig = (config: Partial<WorkflowNodeConfig>) => void

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</label>
}

function EmptyInspector() {
  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-l border-border/40 bg-muted/10">
      <div className="border-b border-border/40 px-3 py-2">
        <h3 className="text-sm font-bold">Inspector</h3>
      </div>
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Select a node to edit its properties.
      </div>
    </div>
  )
}

function InspectorHeader({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
      <h3 className="text-sm font-bold">Inspector</h3>
      <Button
        variant="ghost"
        size="sm"
        aria-label="delete node"
        onClick={onDelete}
        className="h-7 px-2 text-red-400 hover:text-red-300"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

function AgentFields({ config, patchConfig }: { config: WorkflowNodeConfig | undefined; patchConfig: PatchConfig }) {
  return (
    <>
      <div className="space-y-1.5">
        <FieldLabel>Model</FieldLabel>
        <Input
          value={config?.model ?? ''}
          placeholder="anthropic:claude-..."
          onChange={(e) => {
            patchConfig({ model: e.target.value })
          }}
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1.5">
        <FieldLabel>System Prompt</FieldLabel>
        <Textarea
          value={config?.system_prompt ?? ''}
          placeholder="You are a helpful agent…"
          onChange={(e) => {
            patchConfig({ system_prompt: e.target.value })
          }}
          className="min-h-[80px] resize-none text-xs"
        />
      </div>
    </>
  )
}

function ToolTagsField({ config, patchConfig }: { config: WorkflowNodeConfig | undefined; patchConfig: PatchConfig }) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>Tool Tags</FieldLabel>
      <Input
        value={(config?.tools ?? []).join(', ')}
        placeholder="search, http, files"
        onChange={(e) => {
          patchConfig({
            tools: e.target.value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          })
        }}
        className="h-8 text-xs"
      />
    </div>
  )
}

function RequiredCapabilityField({
  config,
  patchConfig,
}: {
  config: WorkflowNodeConfig | undefined
  patchConfig: PatchConfig
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>Required Capability</FieldLabel>
      <Input
        value={config?.requiredCapability ?? ''}
        placeholder="e.g. web-search"
        onChange={(e) => {
          patchConfig({ requiredCapability: e.target.value })
        }}
        className="h-8 text-xs"
      />
    </div>
  )
}

const CAPABILITY_KINDS = new Set(['step', 'team', 'router'])

export default function Inspector({ node, onPatch, onDelete }: InspectorProps) {
  if (!node) return <EmptyInspector />

  const { kind, config } = node.data
  const patchConfig: PatchConfig = (patch) => {
    onPatch(node.id, { config: patch })
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-l border-border/40 bg-muted/10">
      <InspectorHeader
        onDelete={() => {
          onDelete(node.id)
        }}
      />
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <div className="space-y-1.5">
            <FieldLabel>Label</FieldLabel>
            <Input
              value={node.data.label}
              onChange={(e) => {
                onPatch(node.id, { label: e.target.value })
              }}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel>Kind</FieldLabel>
            <div className="text-xs capitalize">{kind}</div>
            {node.data.refId && <div className="truncate text-[10px] text-muted-foreground">{node.data.refId}</div>}
          </div>

          <Separator />

          {kind === 'agent' && <AgentFields config={config} patchConfig={patchConfig} />}

          <ToolTagsField config={config} patchConfig={patchConfig} />

          {CAPABILITY_KINDS.has(kind) && <RequiredCapabilityField config={config} patchConfig={patchConfig} />}
        </div>
      </ScrollArea>
    </div>
  )
}
