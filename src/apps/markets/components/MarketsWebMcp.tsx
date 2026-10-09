/**
 * @file MarketsWebMcp.tsx
 * @description Registers the Markets WebMCP tools while a Markets page is
 * mounted, bound to that page's own view-state callbacks (as Atlas does).
 */
import { useMemo } from 'react'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { createMarketsTools, type MarketsToolController } from '../webmcp'

export function MarketsWebMcp({ controller }: { controller: MarketsToolController }): null {
  const tools = useMemo(() => createMarketsTools(controller), [controller])
  useWebMcpToolSet(tools)
  return null
}
