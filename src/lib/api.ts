/**
 * Centralized API client for agent-webui
 * Provides consistent error handling, typing, and a single place to add
 * auth headers, retry logic, or request/response interceptors.
 */

export class ApiError extends Error {
  public status: number
  public body: string

  constructor(status: number, body: string) {
    super(`API ${status}: ${body}`)
    this.status = status
    this.body = body
    this.name = 'ApiError'
  }
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`)
    if (!res.ok) {
      const body = await res.text().catch(() => 'Unknown error')
      throw new ApiError(res.status, body)
    }
    return res.json() as Promise<T>
  }

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

  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.text().catch(() => 'Unknown error')
      throw new ApiError(res.status, body)
    }
  }
}

/** Singleton API client instance */
export const api = new ApiClient()
