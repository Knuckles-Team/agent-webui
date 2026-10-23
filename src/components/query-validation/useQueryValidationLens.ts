import { useLayoutEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
export type Mode = 'sparql' | 'shacl'
export type Pane = 'editor' | 'results' | 'both'
export type SparqlBindingRow = Record<string, { value: unknown } | undefined>
export interface SubmittedInput {
  text: string
  sourceType?: string
}
const DEFAULT_SPARQL = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25'
type RequestOwner = ReturnType<typeof useRequestOwner>
function useRequestOwner() {
  const state = useRef({ active: true, sparql: null as symbol | null, shacl: null as symbol | null })
  useLayoutEffect(() => {
    state.current.active = true
    return () => {
      state.current = { active: false, sparql: null, shacl: null }
    }
  }, [])
  return {
    claim(mode: Mode) {
      if (!state.current.active || state.current[mode]) return null
      const token = Symbol(mode)
      state.current[mode] = token
      return token
    },
    owns(mode: Mode, token: symbol) {
      return state.current.active && state.current[mode] === token
    },
    release(mode: Mode, token: symbol) {
      if (state.current[mode] === token) state.current[mode] = null
    },
  }
}

async function completeOwned<T>(
  owner: RequestOwner,
  mode: Mode,
  token: symbol,
  request: () => Promise<T>,
  success: (value: T) => void,
  failure: (error: unknown) => void,
  finish: () => void,
) {
  try {
    const value = await request()
    if (owner.owns(mode, token)) success(value)
  } catch (error) {
    if (owner.owns(mode, token)) failure(error)
  } finally {
    if (owner.owns(mode, token)) {
      finish()
      owner.release(mode, token)
    }
  }
}

export function useQueryValidationLens() {
  const owner = useRequestOwner()
  const [mode, setMode] = useState<Mode>('sparql')
  const [pane, setPane] = useState<Pane>('both')
  const [sparqlCompleted, setSparqlCompleted] = useState(false)
  const [sparqlSubmitted, setSparqlSubmitted] = useState<SubmittedInput | null>(null)
  const [sparqlPending, setSparqlPending] = useState<SubmittedInput | null>(null)
  const [shaclSubmitted, setShaclSubmitted] = useState<SubmittedInput | null>(null)
  const [shaclPending, setShaclPending] = useState<SubmittedInput | null>(null)

  // SPARQL tab state
  const [sparqlQuery, setSparqlQuery] = useState(DEFAULT_SPARQL)
  const [sparqlRunning, setSparqlRunning] = useState(false)
  const [sparqlError, setSparqlError] = useState<string | null>(null)
  const [sparqlVars, setSparqlVars] = useState<string[]>([])
  const [sparqlBindings, setSparqlBindings] = useState<SparqlBindingRow[]>([])

  // SHACL tab state
  const [shaclSource, setShaclSource] = useState('')
  const [shaclSourceType, setShaclSourceType] = useState<'text' | 'file' | 'url' | 'auto'>('text')
  const [shaclRunning, setShaclRunning] = useState(false)
  const [shaclError, setShaclError] = useState<string | null>(null)
  const [shaclResult, setShaclResult] = useState<Awaited<ReturnType<typeof api.validateOntologyCandidate>> | null>(
    null,
  )

  // Update only after commit: retained callbacks never read abandoned render drafts.
  const input = useRef({ sparqlQuery, shaclSource, shaclSourceType })
  useLayoutEffect(() => {
    input.current = { sparqlQuery, shaclSource, shaclSourceType }
  }, [sparqlQuery, shaclSource, shaclSourceType])

  const receiveSparql = (res: Awaited<ReturnType<typeof api.runSparqlQuery>>) => {
    if (res.status !== 'success') {
      setSparqlError(res.message ?? 'SPARQL query failed')
      setSparqlVars([])
      setSparqlBindings([])
      return
    }
    setSparqlError(null)
    setSparqlVars(res.head?.vars ?? [])
    setSparqlBindings(res.results?.bindings ?? [])
  }

  const runSparql = async () => {
    const q = input.current.sparqlQuery.trim()
    if (!q) return
    const token = owner.claim('sparql')
    if (!token) return
    const submitted = { text: q }
    setSparqlPending(submitted)
    setSparqlRunning(true)
    await completeOwned(
      owner,
      'sparql',
      token,
      () => api.runSparqlQuery(q),
      receiveSparql,
      (err) => {
        setSparqlError(err instanceof ApiError ? err.message : String(err))
        setSparqlVars([])
        setSparqlBindings([])
      },
      () => {
        setSparqlSubmitted(submitted)
        setSparqlPending(null)
        setSparqlCompleted(true)
        setSparqlRunning(false)
      },
    )
  }

  const runValidate = async () => {
    const source = input.current.shaclSource.trim()
    if (!source) return
    const token = owner.claim('shacl')
    if (!token) return
    const sourceType = input.current.shaclSourceType
    const submitted = { text: source, sourceType }
    setShaclPending(submitted)
    setShaclRunning(true)
    await completeOwned(
      owner,
      'shacl',
      token,
      () => api.validateOntologyCandidate({ source, source_type: sourceType }),
      (result) => {
        setShaclError(null)
        setShaclResult(result)
      },
      (err) => {
        setShaclError(err instanceof ApiError ? err.message : String(err))
        setShaclResult(null)
      },
      () => {
        setShaclSubmitted(submitted)
        setShaclPending(null)
        setShaclRunning(false)
      },
    )
  }

  const submission = {
    sparql: { draft: { text: sparqlQuery }, pending: sparqlPending, completed: sparqlSubmitted },
    shacl: {
      draft: { text: shaclSource, sourceType: shaclSourceType },
      pending: shaclPending,
      completed: shaclSubmitted,
    },
  }[mode]

  return {
    mode,
    setMode,
    pane,
    setPane,
    sparqlCompleted,
    sparqlQuery,
    setSparqlQuery,
    sparqlRunning,
    sparqlError,
    sparqlVars,
    sparqlBindings,
    shaclSource,
    setShaclSource,
    shaclSourceType,
    setShaclSourceType,
    shaclRunning,
    shaclError,
    shaclResult,
    runSparql,
    runValidate,
    submission,
  }
}
export type QueryValidationController = ReturnType<typeof useQueryValidationLens>
