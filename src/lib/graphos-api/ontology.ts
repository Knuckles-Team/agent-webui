/**
 * Browser adapter for the Graph OS ontology operation registry.
 *
 * WEBUI-API-R002.1: typed model plus validation and refusal tests for the
 * ontology operation family. Graph, Atlas and object-set families follow in
 * later slices; the entry point that swaps `api_extensions.py`'s ontology
 * routes to call this adapter is WEBUI-API-R002.2.
 */
import { z } from 'zod'
import { ApiShapeError } from '@/lib/api-validation'
import { GraphOsApiError, invoke } from './invoke'

export type OntologyOp = 'ontology.classes.list' | 'ontology.classes.get' | 'ontology.properties.list'

export type OntologyReply<T> =
  { kind: 'ready'; result: T } | { kind: 'unavailable' | 'forbidden' | 'error'; message: string }

const classSchema = z
  .object({
    class_id: z.string().min(1),
    label: z.string(),
    parent_class_id: z.string().nullable().optional(),
  })
  .loose()
const classPageSchema = z
  .object({ items: z.array(classSchema), next_cursor: z.string().nullable().optional() })
  .loose()
const propertySchema = z
  .object({ property_id: z.string().min(1), label: z.string(), domain_class_id: z.string() })
  .loose()
const propertyPageSchema = z
  .object({ items: z.array(propertySchema), next_cursor: z.string().nullable().optional() })
  .loose()

const readOps = new Set<OntologyOp>(['ontology.classes.list', 'ontology.classes.get', 'ontology.properties.list'])

function resultSchema(op: OntologyOp): z.ZodType {
  if (op === 'ontology.classes.get') return classSchema
  if (op === 'ontology.properties.list') return propertyPageSchema
  return classPageSchema
}

function refusal(error: GraphOsApiError): OntologyReply<never> {
  if ([404, 501, 503].includes(error.status) || ['UNKNOWN_OP', 'UNAVAILABLE', 'NOT_IMPLEMENTED'].includes(error.code))
    return { kind: 'unavailable', message: 'This ontology operation is not available on this server.' }
  if ([401, 403].includes(error.status) || ['SURFACE_NOT_ALLOWED', 'SCOPE_REQUIRED'].includes(error.code))
    return { kind: 'forbidden', message: 'This operation requires an authorized ontology scope.' }
  return { kind: 'error', message: 'The ontology service did not confirm the operation.' }
}

/** No URL, token, or tenant detail is reflected in a failed request. */
export async function invokeOntology<T>(
  op: OntologyOp,
  params: Record<string, unknown> = {},
): Promise<OntologyReply<T>> {
  try {
    const result = await invoke(
      op,
      params,
      resultSchema(op),
      readOps.has(op) ? {} : { idempotencyKey: crypto.randomUUID() },
    )
    return { kind: 'ready', result: result as T }
  } catch (error) {
    if (error instanceof GraphOsApiError) return refusal(error)
    if (error instanceof ApiShapeError)
      return { kind: 'error', message: 'The ontology service returned an invalid response.' }
    return { kind: 'unavailable', message: 'The ontology service could not be reached.' }
  }
}

export interface OntologyClass {
  class_id: string
  label: string
  parent_class_id?: string | null
}
