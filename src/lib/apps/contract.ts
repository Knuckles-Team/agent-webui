/**
 * @file contract.ts
 * @description The AppSurface contract (EH-429): what a hosted application
 * declares so the shell can place it without app-specific wiring.
 *
 * An app is a product area (Markets is the first) living under `/apps/<id>`
 * in the browser and `/api/apps/<id>` on the host. Its surface names:
 *
 * - `routes`: its pages, declared as ordinary {@link RouteDef}s in the app's own
 *   `routes.ts` (`APP_ROUTES`) and merged into the one route registry, so the
 *   sidebar, router, role gate, SPA manifest and WebMCP navigation all see them;
 * - `capability`: the id the host's `/api/apps` catalog reports availability for;
 *   the sidebar hides an app the engine cannot serve and its pages say why;
 * - `webmcpPageIds`: the pages its browser tools bind to (tools register only
 *   while one of them is mounted, like Atlas's);
 * - `atlasRenderers`: renderers it contributes to Atlas, keyed on result shape;
 * - `client`: its typed API client module (documentation of the one data path).
 *
 * Names shown to people come from the app-name configuration, never a
 * hard-coded product name, so a rebrand is a configuration change.
 */
import type { LucideIcon } from 'lucide-react'
import type { AtlasRenderer } from '@/lib/atlas/renderers'
import type { RouteDef } from '@/lib/nav-registry'

/** Namespace of every app's WebMCP tools: `<namespace>.<app>.<tool>`. */
export const APP_TOOL_NAMESPACE = 'agent-webui.apps'

export interface AppSurface {
  readonly id: string
  readonly label: string
  readonly blurb: string
  readonly icon: LucideIcon
  readonly routes: readonly RouteDef[]
  readonly capability: string
  readonly webmcpPageIds: readonly string[]
  readonly atlasRenderers: readonly AtlasRenderer[]
  /** Module path of the app's typed client, e.g. `src/apps/markets/api.ts`. */
  readonly client: string
}

/** The capability id an app's routes carry: `app:<id>`. */
export function appCapability(appId: string): string {
  return `app:${appId}`
}

/** The fully qualified WebMCP tool name for one of an app's tools. */
export function appToolName(appId: string, tool: string): string {
  return `${APP_TOOL_NAMESPACE}.${appId}.${tool}`
}

/** Structural checks every registered surface must pass (used by tests and at load). */
export function surfaceProblems(surface: AppSurface): string[] {
  const problems: string[] = []
  const base = `/apps/${surface.id}`
  for (const route of surface.routes) {
    if (route.section !== 'apps') problems.push(`${route.id} is not in the apps section`)
    if (route.path !== base && !route.path.startsWith(`${base}/`)) problems.push(`${route.id} is outside ${base}`)
    if (route.capability !== surface.capability) problems.push(`${route.id} does not carry ${surface.capability}`)
  }
  const pageIds = new Set(surface.routes.map((route) => route.page?.webmcpPageId ?? route.id))
  for (const pageId of surface.webmcpPageIds) {
    if (!pageIds.has(pageId)) problems.push(`WebMCP page ${pageId} is not one of the app's routes`)
  }
  return problems
}
