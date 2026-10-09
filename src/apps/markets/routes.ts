/**
 * @file routes.ts
 * @description The Markets app's pages. `APP_ROUTES` is merged into the one
 * route registry (`src/lib/nav-registry.ts`) and read by the static SPA-route
 * bridge (`scripts/site-route-registry.mjs`), so these literals are the only
 * place Markets pages are declared.
 */
import { lazy } from 'react'
import { CalendarDays, CandlestickChart, Menu as MenuIcon, Newspaper, Share2, TrendingUp, Wallet } from 'lucide-react'
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
    id: 'apps.markets.news',
    path: '/apps/markets/news',
    label: 'Markets: News',
    section: 'apps',
    navigation: 'deep-link',
    blurb: 'The Markets News destination (not available until a source is certified).',
    icon: Newspaper,
    minRole: 'user',
    capability: 'app:markets',
    mobile: 'adapted',
    element: lazy(() => import('./components/MarketsNews')),
  },
  {
    id: 'apps.markets.calendar',
    path: '/apps/markets/calendar',
    label: 'Markets: Calendar',
    section: 'apps',
    navigation: 'deep-link',
    blurb: 'Documented macro events with their public source.',
    icon: CalendarDays,
    minRole: 'user',
    capability: 'app:markets',
    mobile: 'adapted',
    element: lazy(() => import('./components/MarketsCalendar')),
  },
  {
    id: 'apps.markets.portfolio',
    path: '/apps/markets/portfolio',
    label: 'Markets: Portfolio',
    section: 'apps',
    navigation: 'deep-link',
    blurb: 'The Markets Portfolio destination (not available until an account provider is connected).',
    icon: Wallet,
    minRole: 'user',
    capability: 'app:markets',
    mobile: 'adapted',
    element: lazy(() => import('./components/MarketsPortfolio')),
  },
  {
    id: 'apps.markets.menu',
    path: '/apps/markets/menu',
    label: 'Markets: Menu',
    section: 'apps',
    navigation: 'deep-link',
    blurb: 'What Markets is, and the notices every page carries.',
    icon: MenuIcon,
    minRole: 'user',
    capability: 'app:markets',
    mobile: 'adapted',
    element: lazy(() => import('./components/MarketsMenu')),
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
