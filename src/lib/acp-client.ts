/**
 * ACP Client for agent-webui.
 * Implements the ACP protocol over HTTP/SSE for the web.
 */

export interface AcpEvent {
  type: string
  [key: string]: unknown
}

export class AcpWebClient {
  private baseUrl: string
  private sessionId: string | null = null

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async createSession(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/acp/sessions`, {
      method: 'POST',
    })
    const data = (await res.json()) as { session_id: string }
    this.sessionId = data.session_id
    return data.session_id
  }

  async sendRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.sessionId) await this.createSession()

    const res = await fetch(`${this.baseUrl}/acp/rpc/${this.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now(),
      }),
    })
    return res.json()
  }

  async *streamEvents(): AsyncIterableIterator<AcpEvent> {
    if (!this.sessionId) await this.createSession()

    const response = await fetch(`${this.baseUrl}/acp/stream/${this.sessionId}`)
    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6))
          } catch (e) {
            console.error('Failed to parse ACP event:', e)
          }
        }
      }
    }
  }
}

export const acpClient = new AcpWebClient()
