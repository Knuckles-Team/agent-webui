/**
 * @file elevation.ts
 * @description Typed client for just-in-time access elevation.
 *
 * Request, list and revoke go through the shared `graph_elevation` action route
 * (the same service agents and chat use). Approval goes to the console-only
 * `/api/elevations/approve` route. No call here carries an identity: the
 * platform takes the requester and the approver from the signed-in session,
 * and the approval names only the elevation and the digest of the request the
 * operator reviewed.
 */

import { z } from 'zod'
import { api } from './api'

const elevationScopeSchema = z.object({
  graph: z.string(),
  action: z.enum(['read', 'write']),
})

const elevationSchema = z.object({
  elevation_id: z.string(),
  grantee: z.string(),
  status: z.string(),
  scopes: z.array(elevationScopeSchema),
  span_ms: z.number(),
  justification: z.string(),
  request_digest: z.string(),
  requested_at_ms: z.number(),
  revision: z.number(),
  approved_at_ms: z.number().nullable().optional(),
  hard_expires_at_ms: z.number().nullable().optional(),
  ended_at_ms: z.number().nullable().optional(),
  remaining_ms: z.number(),
  own: z.boolean(),
})

export type Elevation = z.infer<typeof elevationSchema>
type ElevationScope = z.infer<typeof elevationScopeSchema>

export interface ElevationAsk {
  scopes: ElevationScope[]
  span_ms: number
  justification: string
}

/** The longest window a request may ask for (the platform's hard cap). */
export const MAX_SPAN_MS = 24 * 60 * 60 * 1000

const ACTION_ROUTE = '/api/graph/elevation'
const listSchema = z.object({ status: z.literal('success'), result: z.array(elevationSchema) })
const oneSchema = z.object({ status: z.literal('success'), result: elevationSchema })
const approvedSchema = z.object({ status: z.literal('success'), elevation: elevationSchema })

export async function listElevations(): Promise<Elevation[]> {
  const body = { request: { action: 'list' } }
  return (await api.postValidated(ACTION_ROUTE, listSchema, body)).result
}

export async function requestElevation(ask: ElevationAsk): Promise<Elevation> {
  const body = { request: { action: 'request', ...ask } }
  return (await api.postValidated(ACTION_ROUTE, oneSchema, body)).result
}

export async function revokeElevation(elevationId: string): Promise<Elevation> {
  const body = { request: { action: 'revoke', elevation_id: elevationId } }
  return (await api.postValidated(ACTION_ROUTE, oneSchema, body)).result
}

/** Approve exactly the request the operator reviewed (its digest binds it). */
export async function approveElevation(
  elevation: Pick<Elevation, 'elevation_id' | 'request_digest'>,
): Promise<Elevation> {
  const body = { elevation_id: elevation.elevation_id, request_digest: elevation.request_digest }
  return (await api.postValidated('/api/elevations/approve', approvedSchema, body)).elevation
}

/** Whether the console may offer an approval: someone else's pending request. */
export function canApprove(elevation: Elevation): boolean {
  return elevation.status === 'requested' && !elevation.own
}

/** Whether the console may offer to end it now. */
export function canRevoke(elevation: Elevation): boolean {
  return elevation.status === 'requested' || elevation.status === 'active'
}

/** `H:MM:SS` for a countdown; `0:00:00` once expired. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
