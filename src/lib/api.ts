/**
 * @file api.ts
 * @description Centralized API client for the Agent Web UI.
 *
 * Provides a standardized wrapper around the Fetch API for interacting with
 * the agent backend. Includes typing for request/response cycles and
 * uniform error handling via the ApiError class.
 */

import type { SavedWorkflow, WorkflowCapabilities, WorkflowCanvas, WorkflowRunResult } from './workflow'

/** Body accepted by `POST /workflows`. */
export interface SaveWorkflowPayload {
  name: string
  steps: string[]
  orchestrates: string[]
  canvas?: WorkflowCanvas
}

/**
 * Custom error class for API-related failures
 */
export class ApiError extends Error {
  /** HTTP status code */
  public status: number
  /** Raw response body text */
  public body: string

  /**
   * @param status - HTTP response status code
   * @param body - Diagnostic message or raw body content from the server
   */
  constructor(status: number, body: string) {
    super(`API ${status}: ${body}`)
    this.status = status
    this.body = body
    this.name = 'ApiError'
  }
}

/**
 * Internal API client implementation
 */
class ApiClient {
  private baseUrl: string

  /**
   * @param baseUrl - The base URL for all requests (defaults to local origin)
   */
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl
  }

  /**
   * Performs a GET request and returns the parsed JSON response
   */
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`)
    if (!res.ok) {
      const body = await res.text().catch(() => 'Unknown error')
      throw new ApiError(res.status, body)
    }
    return res.json() as Promise<T>
  }

  /**
   * Performs a POST request with JSON body and returns the parsed JSON response
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error')
      throw new ApiError(res.status, text)
    }
    return res.json() as Promise<T>
  }

  /**
   * Performs a DELETE request
   */
  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.text().catch(() => 'Unknown error')
      throw new ApiError(res.status, body)
    }
  }

  // SDD Methods
  getConstitution = () => this.get<any>('/api/enhanced/sdd/constitution')
  saveConstitution = (data: any) => this.post<any>('/api/enhanced/sdd/constitution', data)
  listSpecs = () => this.get<any[]>('/api/enhanced/sdd/specs')
  createSpec = (data: any) => this.post<any>('/api/enhanced/sdd/spec', data)
  listPlans = () => this.get<any[]>('/api/enhanced/sdd/plans')
  getTasks = (planId: string) => this.get<{ tasks: any[] }>(`/api/enhanced/sdd/tasks?plan_id=${planId}`)
  syncSDDToMemory = (data: any) => this.post<any>('/api/enhanced/sdd/sync', data)

  // Memory Methods
  getGraphNodes = (type?: string) => this.get<any[]>(`/api/enhanced/graph/nodes${type ? `?node_type=${type}` : ''}`)
  addMemory = (data: any) => this.post<any>('/api/enhanced/graph/memory', data)
  updateMemory = (id: string, data: any) => this.post<any>(`/api/enhanced/graph/memory/${id}`, data) // Using POST for update based on test mock or component? Actually component uses PUT.
  deleteMemory = (id: string) => this.delete(`/api/enhanced/graph/memory/${id}`)

  // Knowledge Base Methods
  listKnowledgeBases = () => this.get<any[]>('/api/enhanced/kb')
  searchKnowledgeBase = (id: string, query: string) => this.get<any[]>(`/api/enhanced/kb/${id}/search?q=${query}`)
  getKBArticle = (kbId: string, articleId: string) => this.get<any>(`/api/enhanced/kb/${kbId}/article/${articleId}`)
  ingestKnowledgeBase = (data: any) => this.post<any>('/api/enhanced/kb/ingest', data)
  runKBHealthCheck = (id: string) => this.get<any>(`/api/enhanced/kb/${id}/health`)

  // Graph Methods
  getGraphStats = () => this.get<any>('/api/enhanced/graph/stats')
  getGraphRelationships = () => this.get<any[]>('/api/enhanced/graph/relationships')

  // Workflow Editor Methods (D9 — visual workflow editor)
  listWorkflowCapabilities = () => this.get<WorkflowCapabilities>('/api/enhanced/workflows/capabilities')
  listWorkflows = () => this.get<SavedWorkflow[]>('/api/enhanced/workflows')
  saveWorkflow = (payload: SaveWorkflowPayload) =>
    this.post<{ id: string; saved: boolean }>('/api/enhanced/workflows', payload)
  runWorkflow = (id: string) => this.post<WorkflowRunResult>(`/api/enhanced/workflows/${encodeURIComponent(id)}/run`)
}

/**
 * Singleton API client instance for application-wide use
 */
export const api = new ApiClient()
