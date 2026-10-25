import { Search } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { roleAtLeast, type Role } from '@/lib/nav-registry'
import {
  EXPLORE_LENSES,
  canUseExploreLens,
  navigateExploreLens,
  parseExploreLensState,
  exploreLensHref,
} from '@/lib/explore-lens-state'
import { navigateWork, parseWorkState, workHref } from '@/lib/work-workspace'
import { navigateOperate, parseOperateState, operateHref } from '@/lib/operate-workspace'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import { WorkspaceCommandDestinations } from './WorkspaceCommandDestinations'
import { useWorkspaceViewportBoundary } from './useWorkspaceViewportBoundary'
import { useWorkspacePaletteFocus } from './useWorkspacePaletteFocus'

export interface WorkspaceCommand {
  id: string
  label: string
  href: string
}
interface Registration {
  owner: string
  location: string
  entries: readonly WorkspaceCommand[]
}
interface CommandContext {
  owner: string
  role: Role
  entries: readonly WorkspaceCommand[]
  register: (source: symbol, value: Registration | null) => void
}
const Context = createContext<CommandContext | null>(null)
function canonical(href: string, role: Role): string {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('#'))
    throw new Error('Invalid workspace command')
  const path = new URL(href, 'https://workspace.invalid').pathname
  if (path === '/workspace/work') {
    const state = parseWorkState(href)
    if (roleAtLeast(role, state.lens === 'prompts' || state.lens === 'workflows' ? 'admin' : 'user'))
      return workHref(state)
  }
  if (path === '/workspace/explore') {
    const state = parseExploreLensState(href)
    if (canUseExploreLens(role, state.lens)) return exploreLensHref(state)
  }
  if (path === '/workspace/operate') {
    const state = parseOperateState(href)
    if (roleAtLeast(role, state.lens === 'usage' ? 'user' : 'reader')) return operateHref(state)
  }
  throw new Error('Workspace command unavailable')
}
function navigate(href: string, role: Role) {
  const path = new URL(canonical(href, role), 'https://workspace.invalid').pathname
  if (path === '/workspace/work') navigateWork(parseWorkState(href), role)
  else if (path === '/workspace/explore') navigateExploreLens(parseExploreLensState(href), role, EXPLORE_LENSES)
  else navigateOperate(parseOperateState(href), role)
}
function currentCommand(href: string, role: Role, entries: readonly WorkspaceCommand[]) {
  const current = canonical(href, role)
  if (entries.some((entry) => entry.href === current)) return current
  if (new URL(current, 'https://workspace.invalid').pathname !== '/workspace/operate') return current
  const state = parseOperateState(current)
  if (state.lens || (!state.server && !state.connector)) return current
  // Legacy deep links still render Services. Project only a loaded command,
  // without rewriting native history or conflating explicit Health/Usage lenses.
  const services = operateHref({ ...state, lens: 'services' })
  return entries.some((entry) => entry.href === services) ? services : current
}
export function WorkspaceCommandsProvider({
  owner,
  role,
  children,
  enabled = true,
}: {
  owner: string
  role: Role
  enabled?: boolean
  children: ReactNode
}) {
  const location = useWorkspaceLocation()
  const [sources, setSources] = useState(new Map<symbol, Registration>())
  const register = useCallback((source: symbol, value: Registration | null) => {
    setSources((previous) => {
      const next = new Map(previous)
      if (value) next.set(source, value)
      else next.delete(source)
      return next
    })
  }, [])
  const entries = useMemo(() => {
    if (!enabled) return []
    const roots = (['work', 'explore', 'operate'] as const).map((id) => ({
      id,
      label: { work: 'Chat & tasks', explore: 'Knowledge', operate: 'Tools & connections' }[id],
      href: `/workspace/${id}`,
    }))
    const loaded = [...sources.values()]
      .filter((value) => value.owner === owner && value.location === location)
      .flatMap((value) => [...value.entries].slice(0, 100))
    const unique = new Map<string, WorkspaceCommand>()
    for (const entry of [...roots, ...loaded]) {
      try {
        const href = canonical(entry.href, role)
        if (!unique.has(href))
          unique.set(href, {
            ...entry,
            href,
            label: (entry.label.trim() || entry.id.trim() || 'Workspace destination').slice(0, 256),
          })
      } catch {
        /* Invalid and unauthorized destinations are not commands. */
      }
    }
    return [...unique.values()].slice(0, 103)
  }, [sources, owner, role, location, enabled])
  const value = useMemo(() => ({ owner, role, entries, register }), [owner, role, entries, register])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
/** Register only already-loaded caller-visible destinations, never raw backend tools. */
export function useWorkspaceCommands(entries: readonly WorkspaceCommand[], loadedOwner: string) {
  const context = useContext(Context)
  const location = useWorkspaceLocation()
  const source = useRef(Symbol('workspace-commands'))
  const register = context?.register
  useEffect(() => {
    if (!register) return
    const token = source.current
    register(token, { owner: loadedOwner, location, entries })
    return () => {
      register(token, null)
    }
  }, [register, loadedOwner, location, entries])
}
export function WorkspaceCommandPalette() {
  const context = useContext(Context)
  if (!context) return null
  return <OwnedPalette key={context.owner} context={context} />
}

/** A second presentation of the same current, admitted destination catalog. */
export function useWorkspaceCommandNavigation() {
  const context = useContext(Context)
  const location = useWorkspaceLocation()
  const live = useRef(context)
  const active = useRef(true)
  live.current = context
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const select = useCallback(
    (href: string) => {
      if (
        !context ||
        !active.current ||
        live.current !== context ||
        !context.entries.some((entry) => entry.href === href)
      )
        throw new Error('Workspace command is stale or unavailable')
      navigate(href, context.role)
    },
    [context],
  )
  let current: string | null = null
  try {
    if (context) current = currentCommand(location, context.role, context.entries)
  } catch {
    // Unknown destinations stay with the native surface; never expose raw query text.
  }
  return { entries: context?.entries ?? [], owner: context?.owner ?? '', current, select }
}
function OwnedPalette({ context }: { context: CommandContext }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [surface, setSurface] = useState<HTMLDivElement | null>(null)
  useWorkspaceViewportBoundary(surface, open)
  const location = useWorkspaceLocation()
  const { trigger, onOpenAutoFocus, onCloseAutoFocus, onNavigate } = useWorkspacePaletteFocus(location)
  const active = useRef(true)
  const generation = useMemo(() => ({ id: crypto.randomUUID() }), [context.entries, context.role, location])
  const live = useRef(generation)
  live.current = generation
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    setOpen(false)
  }, [location])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', listener)
    return () => {
      window.removeEventListener('keydown', listener)
    }
  }, [])
  const select = useCallback(
    (href: string) => {
      if (!active.current || live.current !== generation || !context.entries.some((entry) => entry.href === href))
        throw new Error('Workspace command is stale or unavailable')
      onNavigate()
      navigate(href, context.role)
      setOpen(false)
    },
    [context.entries, context.role, generation, onNavigate],
  )
  const tools = useMemo(() => {
    if (!context.entries.length) return []
    const schema = z
      .object({
        commandId: z.enum(context.entries.map((_, index) => `${generation.id}:${index}`) as [string, ...string[]]),
      })
      .strict()
    return [
      makeTool({
        name: 'agent-webui.workspace.command',
        title: 'Open a workspace destination',
        description:
          'Select a migrated context or caller-visible loaded evidence destination. Navigation only; never executes backend operations.',
        inputSchema: schema,
        outputSchema: z.object({ selected: z.literal(true) }),
        jsonSchema: z.toJSONSchema(schema),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/WorkspaceCommands.tsx',
        execute: ({ commandId }) => {
          const index = context.entries.findIndex((_, position) => `${generation.id}:${position}` === commandId)
          if (index < 0) throw new Error('Workspace command identifier is stale')
          select(context.entries[index].href)
          return { selected: true as const }
        },
      }),
      makeTool({
        name: 'agent-webui.workspace.commands',
        title: 'List available workspace destinations',
        description:
          'List bounded labels and ephemeral command identifiers for migrated contexts and currently loaded evidence. Does not expose collection query text.',
        inputSchema: z.object({ offset: z.number().int().min(0).max(103).default(0) }).strict(),
        outputSchema: z.object({
          commands: z.array(z.object({ commandId: z.string(), label: z.string() })).max(5),
          total: z.number(),
          nextOffset: z.number().nullable(),
        }),
        jsonSchema: z.toJSONSchema(z.object({ offset: z.number().int().min(0).max(103).default(0) }).strict()),
        readOnly: true,
        source: 'agent-webui:src/components/workspace/WorkspaceCommands.tsx',
        execute: ({ offset }) => {
          if (!active.current || live.current !== generation) throw new Error('Workspace command catalog is stale')
          return {
            commands: context.entries.slice(offset, offset + 5).map((entry, index) => ({
              commandId: `${generation.id}:${offset + index}`,
              label: Array.from(entry.label)
                .slice(0, 40)
                .map((character) =>
                  character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
                    ? ' '
                    : character.length === 1 && character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff
                      ? '\ufffd'
                      : character,
                )
                .join(''),
            })),
            total: context.entries.length,
            nextOffset: offset + 5 < context.entries.length ? offset + 5 : null,
          }
        },
      }),
    ]
  }, [context.entries, select, generation])
  useWebMcpToolSet(tools)
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) setSearch('')
      }}
    >
      <DialogTrigger asChild>
        <button
          ref={trigger}
          aria-label="Find destination"
          className="workspace-command-trigger min-h-11 rounded border px-3 text-sm"
        >
          <Search size={16} aria-hidden="true" />
          Find destination
          <kbd aria-hidden="true">Ctrl / ⌘ K</kbd>
        </button>
      </DialogTrigger>
      <DialogContent
        ref={setSurface}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        className="top-[min(50%,calc(var(--workspace-visible-height,100dvh)/2))] max-h-[min(85dvh,calc(var(--workspace-visible-height,100dvh)*0.85))] overflow-auto motion-reduce:animate-none sm:max-w-3xl"
        showCloseButton={false}
      >
        <DialogTitle>Find a workspace destination</DialogTitle>
        <DialogDescription>
          Three contexts and currently loaded evidence. Other capabilities are still being migrated.
        </DialogDescription>
        <label>
          Search destinations
          <input
            className="mt-1 min-h-11 w-full rounded border bg-background px-3"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </label>
        <WorkspaceCommandDestinations entries={context.entries} search={search} onSelect={select} />
        <button
          className="min-h-11 rounded border px-3"
          onClick={() => {
            setOpen(false)
          }}
        >
          Close destination search
        </button>
      </DialogContent>
    </Dialog>
  )
}
