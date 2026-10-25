import { workspaceButtonClass } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import type { Identity } from '@/lib/auth'
import { roleAtLeast } from '@/lib/nav-registry'
import { OperateStateSchema, type OperateState } from '@/lib/operate-workspace'
import { useUsageController } from '@/hooks/useUsageController'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  UsageActivityPanel,
  UsageBreakdownPanel,
  UsageKpis,
  UsageSearchPanel,
  UsageSessionPanel,
  UsageSessionsPanel,
  UsageToolsPanel,
  UsageTracesPanel,
} from './UsagePanels'

function fieldText(fields: FormData, key: string): string | undefined {
  const value = fields.get(key)
  return typeof value === 'string' ? value.trim() || undefined : undefined
}
const control = 'min-h-11 min-w-0 rounded border px-3 py-2 text-sm [overflow-wrap:anywhere]'
const panels = ['models', 'projects', 'agents', 'tools', 'activity', 'sessions', 'search', 'traces'] as const
const labels = {
  models: 'Models',
  projects: 'Projects',
  agents: 'Agents',
  tools: 'Tools & Skills',
  activity: 'Activity',
  sessions: 'Sessions',
  search: 'Search',
  traces: 'Traces',
}
const filterFields = [
  ['usageFrom', 'From', 'date'],
  ['usageTo', 'To', 'date'],
  ['usageModel', 'Model', 'text'],
  ['usageProject', 'Project', 'text'],
  ['usageAgent', 'Agent', 'text'],
  ['usageOrigin', 'Origin', 'text'],
] as const
export interface UsageAnalyticsProps {
  identity: Identity
  generation: string
  state: OperateState
  onNavigate: (next: OperateState) => void
}

