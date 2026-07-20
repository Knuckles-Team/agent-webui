/**
 * @file mcpc.d.ts
 * @description Local type definitions for the MCPC ACP AI Provider.
 */

declare module '@mcpc-tech/acp-ai-provider' {
  export interface ACPOptions {
    baseUrl: string
    headers?: Record<string, string>
  }

  /**
   * Creates a standardized ACP provider instance.
   */
  export function createACP(options: ACPOptions): unknown
}
