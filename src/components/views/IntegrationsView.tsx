/**
 * @file IntegrationsView.tsx
 * @description GOC-25: the dynamic `/integrations` catalog page.
 *
 * Generalizes the reference patterns from two lanes that just landed on
 * this repo:
 *
 * - `McpAppsView.tsx` (GOC-26-W04): discover-from-live-catalog, one card per
 *   discovered item, an inline (not routed) detail panel on selection, and
 *   a host-side capability distinction -- there, "does this tool declare a
 *   usable app"; here, "does this package have a valid, schema-checked
 *   descriptor" (`src/lib/integrations-catalog.ts`'s `composeItem`). Same
 *   shape: a missing/invalid capability signal means NO card claims
 *   availability, never a greyed-out placeholder card.
 * - `GraphOSReadinessView.tsx` (GOC-02): a typed client
 *   (`integrations-catalog.ts`) that never softens a validation failure
 *   into a plausible "probably fine" state, rendered with an explicit
 *   per-section status rather than a single opaque spinner-or-not.
 *
 * Unlike `EcosystemView.tsx`'s BUG-018 "Other Integrations" tab (this
 * lane's own prior increment, still live and unchanged by this file), this
 * page is NOT limited to packages lacking a hand-built card -- it lists the
 * FULL live catalog, so it is the one page an operator can trust for total
 * parity ("is every installed package accounted for") without needing to
 * know which packages happen to have a dedicated dashboard elsewhere.
 *
 * Capability is decided host-side, never by trusting a server-declared
 * flag: `integrations-catalog.ts` computes `status` from independent
 * per-record schema validation (see that module's docstring) -- this view
 * only ever renders the ALREADY-DECIDED status, it never re-derives
 * "available" from a raw descriptor field itself.
 */
import { useEffect, useMemo, useState } from 'react'
import { Compass, Loader2, Package, RefreshCw, Search } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { BlockedState } from '@/components/renderers/BlockedState'
import { MetricCards } from '@/components/renderers/MetricCards'
import {
  fetchIntegrationsCatalog,
  type IntegrationCatalogItem,
  type IntegrationsCatalog,
} from '@/lib/integrations-catalog'

const STATUS_BADGE_CLASSES: Record<IntegrationCatalogItem['status'], string> = {
  available: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5',
  degraded: 'border-amber-500/30 text-amber-600 dark:text-amber-500 bg-amber-500/5',
  blocked: 'border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/5',
  not_configured: 'border-border/60 text-muted-foreground bg-accent/10',
}

const STATUS_LABEL: Record<IntegrationCatalogItem['status'], string> = {
  available: 'Available',
  degraded: 'Degraded',
  blocked: 'Blocked',
  not_configured: 'Not configured',
}

export default function IntegrationsView() {
  const [catalog, setCatalog] = useState<IntegrationsCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const result = await fetchIntegrationsCatalog()
      setCatalog(result)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredItems = useMemo(() => {
    if (!catalog) return []
    const query = search.trim().toLowerCase()
    if (!query) return catalog.items
    return catalog.items.filter(
      (item) =>
        item.packageId.toLowerCase().includes(query) ||
        (item.descriptor?.title.toLowerCase().includes(query) ?? false),
    )
  }, [catalog, search])

  const selected = catalog?.items.find((item) => item.packageId === selectedId) ?? null

  return (
    <div className="space-y-6" data-testid="integrations-view">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Compass className="size-6 text-primary" />
            Integrations
          </h1>
          <p className="text-sm text-muted-foreground">
            Every package the live catalog reports, with its real availability -- discovered, never hand-listed.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void load()
          }}
          disabled={loading}
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && !catalog ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-8 animate-spin mb-3" />
          <p className="text-sm">Loading the live integration catalog...</p>
        </div>
      ) : !catalog || (catalog.liveCatalogState !== 'ready' && catalog.liveCatalogState !== 'empty') ? (
        <BlockedState
          status="unavailable"
          reason={catalog?.liveCatalogReason ?? 'The live integration catalog could not be reached.'}
        />
      ) : (
        <>
          {catalog.descriptorCatalogState !== 'ready' && catalog.descriptorCatalogState !== 'empty' && (
            <BlockedState
              status="not_configured"
              reason={catalog.descriptorCatalogReason ?? 'Descriptor catalog unavailable.'}
            />
          )}

          <div className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
              }}
              placeholder="Filter by package or title..."
              aria-label="Filter integrations"
              className="h-8 max-w-sm text-sm"
            />
            <span className="text-xs text-muted-foreground">
              {filteredItems.length} of {catalog.items.length}
            </span>
          </div>

          {catalog.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <Package className="size-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm">No packages were reported by the live catalog.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => (
                <Card
                  key={item.packageId}
                  data-testid={`integration-card-${item.packageId}`}
                  className={`border-border/40 bg-card/60 cursor-pointer transition-colors hover:border-primary/60 ${
                    selectedId === item.packageId ? 'border-primary' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedId(item.packageId)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedId(item.packageId)
                    }
                  }}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold truncate" title={item.packageId}>
                      {item.descriptor?.title ?? item.packageId}
                    </CardTitle>
                    <CardDescription className="text-xs font-mono truncate">{item.packageId}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="outline" className={`text-[10px] uppercase ${STATUS_BADGE_CLASSES[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <Card className="border-border/40 bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <div>
              <CardTitle className="text-sm font-bold">{selected.descriptor?.title ?? selected.packageId}</CardTitle>
              <CardDescription className="text-xs font-mono">{selected.packageId}</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedId(null)
              }}
            >
              Close
            </Button>
          </CardHeader>
          <CardContent>
            {selected.status === 'available' || selected.status === 'degraded' ? (
              <div className="space-y-4">
                {selected.status === 'degraded' && selected.reason && (
                  <BlockedState status="degraded" reason={selected.reason} />
                )}
                <MetricCards
                  observedAt={catalog?.observedAt ?? null}
                  metrics={[
                    { id: 'version', label: 'Package version', value: selected.descriptor?.packageVersion ?? null },
                    {
                      id: 'read-models',
                      label: 'Read models',
                      value: selected.descriptor?.readModelIds.length ?? null,
                    },
                    { id: 'actions', label: 'Governed actions', value: selected.descriptor?.actionIds.length ?? null },
                  ]}
                />
              </div>
            ) : (
              <BlockedState
                status={selected.status}
                reason={selected.reason ?? 'This integration is not available.'}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
