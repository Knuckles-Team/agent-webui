/**
 * @file HelpOverlay.tsx
 * @description Modal overlay summarizing keyboard shortcuts and feature commands.
 *
 * Rendered from the Chat header via a `?` icon button or the `?` keystroke.
 * Provides parity with the terminal-UI `/help` and `/keybindings` commands.
 */

import { Book, Brain, Calendar, Files, Network, Settings, Sparkles, Zap } from 'lucide-react'
import type { ComponentType, ReactNode, SVGProps } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface HelpOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Shortcut {
  keys: string
  description: string
}

interface FeatureEntry {
  label: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

const SHORTCUTS: Shortcut[] = [
  { keys: '?', description: 'Open this help overlay' },
  { keys: 'Enter', description: 'Send the current message' },
  { keys: 'Shift + Enter', description: 'Insert a newline in the prompt' },
  { keys: 'Ctrl + /', description: 'Focus the chat input' },
  { keys: 'Esc', description: 'Close this overlay' },
  { keys: '/', description: 'Focus the input and start a slash command' },
]

const FEATURES: FeatureEntry[] = [
  { label: 'Graph', description: 'Knowledge graph visualization and search', icon: Network },
  { label: 'Knowledge Base', description: 'Ingest, browse, and search KB articles', icon: Book },
  { label: 'Memory', description: 'Direct CRUD over knowledge-graph memories', icon: Brain },
  { label: 'SDD', description: 'Spec-driven development lifecycle artifacts', icon: Sparkles },
  { label: 'Scheduling', description: 'Cron task calendar and execution logs', icon: Calendar },
  { label: 'Configuration', description: 'Agent and workspace configuration files', icon: Settings },
  { label: 'Files', description: 'Workspace file browser and editor', icon: Files },
  { label: 'Skills', description: 'Universal skills registry and activation', icon: Zap },
]

function ShortcutRow({ shortcut }: { shortcut: Shortcut }): ReactNode {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">{shortcut.keys}</kbd>
      <span className="text-sm text-muted-foreground text-right">{shortcut.description}</span>
    </div>
  )
}

function FeatureRow({ entry }: { entry: FeatureEntry }): ReactNode {
  const Icon = entry.icon
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Icon className="mt-0.5 size-4 text-muted-foreground shrink-0" />
      <div className="flex flex-col">
        <span className="text-sm font-medium">{entry.label}</span>
        <span className="text-xs text-muted-foreground">{entry.description}</span>
      </div>
    </div>
  )
}

/**
 * Renders a modal summarizing keyboard shortcuts and available feature commands.
 */
export function HelpOverlay({ open, onOpenChange }: HelpOverlayProps): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Help</DialogTitle>
          <DialogDescription>Keyboard shortcuts and feature summary. Press Esc to close.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Keyboard shortcuts
            </h3>
            <div className="divide-y divide-border">
              {SHORTCUTS.map((shortcut) => (
                <ShortcutRow key={shortcut.keys} shortcut={shortcut} />
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Features / Commands
            </h3>
            <div className="divide-y divide-border">
              {FEATURES.map((entry) => (
                <FeatureRow key={entry.label} entry={entry} />
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default HelpOverlay
