import { useState, useEffect, useRef, type MouseEvent } from 'react'
import { z } from 'zod'
import { Trash2, Terminal, Loader2, Send, XCircle, RefreshCw, Database, Cpu, Layers, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Response } from '@/components/ai-elements/response'
import { cn } from '@/lib/utils'
import { fetchValidated, looseArray } from '@/lib/api-validation'

interface Turn {
  id: string
  session_id: string
  turn_number: number
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: number
  status: string
  duration_ms: number
}

interface Session {
  id: string
  title: string
  created_at: number
  updated_at: number
  model: string
  mode: string
  workspace: string
  turn_count: number
  status: string
  background: boolean
  needs_input: boolean
  last_response_preview: string
  goal_id?: string
}

// D-WUI-16: /api/enhanced/sessions can answer null/{} instead of an array
// (cold cache, degraded backend). `res.ok` alone does not guard body shape.
const sessionSchema: z.ZodType<Session> = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  model: z.string(),
  mode: z.string(),
  workspace: z.string(),
  turn_count: z.number(),
  status: z.string(),
  background: z.boolean(),
  needs_input: z.boolean(),
  last_response_preview: z.string(),
  goal_id: z.string().optional(),
})

function sessionStatusBadgeClass(sess: Session): string {
  return cn(
    'capitalize shrink-0 border shadow-none font-medium px-2 py-0.5 text-[10px]',
    sess.status === 'running' && 'bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse',
    sess.needs_input && 'bg-amber-500/10 text-amber-600 border-amber-500/20 animate-pulse',
    sess.status === 'completed' && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    sess.status === 'failed' && 'bg-destructive/10 text-destructive border-destructive/20',
  )
}

interface SessionCardProps {
  sess: Session
  onDelete: (id: string, e: MouseEvent) => void
  onCancel: (id: string, e: MouseEvent) => void
  onOpenDrawer: (sess: Session) => void
}

function renderSessionCard({ sess, onDelete, onCancel, onOpenDrawer }: SessionCardProps) {
  return (
    <Card
      key={sess.id}
      className={cn(
        'group relative border-border/40 backdrop-blur-md bg-card/65 transition-all duration-300 hover:shadow-lg hover:border-primary/20',
        sess.needs_input && 'border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.05)]',
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate group-hover:text-primary transition-colors">
              {sess.title || 'Untitled Session'}
            </CardTitle>
            <CardDescription className="text-xs truncate font-mono mt-0.5">
              ID: {sess.id.slice(0, 8)}...
            </CardDescription>
          </div>
          <Badge className={sessionStatusBadgeClass(sess)}>{sess.needs_input ? 'Awaiting Reply' : sess.status}</Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-3 text-xs space-y-2.5">
        <div className="p-2 rounded bg-muted/30 border border-border/20 text-muted-foreground font-mono line-clamp-2 min-h-[2.5rem]">
          {sess.last_response_preview || 'No preview logs available.'}
        </div>

        <div className="grid grid-cols-2 gap-4 text-[11px] text-muted-foreground pt-1">
          <div className="flex items-center gap-1.5 font-mono">
            <Cpu className="size-3.5 text-primary/60" />
            <span className="truncate">{sess.model || 'n/a'}</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono">
            <Layers className="size-3.5 text-primary/60" />
            <span>{sess.turn_count} execution steps</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="pt-2 border-t border-border/20 flex gap-2 justify-between">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="size-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
            onClick={(e) => {
              onDelete(sess.id, e)
            }}
          >
            <Trash2 className="size-4" />
          </Button>

          {sess.status === 'running' && (
            <Button
              size="sm"
              variant="ghost"
              className="size-8 p-0 text-muted-foreground hover:text-amber-600 hover:bg-amber-500/5"
              onClick={(e) => {
                onCancel(sess.id, e)
              }}
            >
              <XCircle className="size-4" />
            </Button>
          )}
        </div>

        <Button
          size="sm"
          variant={sess.needs_input ? 'default' : 'secondary'}
          className={cn(
            'gap-1 px-3 shadow-none border border-border/10',
            sess.needs_input && 'bg-amber-600 hover:bg-amber-700 text-white',
          )}
          onClick={() => {
            onOpenDrawer(sess)
          }}
        >
          <Terminal className="size-3.5" />
          <span>Attach Console</span>
          <ArrowRight className="size-3 ml-0.5 opacity-60" />
        </Button>
      </CardFooter>
    </Card>
  )
}

function renderSessionsGrid({
  loading,
  sessions,
  onDelete,
  onCancel,
  onOpenDrawer,
}: {
  loading: boolean
  sessions: Session[]
} & Omit<SessionCardProps, 'sess'>) {
  if (loading) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-primary/60" />
          <p className="text-muted-foreground text-sm animate-pulse">Querying session registry...</p>
        </div>
      </div>
    )
  }
  if (sessions.length === 0) {
    return (
      <Card className="border-dashed border-border/40 bg-muted/5">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <div className="p-4 rounded-full bg-primary/5 text-primary/60 mb-4 border border-primary/10">
            <Database className="size-8" />
          </div>
          <h3 className="font-semibold text-lg">No Durable Sessions Found</h3>
          <p className="text-muted-foreground text-sm max-w-sm mt-1 mb-6">
            Start an agent execution loop in the terminal UI or spin up an autonomous goal to view session history
            and attachment handles here.
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {sessions.map((sess) => renderSessionCard({ sess, onDelete, onCancel, onOpenDrawer }))}
    </div>
  )
}

function renderTurnBubble(turn: Turn, index: number) {
  return (
    <div
      key={turn.id || index}
      className={cn(
        'flex flex-col gap-1.5 max-w-[90%] transition-opacity duration-300',
        turn.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start',
      )}
    >
      <span className="text-[10px] text-muted-foreground/50 px-1 font-mono">
        {turn.role.toUpperCase()} • Step {turn.turn_number}
      </span>
      <div
        className={cn(
          'rounded-lg px-4 py-3 text-xs leading-relaxed border shadow-sm',
          turn.role === 'user'
            ? 'bg-secondary text-secondary-foreground border-border/40 font-sans'
            : 'bg-muted/15 border-border/10 prose prose-invert max-w-none prose-sm',
        )}
      >
        {turn.role === 'user' ? <p className="whitespace-pre-wrap">{turn.content}</p> : <Response>{turn.content}</Response>}
      </div>
    </div>
  )
}

function renderTurnsLog(turns: Turn[]) {
  if (turns.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground/40 text-xs">
        Console outputs are empty. Waiting for step results...
      </div>
    )
  }
  return <>{turns.map(renderTurnBubble)}</>
}

