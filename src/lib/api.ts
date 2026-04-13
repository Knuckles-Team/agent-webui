/**
 * @file api.ts
 * @description Centralized API client for the Agent Web UI.
 *
 * Provides a standardized wrapper around the Fetch API for interacting with
 * the agent backend. Includes typing for request/response cycles and
 * uniform error handling via the ApiError class.
 */

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
}

/**
 * Singleton API client instance for application-wide use
 */
export const api = new ApiClient()
