/**
 * @file DashboardParts.tsx
 * @description Parts of the Dashboards page: the approval banner, the parameter
 * fields and the panel form (OVERSTORY-DASH-R006, R009, R013).
 */
import { Plus } from 'lucide-react'
import type { Ref } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setParams, VIZ_KINDS, type Dashboard, type VizKind } from '@/lib/dashboards/model'

export interface PanelDraft {
  id: string | null
  title: string
  viz: VizKind
  query: string
  x: string
  y: string
}

export function ApprovalBanner({
  message,
  ids,
  denyRef,
  onAnswer,
}: {
  message: string
  ids: string
  denyRef: Ref<HTMLButtonElement>
  onAnswer: (approved: boolean) => void
}) {
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${ids}-approval`}
      className="rounded-lg border border-amber-500 bg-amber-500/10 p-3"
    >
      <p id={`${ids}-approval`} className="text-sm font-medium">
        {message}
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            onAnswer(true)
          }}
        >
          Approve
        </Button>
        <Button
          variant="outline"
          size="sm"
          ref={denyRef}
          onClick={() => {
            onAnswer(false)
          }}
        >
          Deny
        </Button>
      </div>
    </div>
  )
}

export function ParamsFieldset({
  doc,
  ids,
  userEdit,
}: {
  doc: Dashboard
  ids: string
  userEdit: (label: string, change: (d: Dashboard) => Dashboard) => boolean
}) {
  return (
    <fieldset className="flex flex-wrap items-end gap-3 rounded-md border p-2">
      <legend className="px-1 text-xs text-muted-foreground">
        Parameters and filters. Use {'{{name}}'} in a query.
      </legend>
      {doc.params.map((p, index) => (
        <label key={p.name} className="text-sm" htmlFor={`${ids}-p-${p.name}`}>
          {p.label}
          <Input
            id={`${ids}-p-${p.name}`}
            type={p.type === 'number' ? 'number' : 'text'}
            value={String(p.value)}
            onChange={(e) => {
              const value = p.type === 'number' ? Number(e.target.value) : e.target.value
              userEdit(`Set ${p.name}`, (d) =>
                setParams(
                  d,
                  d.params.map((q, i) => (i === index ? { ...q, value } : q)),
                ),
              )
            }}
          />
        </label>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const name = `param${String(doc.params.length + 1)}`
          userEdit(`Added parameter ${name}`, (d) =>
            setParams(d, [...d.params, { name, label: name, type: 'text', value: '' }]),
          )
        }}
      >
        <Plus /> Parameter
      </Button>
    </fieldset>
  )
}

export function PanelForm({
  draft,
  ids,
  setDraft,
  onSubmit,
}: {
  draft: PanelDraft
  ids: string
  setDraft: (draft: PanelDraft | null) => void
  onSubmit: () => void
}) {
  return (
    <form
      aria-label={draft.id ? 'Edit panel' : 'Add panel'}
      className="grid gap-2 rounded-lg border p-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <label className="text-sm" htmlFor={`${ids}-pt`}>
        Panel title
        <Input
          id={`${ids}-pt`}
          required
          value={draft.title}
          onChange={(e) => {
            setDraft({ ...draft, title: e.target.value })
          }}
        />
      </label>
      <label className="text-sm" htmlFor={`${ids}-pv`}>
        Visualization
        <select
          id={`${ids}-pv`}
          className="block h-9 w-full rounded-md border bg-transparent px-2"
          value={draft.viz}
          onChange={(e) => {
            setDraft({ ...draft, viz: e.target.value as VizKind })
          }}
        >
          {VIZ_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm md:col-span-2" htmlFor={`${ids}-pq`}>
        UQL query (must end with one LIMIT)
        <textarea
          id={`${ids}-pq`}
          required
          className="block min-h-20 w-full rounded-md border bg-transparent p-2 font-mono text-sm"
          value={draft.query}
          onChange={(e) => {
            setDraft({ ...draft, query: e.target.value })
          }}
        />
      </label>
      <label className="text-sm" htmlFor={`${ids}-px`}>
        X or label column
        <Input
          id={`${ids}-px`}
          value={draft.x}
          onChange={(e) => {
            setDraft({ ...draft, x: e.target.value })
          }}
        />
      </label>
      <label className="text-sm" htmlFor={`${ids}-py`}>
        Y or value column
        <Input
          id={`${ids}-py`}
          value={draft.y}
          onChange={(e) => {
            setDraft({ ...draft, y: e.target.value })
          }}
        />
      </label>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit">{draft.id ? 'Save panel' : 'Add panel'}</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft(null)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
