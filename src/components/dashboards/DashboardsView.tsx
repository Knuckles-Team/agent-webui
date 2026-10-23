/**
 * @file DashboardsView.tsx
 * @description `/data-dashboards`: build dashboards by hand or together with the chat agent
 * (WEBUI-DASH-R006, R008, R009, R013, R015). The agent works through the WebMCP tools
 * registered below, which exist only while this page is mounted. Every edit, from the
 * person or the agent, lands in the activity log and can be undone.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, Redo2, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  addPanel,
  DashboardError,
  removePanel,
  renameDashboard,
  swapPanels,
  updatePanel,
  type Dashboard,
  type Panel,
  type Param,
} from '@/lib/dashboards/model'
import { runPanelQuery } from '@/lib/dashboards/query'
import { createDashboardTools } from '@/lib/dashboards/tools'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { ApprovalBanner, PanelForm, ParamsFieldset, type PanelDraft } from './DashboardParts'
import { PanelBody } from './PanelBody'
import { useDashboards } from './useDashboards'

const INTERVALS = [
  { label: 'Off', ms: 0 },
  { label: '30 seconds', ms: 30_000 },
  { label: '1 minute', ms: 60_000 },
  { label: '5 minutes', ms: 300_000 },
]

const EMPTY_DRAFT: PanelDraft = { id: null, title: '', viz: 'table', query: '', x: '', y: '' }

function PanelCard({
  panel,
  params,
  refreshKey,
  intervalMs,
  canMoveUp,
  canMoveDown,
  onEdit,
  onRemove,
  onMove,
}: {
  panel: Panel
  params: readonly Param[]
  refreshKey: number
  intervalMs: number
  canMoveUp: boolean
  canMoveDown: boolean
  onEdit: () => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const query = useQuery({
    queryKey: ['dashboard-panel', panel.query.text, JSON.stringify(params), refreshKey],
    queryFn: ({ signal }) => runPanelQuery(panel, params, signal),
    refetchInterval: intervalMs > 0 ? intervalMs : false,
    retry: false,
  })
  const { layout } = panel
  return (
    <section
      aria-labelledby={`panel-${panel.id}`}
      className="min-w-0 rounded-lg border bg-card p-3 text-card-foreground md:[grid-column:var(--c)/span_var(--w)]"
      style={{ ['--c' as string]: layout.x + 1, ['--w' as string]: layout.w }}
      data-testid={`panel-${panel.id}`}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 id={`panel-${panel.id}`} className="truncate text-sm font-medium">
          {panel.title}
        </h3>
        <div className="flex shrink-0 gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Move ${panel.title} up`}
            disabled={!canMoveUp}
            onClick={() => {
              onMove(-1)
            }}
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Move ${panel.title} down`}
            disabled={!canMoveDown}
            onClick={() => {
              onMove(1)
            }}
          >
            <ArrowDown />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Edit ${panel.title}`} onClick={onEdit}>
            <Pencil />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Remove ${panel.title}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </header>
      <PanelBody panel={panel} outcome={query.data} loading={query.isLoading} />
    </section>
  )
}

export default function DashboardsView() {
  const dash = useDashboards()
  const { state, saved, saveResult, pending, controller } = dash
  const doc = state.doc
  const [draft, setDraft] = useState<PanelDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [intervalMs, setIntervalMs] = useState(0)
  const [newTitle, setNewTitle] = useState('')
  const ids = useId()

  const tools = useMemo(() => createDashboardTools(controller), [controller])
  useWebMcpToolSet(tools)

  const userEdit = (label: string, change: (d: Dashboard) => Dashboard) => {
    try {
      dash.edit('user', label, change)
      setError(null)
      return true
    } catch (e) {
      setError(e instanceof DashboardError ? e.message : 'The change was refused.')
      return false
    }
  }

  const submitDraft = () => {
    if (!draft) return
    const options = { ...(draft.x ? { x: draft.x } : {}), ...(draft.y ? { y: draft.y } : {}) }
    const ok = draft.id
      ? userEdit(`Edited panel "${draft.title}"`, (d) =>
          updatePanel(d, draft.id!, { title: draft.title, viz: draft.viz, query: draft.query, options }),
        )
      : userEdit(
          `Added panel "${draft.title}"`,
          (d) => addPanel(d, { title: draft.title, viz: draft.viz, query: draft.query, options }).doc,
        )
    if (ok) setDraft(null)
  }

  const askRemove = (panel: Panel) => {
    void dash.requestApproval(`Remove the panel "${panel.title}"?`).then((approved) => {
      if (approved) userEdit(`Removed panel "${panel.title}"`, (d) => removePanel(d, panel.id))
    })
  }

  const { undo, redo } = dash
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [undo, redo])

  const denyRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (pending) denyRef.current?.focus()
  }, [pending])

  const ordered = doc ? [...doc.panels].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x) : []

  return (
    <div className="space-y-4 p-4" data-testid="dashboards-view">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboards</h1>
          <p className="text-sm text-muted-foreground">
            Build panels from graph queries, by hand or with the chat agent.
          </p>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!newTitle.trim()) return
            try {
              dash.create('user', newTitle.trim())
              setNewTitle('')
              setError(null)
            } catch (err) {
              setError(err instanceof DashboardError ? err.message : 'The dashboard could not be created.')
            }
          }}
        >
          <label className="text-sm" htmlFor={`${ids}-new`}>
            New dashboard
            <Input
              id={`${ids}-new`}
              value={newTitle}
              onChange={(e) => {
                setNewTitle(e.target.value)
              }}
              maxLength={120}
            />
          </label>
          <Button type="submit">
            <Plus /> Create
          </Button>
        </form>
      </header>

      {saved.length > 0 && (
        <nav aria-label="Saved dashboards" className="flex flex-wrap gap-2">
          {saved.map((d) => (
            <Button
              key={d.id}
              variant={d.id === doc?.id ? 'default' : 'outline'}
              size="sm"
              aria-current={d.id === doc?.id ? 'true' : undefined}
              onClick={() => {
                dash.open(d)
              }}
            >
              {d.title}
            </Button>
          ))}
        </nav>
      )}

      {pending && <ApprovalBanner message={pending.message} ids={ids} denyRef={denyRef} onAnswer={dash.answer} />}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!doc ? (
        <p className="text-sm text-muted-foreground">
          No dashboard is open. Create one above, open a saved one, or ask the chat agent to build one.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm" htmlFor={`${ids}-title`}>
              Title
              <Input
                id={`${ids}-title`}
                key={`${doc.id}-${String(doc.revision)}`}
                defaultValue={doc.title}
                maxLength={120}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== doc.title) userEdit('Renamed dashboard', (d) => renameDashboard(d, v))
                }}
              />
            </label>
            <Button
              variant="outline"
              onClick={() => {
                dash.undo()
              }}
              disabled={state.past.length === 0}
              aria-keyshortcuts="Control+Z"
            >
              <Undo2 /> Undo
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                dash.redo()
              }}
              disabled={state.future.length === 0}
              aria-keyshortcuts="Control+Shift+Z"
            >
              <Redo2 /> Redo
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setRefreshKey((k) => k + 1)
              }}
            >
              <RefreshCw /> Refresh
            </Button>
            <label className="text-sm" htmlFor={`${ids}-interval`}>
              Auto refresh
              <select
                id={`${ids}-interval`}
                className="block h-9 rounded-md border bg-transparent px-2"
                value={intervalMs}
                onChange={(e) => {
                  setIntervalMs(Number(e.target.value))
                }}
              >
                {INTERVALS.map((i) => (
                  <option key={i.ms} value={i.ms}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              onClick={() => {
                setDraft(EMPTY_DRAFT)
              }}
            >
              <Plus /> Add panel
            </Button>
          </div>

          <ParamsFieldset doc={doc} ids={ids} userEdit={userEdit} />

          {draft && <PanelForm draft={draft} ids={ids} setDraft={setDraft} onSubmit={submitDraft} />}

          {ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This dashboard has no panels. Add one, or ask the chat agent.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-12" data-testid="dashboard-grid">
              {ordered.map((panel, index) => (
                <PanelCard
                  key={panel.id}
                  panel={panel}
                  params={doc.params}
                  refreshKey={refreshKey}
                  intervalMs={intervalMs}
                  canMoveUp={index > 0}
                  canMoveDown={index < ordered.length - 1}
                  onEdit={() => {
                    setDraft({
                      id: panel.id,
                      title: panel.title,
                      viz: panel.viz,
                      query: panel.query.text,
                      x: panel.options.x ?? '',
                      y: panel.options.y ?? '',
                    })
                  }}
                  onRemove={() => {
                    askRemove(panel)
                  }}
                  onMove={(dir) => {
                    const other = ordered[index + dir]
                    userEdit(`Moved panel "${panel.title}"`, (d) => swapPanels(d, panel.id, other.id))
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      <section aria-labelledby={`${ids}-activity`}>
        <h2 id={`${ids}-activity`} className="text-sm font-medium">
          Activity
        </h2>
        <ol aria-live="polite" className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs text-muted-foreground">
          {state.log.length === 0 ? (
            <li>No edits yet.</li>
          ) : (
            [...state.log].reverse().map((entry) => (
              <li key={entry.seq}>
                <span className="font-medium">{entry.actor === 'agent' ? 'Agent' : 'You'}:</span> {entry.label}
              </li>
            ))
          )}
        </ol>
      </section>

      {saveResult && (
        <p role="status" className="text-xs text-muted-foreground" data-testid="save-status">
          {saveResult.message}
        </p>
      )}
    </div>
  )
}