/** Reusable analytics controls and panels, deliberately no standalone page shell. */
export function UsageAnalytics({ identity, generation, state, onNavigate }: UsageAnalyticsProps) {
  const data = useUsageController(identity, generation, state)
  const heading = useRef<HTMLHeadingElement>(null)
  const selection = `${state.usageSession ?? ''}:${state.usageDetail ?? ''}`
  const previousSelection = useRef(selection)
  useEffect(() => {
    if (previousSelection.current !== selection) heading.current?.focus()
    previousSelection.current = selection
  }, [selection])
  const [searchInput, setSearchInput] = useState(state.usageSearch ?? '')
  const [validationError, setValidationError] = useState('')
  function selectSession(id: string) {
    onNavigate({ ...state, usageSession: id, usageDetail: 'overview' })
  }
  function applyFilters(form: HTMLFormElement) {
    const fields = new FormData(form)
    const next = { ...state, usageSession: undefined, usageDetail: undefined, usageSearch: undefined }
    for (const [key] of filterFields) next[key] = fieldText(fields, key)
    if (roleAtLeast(identity.role, 'admin')) next.usageTenant = fieldText(fields, 'usageTenant')
    const parsed = OperateStateSchema.safeParse(next)
    if (!parsed.success) {
      setValidationError('Enter a valid date range and filters of at most 256 characters.')
      return
    }
    setValidationError('')
    onNavigate(parsed.data)
  }
  if (!data.allowed)
    return <p role="alert">Usage requires a signed-in user role. Only an administrator can name another tenant.</p>
  return (
    <section aria-label="Usage analysis" className="usage-analysis min-w-0 space-y-3 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 ref={heading} tabIndex={-1} className="font-semibold">
          Usage &amp; cost analysis
        </h2>
        <button type="button" className={workspaceButtonClass} onClick={data.refresh}>
          Refresh usage
        </button>
      </div>
      <p className="text-sm">
        Tenant: <span className="font-mono">{state.usageTenant ?? identity.raw?.tenant ?? 'current caller'}</span>.
        Analytics depend on the configured producer. Tenant token totals do not establish session, model-cost or
        instrumentation coverage.
      </p>
      <details className="min-w-0 rounded border p-2">
        <summary className="min-h-11 cursor-pointer py-2">Usage filters</summary>
        <form
          className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault()
            applyFilters(event.currentTarget)
          }}
        >
          {roleAtLeast(identity.role, 'admin') && (
            <label className="flex min-w-0 flex-col gap-1">
              Tenant ID
              <input
                className={control}
                name="usageTenant"
                defaultValue={state.usageTenant ?? ''}
                maxLength={256}
                placeholder={identity.raw?.tenant ?? 'Current tenant'}
              />
            </label>
          )}
          {filterFields.map(([key, label, type]) => (
            <label key={key} className="flex min-w-0 flex-col gap-1">
              {label}
              <input className={control} type={type} name={key} defaultValue={state[key] ?? ''} maxLength={256} />
            </label>
          ))}
          <button type="submit" className={workspaceButtonClass}>
            Apply usage filters
          </button>
        </form>
        {validationError && <p role="alert">{validationError}</p>}
      </details>
      <p className="text-xs text-muted-foreground">
        Applied filters:{' '}
        {filterFields
          .map(([key, label]) => (state[key] ? `${label}: ${state[key]}` : ''))
          .filter(Boolean)
          .join(' · ') || 'none'}
        . Search and traces use the current caller tenant and are not narrowed by these filters.
      </p>
      {data.denied ? (
        <p role="alert">
          Usage access was denied. Previous analytics, search and session evidence have been withdrawn. Refresh to
          retry with current authority.
        </p>
      ) : (
        <>
          {data.loading && (
            <p role="status">Loading usage evidence; refreshing panels do not show previous measurements.</p>
          )}
          <UsageKpis
            summaryUnavailable={!data.summary.data || data.summary.isFetching || data.summary.isError}
            summary={data.summary.data ?? null}
          />
          {data.summary.isError && <p role="alert">The usage summary is unavailable. This is not measured zero.</p>}
          {state.usageSession ? (
            <section className="space-y-3" aria-label="Selected usage session">
              <p className="text-sm">Selected session: {state.usageSession}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={workspaceButtonClass}
                  onClick={() => {
                    onNavigate({ ...state, usageSession: undefined, usageDetail: undefined })
                  }}
                >
                  Back to usage results
                </button>
                <button
                  className={workspaceButtonClass}
                  aria-pressed={state.usageDetail !== 'timeline'}
                  onClick={() => {
                    onNavigate({ ...state, usageDetail: 'overview' })
                  }}
                >
                  Session overview
                </button>
                <button
                  className={workspaceButtonClass}
                  aria-pressed={state.usageDetail === 'timeline'}
                  onClick={() => {
                    onNavigate({ ...state, usageDetail: 'timeline' })
                  }}
                >
                  Session timeline
                </button>
              </div>
              {!data.ownTenant ? (
                <p role="status">
                  Cross-tenant session detail is unavailable: the existing detail binding does not accept a tenant. No
                  caller-tenant fallback was requested.
                </p>
              ) : data.detail.isError ? (
                <p role="alert">Session detail is unavailable or does not match the selected session.</p>
              ) : data.detail.isFetching || data.detail.isPending ? (
                <p role="status">Awaiting selected session evidence…</p>
              ) : (
                <UsageSessionPanel detail={data.detail.data} timeline={state.usageDetail === 'timeline'} />
              )}
            </section>
          ) : (
            <Tabs
              value={state.usagePanel ?? 'models'}
              onValueChange={(value) => {
                if (panels.includes(value as (typeof panels)[number]))
                  onNavigate({ ...state, usagePanel: value as (typeof panels)[number] })
              }}
            >
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1" aria-label="Usage views">
                {panels.map((panel) => (
                  <TabsTrigger className="min-h-11" key={panel} value={panel}>
                    {labels[panel]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {(['models', 'projects', 'agents'] as const).map((panel) => (
                <TabsContent key={panel} value={panel}>
                  <h3 className="mb-2 font-medium">
                    Cost by {panel === 'models' ? 'model' : panel === 'projects' ? 'project' : 'agent'}
                  </h3>
                  <UsageBreakdownPanel
                    rows={data[panel].isFetching ? [] : (data[panel].data ?? [])}
                    unavailable={data[panel].isError || data[panel].isPending || data[panel].isFetching}
                  />
                </TabsContent>
              ))}
              <TabsContent value="tools">
                <UsageToolsPanel
                  tools={data.tools.isFetching ? [] : (data.tools.data ?? [])}
                  unavailable={data.tools.isError || data.tools.isPending || data.tools.isFetching}
                />
              </TabsContent>
              <TabsContent value="activity">
                <UsageActivityPanel
                  activity={data.activity.isFetching ? [] : (data.activity.data ?? [])}
                  unavailable={data.activity.isError || data.activity.isPending || data.activity.isFetching}
                />
              </TabsContent>
              <TabsContent value="sessions">
                <UsageSessionsPanel
                  sessions={data.sessions.isFetching ? [] : (data.sessions.data ?? [])}
                  unavailable={data.sessions.isError || data.sessions.isPending || data.sessions.isFetching}
                  onOpenDetail={selectSession}
                />
              </TabsContent>
              <TabsContent value="search" className="space-y-3">
                {!data.ownTenant ? (
                  <p role="status">
                    Cross-tenant search is unavailable: the existing binding does not accept a tenant.
                  </p>
                ) : (
                  <>
                    <UsageSearchPanel
                      searchQ={searchInput}
                      onSearchQChange={setSearchInput}
                      onRunSearch={() => {
                        const query = searchInput.trim()
                        if (query && query.length <= 128) onNavigate({ ...state, usageSearch: query })
                      }}
                      hits={data.search.isError || data.search.isFetching ? [] : (data.search.data ?? [])}
                      onOpenDetail={selectSession}
                    />
                    {data.search.isError && <p role="alert">Search is unavailable. No empty-result claim is made.</p>}
                    {state.usageSearch &&
                      data.search.isSuccess &&
                      !data.search.isFetching &&
                      !data.search.data.length && <p role="status">No matching messages.</p>}
                  </>
                )}
              </TabsContent>
              <TabsContent value="traces">
                {!data.ownTenant ? (
                  <p role="status">
                    Cross-tenant traces are unavailable: the existing binding does not accept a tenant.
                  </p>
                ) : data.traces.isError ? (
                  <p role="alert">Traces are unavailable. Exporter configuration could not be confirmed.</p>
                ) : data.traces.isFetching || data.traces.isPending ? (
                  <p role="status">Awaiting trace evidence…</p>
                ) : data.traces.data.enabled ? (
                  <>
                    <p className="text-sm">Exporter: {data.traces.data.host}</p>
                    <UsageTracesPanel traces={data.traces.data} />
                    {!data.traces.data.traces.length && <p role="status">No trace references returned.</p>}
                  </>
                ) : (
                  <p role="status">No trace exporter is enabled in the returned configuration.</p>
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </section>
  )
}
