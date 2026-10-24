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
const component = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['tool', 'skill', 'workflow']),
    description: z.string(),
    status: z.enum(['active', 'retired', 'withdrawn']),
    authority: z.enum(['agent_component', 'workflow_catalog']),
    server_name: z.string().nullable().optional(),
    revision: z.number().int().nullable().optional(),
    definition_digest: z.string().nullable().optional(),
    content_digest: z.string().nullable().optional(),
  })
  .refine((entry) => (entry.kind === 'workflow') === (entry.authority === 'workflow_catalog'), {
    message: 'Catalog kind and authority disagree',
  })
export type OperateComponent = z.infer<typeof component>
export const OperateCatalogSchema = z
  .object({
    source: z.literal('epistemic_graph'),
    servers: z.array(server),
    components: z.array(component),
  })
  .refine(({ servers }) => new Set(servers.map((item) => item.server_id)).size === servers.length, {
    message: 'Duplicate catalog server identity',
  })
  .refine(({ servers }) => new Set(servers.map((item) => item.name)).size === servers.length, {
    message: 'Ambiguous catalog server name',
  })
  .refine(({ components }) => new Set(components.map((item) => item.id)).size === components.length, {
    message: 'Duplicate catalog component identity',
  })
export function readOperateCatalog(signal?: AbortSignal) {
  return fetchValidated('/api/enhanced/tools', OperateCatalogSchema, {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
  })
}