function renderReplyInput({
  replyText,
  onReplyTextChange,
  submittingReply,
  onSendReply,
}: {
  replyText: string
  onReplyTextChange: (v: string) => void
  submittingReply: boolean
  onSendReply: () => void
}) {
  return (
    <div className="space-y-3 w-full">
      <div className="flex items-center justify-between text-xs text-amber-500 bg-amber-500/5 border border-amber-500/10 px-3 py-2 rounded-md font-mono">
        <div className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Agent is suspended waiting for user instructions...</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Textarea
          placeholder="Enter reply instructions..."
          value={replyText}
          onChange={(e) => {
            onReplyTextChange(e.target.value)
          }}
          className="flex-1 min-h-[60px] max-h-[140px] text-xs font-mono bg-muted/40 border-border/40"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSendReply()
            }
          }}
        />
        <Button
          onClick={onSendReply}
          disabled={submittingReply || !replyText.trim()}
          className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 self-end h-10 px-4"
        >
          {submittingReply ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <Send className="size-4" />
              <span>Submit</span>
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function renderDrawerFooter({
  selectedSession,
  replyText,
  onReplyTextChange,
  submittingReply,
  onSendReply,
}: {
  selectedSession: Session | null
  replyText: string
  onReplyTextChange: (v: string) => void
  submittingReply: boolean
  onSendReply: () => void
}) {
  if (selectedSession?.needs_input) {
    return renderReplyInput({ replyText, onReplyTextChange, submittingReply, onSendReply })
  }
  if (selectedSession?.status === 'running') {
    return (
      <div className="w-full flex items-center justify-center p-3 text-xs text-muted-foreground bg-muted/10 rounded-md font-mono border border-border/10">
        <Loader2 className="size-3.5 animate-spin mr-2 text-primary" />
        Agent execution thread running background iterations...
      </div>
    )
  }
  return (
    <div className="w-full text-center text-xs text-muted-foreground/60 py-2 font-mono">
      Session execution terminated (status: {selectedSession?.status}).
    </div>
  )
}

export default function SessionsView() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const [refreshingDrawer, setRefreshingDrawer] = useState(false)

  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetchSessions()
    const interval = setInterval(() => {
      void fetchSessions(true)
    }, 4000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (selectedSessionId && drawerOpen) {
      void fetchSessionDetails(selectedSessionId)
      const interval = setInterval(() => {
        void fetchSessionDetails(selectedSessionId, true)
      }, 2000)
      return () => {
        clearInterval(interval)
      }
    }
  }, [selectedSessionId, drawerOpen])

  // Scroll to bottom of turns list on updates
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [turns])

  const fetchSessions = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const data = await fetchValidated('/api/enhanced/sessions', looseArray(sessionSchema))
      setSessions(data)
    } catch (_err) {
      if (!silent) toast.error('Failed to connect to SQLite sessions storage')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const fetchSessionDetails = async (sessionId: string, silent = false) => {
    try {
      if (!silent) setRefreshingDrawer(true)
      const res = await fetch(`/api/enhanced/sessions/${sessionId}`)
      if (res.ok) {
        const data = (await res.json()) as Session & { turns: Turn[] }
        setSelectedSession(data)
        setTurns(data.turns)
      }
    } catch (_err) {
      if (!silent) toast.error('Failed to load session execution turns')
    } finally {
      if (!silent) setRefreshingDrawer(false)
    }
  }

  const handleDeleteSession = async (sessionId: string, e: MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('Are you sure you want to permanently delete this agent session from storage?')) return

    try {
      const res = await fetch(`/api/enhanced/sessions/${sessionId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Session successfully purged')
        void fetchSessions()
        if (selectedSessionId === sessionId) {
          setDrawerOpen(false)
          setSelectedSessionId(null)
        }
      } else {
        toast.error('Failed to purge session record')
      }
    } catch (_err) {
      toast.error('Network error during session deletion')
    }
  }

  const handleCancelSession = async (sessionId: string, e: MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/enhanced/sessions/${sessionId}/cancel`, { method: 'POST' })
      if (res.ok) {
        toast.success('Active background execution cancelled')
        void fetchSessions()
      } else {
        toast.error('Failed to cancel session execution')
      }
    } catch (_err) {
      toast.error('Network error during cancel action')
    }
  }

  const handleSendReply = async () => {
    if (!selectedSessionId || !replyText.trim()) return
    try {
      setSubmittingReply(true)
      const res = await fetch(`/api/enhanced/sessions/${selectedSessionId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyText }),
      })
      if (res.ok) {
        toast.success('Reply successfully posted')
        setReplyText('')
        void fetchSessionDetails(selectedSessionId)
        void fetchSessions(true)
      } else {
        toast.error('Failed to post reply')
      }
    } catch (_err) {
      toast.error('Network error during reply submission')
    } finally {
      setSubmittingReply(false)
    }
  }

  const handleOpenDrawer = (session: Session) => {
    setSelectedSessionId(session.id)
    setSelectedSession(session)
    setDrawerOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text text-transparent">
            Durable Sessions Console
          </h1>
          <p className="text-muted-foreground text-sm">
            Monitor, inspect, and reply to terminal-attached or backgrounded SQLite-backed agent runs (TUI-20).
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void fetchSessions()
          }}
          disabled={loading}
          className="gap-2 h-9 border-border/40 hover:bg-muted/50"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Reload
        </Button>
      </div>

      {renderSessionsGrid({
        loading,
        sessions,
        onDelete: (id, e) => {
          void handleDeleteSession(id, e)
        },
        onCancel: (id, e) => {
          void handleCancelSession(id, e)
        },
        onOpenDrawer: handleOpenDrawer,
      })}

      {/* Slide Drawer Console */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="sm:max-w-2xl w-full flex flex-col p-0 border-l border-border/40 shadow-2xl backdrop-blur-lg bg-background/95">
          <SheetHeader className="p-6 border-b border-border/40 flex-row items-center justify-between gap-4">
            <div className="space-y-1">
              <SheetTitle className="flex items-center gap-2 font-mono text-base font-semibold">
                <Terminal className="size-5 text-primary" />
                <span>Console Session: {selectedSession?.title ?? 'Logs'}</span>
              </SheetTitle>
              <SheetDescription className="text-xs font-mono truncate">ID: {selectedSession?.id}</SheetDescription>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {selectedSession?.status === 'running' && (
                <Badge className="bg-blue-500/10 text-blue-500 border border-blue-500/20 shadow-none px-2 py-0.5 text-[10px] animate-pulse">
                  Connected Live
                </Badge>
              )}
              {refreshingDrawer && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </div>
          </SheetHeader>

          {/* Logs Area */}
          <ScrollArea
            ref={scrollAreaRef}
            className="flex-1 p-6 bg-[#030712] text-[#f3f4f6] font-mono selection:bg-primary/30"
          >
            <div className="space-y-6">
              <div className="text-[11px] text-muted-foreground/60 border-b border-border/10 pb-4">
                *** DURABLE LOG PERSISTENCE INITIALIZED ON SQLite SHIELD ***
                <br />
                Model Target: {selectedSession?.model}
                <br />
                Active Directory: {selectedSession?.workspace}
              </div>

              {renderTurnsLog(turns)}
            </div>
          </ScrollArea>

          {/* Input Footer for Elicitation */}
          <SheetFooter className="p-4 border-t border-border/40 bg-background/50 flex flex-col gap-2 shrink-0">
            {renderDrawerFooter({
              selectedSession,
              replyText,
              onReplyTextChange: setReplyText,
              submittingReply,
              onSendReply: () => {
                void handleSendReply()
              },
            })}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
