/**
 * @file index.ts
 * @description Every hosted app's routes, for the route registry. Kept free
 * of renderer and tool imports so the registry stays light; the full
 * {@link AppSurface} list lives in `surfaces.ts`.
 */
import type { RouteDef } from '@/lib/nav-registry'
import { APP_ROUTES as MARKETS_ROUTES } from './markets/routes'

export const APP_ROUTES: readonly RouteDef[] = [...MARKETS_ROUTES]
