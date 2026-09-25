/**
 * @file routes.ts
 * @description The Markets app's pages. `APP_ROUTES` is merged into the one
 * route registry (`src/lib/nav-registry.ts`) and read by the static SPA-route
 * bridge (`scripts/site-route-registry.mjs`), so these literals are the only
 * place Markets pages are declared.
 */
import { lazy } from 'react'
import { CandlestickChart, Share2, TrendingUp } from 'lucide-react'
import type { RouteDef } from '@/lib/nav-registry'

export const APP_ROUTES: readonly RouteDef[] = [
  {
    id: 'apps.markets',
    path: '/apps/markets',
    label: 'Markets',
    section: 'apps',
    blurb: 'See which markets are trending up or down, when each one flipped, and scan thousands at once.',
    icon: TrendingUp,
    minRole: 'user',
    capability: 'app:markets',
    mobile: 'adapted',
    element: lazy(() => import('./components/MarketsHome')),
  },
  {
    id: 'apps.markets.chart',
    path: '/apps/markets/chart/:listing',
    label: 'Market chart',
    section: 'apps',
    navigation: 'deep-link',
    blurb: 'Chart one market with its trend line, flips, volume and indicators.',
    icon: CandlestickChart,
    minRole: 'user',
    capability: 'app:markets',
    mobile: 'adapted',
    element: lazy(() => import('./components/ChartPage')),
  },
  {
    id: 'apps.markets.share',
    path: '/apps/markets/share/:lease',
    label: 'Shared analysis',
    section: 'apps',
    navigation: 'deep-link',
    blurb: 'Open an analysis someone shared, exactly as it was when they shared it.',
    icon: Share2,
    minRole: 'user',
    capability: 'app:markets',
    mobile: 'full',
    element: lazy(() => import('./components/SharePage')),
  },
]
