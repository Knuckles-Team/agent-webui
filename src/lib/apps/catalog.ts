/**
 * @file catalog.ts
 * @description Typed client for the host's `/api/apps` catalog: which hosted
 * apps the engine can serve right now, and why not when it cannot.
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchValidated } from '@/lib/api-validation'
import { appCapability } from './contract'

export const appCatalogSchema = z.object({
  apps: z.array(
    z.object({
      id: z.string(),
      available: z.boolean(),
      detail: z.string().nullable(),
    }),
  ),
})

export type AppCatalog = z.infer<typeof appCatalogSchema>

export function fetchAppCatalog(): Promise<AppCatalog> {
  return fetchValidated('/api/apps', appCatalogSchema)
}

export interface AppAvailability {
  loading: boolean
  /** Capability ids (`app:<id>`) the host reports available. */
  available: ReadonlySet<string>
  /** Why an app is unavailable, by capability id. */
  reasons: ReadonlyMap<string, string>
}

function toAvailability(catalog: AppCatalog | undefined, loading: boolean): AppAvailability {
  const available = new Set<string>()
  const reasons = new Map<string, string>()
  for (const app of catalog?.apps ?? []) {
    const capability = appCapability(app.id)
    if (app.available) available.add(capability)
    else reasons.set(capability, app.detail ?? 'This app is not available on this deployment.')
  }
  return { loading, available, reasons }
}

/** The app catalog through React Query; refreshed every minute. */
export function useAppAvailability(): AppAvailability {
  const query = useQuery({ queryKey: ['apps', 'catalog'], queryFn: fetchAppCatalog, staleTime: 60_000 })
  return toAvailability(query.data, query.isLoading)
}

/** A route with no capability is always shown; one with a capability only once reported available. */
export function capabilityVisible(capability: string | undefined, availability: AppAvailability): boolean {
  return capability === undefined || availability.available.has(capability)
}
