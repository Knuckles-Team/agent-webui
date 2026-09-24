/**
 * @file surface.ts
 * @description The Markets {@link AppSurface} (EH-420 on the EH-429 contract).
 */
import { TrendingUp } from 'lucide-react'
import { appCapability, type AppSurface } from '@/lib/apps/contract'
import { ohlcAtlasRenderer } from './atlas-renderer'
import { APP_ROUTES } from './routes'

export const marketsSurface: AppSurface = {
  id: 'markets',
  label: 'Markets',
  blurb: 'Trend states, flips and a scanner across markets, computed by the engine. Informational only.',
  icon: TrendingUp,
  routes: APP_ROUTES,
  capability: appCapability('markets'),
  webmcpPageIds: ['apps.markets', 'apps.markets.chart'],
  atlasRenderers: [ohlcAtlasRenderer],
  client: 'src/apps/markets/api.ts',
}
