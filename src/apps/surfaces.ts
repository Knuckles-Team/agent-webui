/**
 * @file surfaces.ts
 * @description Every hosted {@link AppSurface}, and the Atlas hook that
 * registers their renderers.
 */
import type { AppSurface } from '@/lib/apps/contract'
import { rendererRegistry } from '@/lib/atlas/renderers'
import { marketsSurface } from './markets/surface'

export const APP_SURFACES: readonly AppSurface[] = [marketsSurface]

/** Idempotent: registration is keyed by renderer id. */
export function registerAppRenderers(): void {
  rendererRegistry.registerAll(APP_SURFACES.flatMap((surface) => surface.atlasRenderers))
}
