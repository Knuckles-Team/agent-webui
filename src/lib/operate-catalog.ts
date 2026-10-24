import { z } from 'zod'
import { fetchValidated } from '@/lib/api-validation'

// Arbora v0.1.7 EnhancedCatalog: registration availability is not connectivity.
// Project only display fields; discard server URLs, errors and unrelated content.
const server = z.object({
  server_id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['available', 'unavailable']),
  tool_count: z.number().int().nonnegative(),
})
export const OperateCatalogSchema = z
  .object({
    source: z.literal('epistemic_graph'),
    servers: z.array(server),
  })
  .refine(({ servers }) => new Set(servers.map((item) => item.server_id)).size === servers.length, {
    message: 'Duplicate catalog server identity',
  })
export function readOperateCatalog(signal?: AbortSignal) {
  return fetchValidated('/api/enhanced/tools', OperateCatalogSchema, {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
  })
}
