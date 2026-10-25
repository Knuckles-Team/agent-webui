import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api-validation'
import {
  readGraphNodes,
  readGraphRelationships,
  readGraphStats,
  readGraphNodeTypes,
  type GraphNode,
  type GraphRelationship,
  type GraphStats,
} from './graph-read'
import type { NodeTypeBreakdownData } from './NodeTypeBreakdown'

interface GraphSnapshot {
  binding: string | null
  nodes: GraphNode[]
  relationships: GraphRelationship[]
  stats: GraphStats | null
  breakdown: NodeTypeBreakdownData | null
  pending: string[]
  failed: string[]
  denied: boolean
}
const empty = (): GraphSnapshot => ({
  binding: null,
  nodes: [],
  relationships: [],
  stats: null,
  breakdown: null,
  pending: [],
  failed: [],
  denied: false,
})

/** A request generation owns all four reads, and any denial retires that entire generation. */
export function useExploreGraph(active: boolean, type: string | null) {
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<GraphSnapshot>(empty)
  const generation = useRef(0)
  const binding = JSON.stringify([type, revision])
  useEffect(() => {
    const request = ++generation.current
    const abort = new AbortController()
    setSnapshot(active ? { ...empty(), binding, pending: ['nodes', 'relationships', 'stats', 'breakdown'] } : empty())
    if (!active)
      return () => {
        abort.abort()
      }
    const current = () => generation.current === request && !abort.signal.aborted
    const receive = async <K extends 'nodes' | 'relationships' | 'stats' | 'breakdown'>(
      key: K,
      read: () => Promise<GraphSnapshot[K]>,
    ) => {
      try {
        const value = await read()
        if (current()) setSnapshot((previous) => ({ ...previous, [key]: value }))
      } catch (error) {
        if (!current()) return
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          // Do not wait for slower successful siblings before withdrawing protected data.
          ++generation.current
          abort.abort()
          setSnapshot({ ...empty(), binding, denied: true })
          return
        }
        setSnapshot((previous) => ({ ...previous, failed: [...previous.failed, key] }))
      } finally {
        if (current()) setSnapshot((previous) => ({ ...previous, pending: previous.pending.filter((v) => v !== key) }))
      }
    }
    void receive('nodes', () => readGraphNodes(type, abort.signal))
    void receive('relationships', () => readGraphRelationships(abort.signal))
    void receive('stats', () => readGraphStats(abort.signal))
    void receive('breakdown', () => readGraphNodeTypes(abort.signal))
    return () => {
      abort.abort()
    }
  }, [active, type, binding])
  const token = generation.current
  return {
    ...(active && snapshot.binding === binding
      ? snapshot
      : { ...empty(), pending: active ? ['nodes', 'relationships', 'stats', 'breakdown'] : [] }),
    isCurrent: () => generation.current === token,
    refresh: () => {
      // Withdraw old data synchronously, before the next request effect runs.
      ++generation.current
      setSnapshot({ ...empty(), pending: ['nodes', 'relationships', 'stats', 'breakdown'] })
      setRevision((previous) => previous + 1)
    },
  }
}
