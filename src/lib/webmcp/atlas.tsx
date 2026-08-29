/** Optional WebMCP bridge for the typed Atlas workbench seam. */
import { useMemo } from 'react'
import type { AtlasWorkbench } from '@/lib/atlas/useAtlas'
import { createAtlasTools } from './tools'
import { useWebMcpToolSet } from './provider'

export interface WebMcpAtlasRegistrarProps {
  atlas: AtlasWorkbench
}

/**
 * Mount inside Atlas only. This keeps explorer tools absent on unrelated pages
 * and gives them the exact reducer/selection callbacks the workbench already
 * owns; no DOM scraping or backend client is introduced.
 */
export function WebMcpAtlasRegistrar({ atlas }: WebMcpAtlasRegistrarProps): null {
  const tools = useMemo(() => {
    try {
      return createAtlasTools({ state: atlas.state, dispatch: atlas.dispatch, select: atlas.select })
    } catch {
      // A malformed internal snapshot must not break Atlas just because the
      // optional browser integration cannot publish it.
      return []
    }
  }, [atlas.dispatch, atlas.select, atlas.state])
  useWebMcpToolSet(tools)
  return null
}
