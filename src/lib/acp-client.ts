/**
 * ACP Provider for agent-webui using @mcpc-tech/acp-ai-provider.
 * Standardizes communication with the Pydantic AI agent via the native ACP protocol.
 */

import { createACP } from '@mcpc-tech/acp-ai-provider'

/**
 * Creates a standardized ACP provider instance.
 *
 * @param baseUrl - The base URL of the agent server (e.g., http://localhost:8000).
 *                  The /acp mount point is automatically appended if not present.
 */
export function createAgentProvider(baseUrl = '') {
  const acpBaseUrl = baseUrl.replace(/\/$/, '') + '/acp'

  return createACP({
    baseUrl: acpBaseUrl,
    // Add any global headers or security tokens here
    headers: {
      'X-Agent-WebUI': 'true',
    },
  })
}

// Export a default provider for general use, assuming current origin if not specified
export const agentProvider = createAgentProvider(typeof window !== 'undefined' ? window.location.origin : '')
