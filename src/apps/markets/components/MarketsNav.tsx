/**
 * @file MarketsNav.tsx
 * @description Markets' five-destination navigation (FUI-01, FIN-UI-R001):
 * Markets, News, Calendar, Portfolio and Menu. One destination list and one
 * active-path check drive both a bottom bar on narrow viewports and a side
 * rail on desktop, so the selected destination and keyboard focus stay
 * coherent across layouts.
 */
import { CalendarDays, Menu as MenuIcon, Newspaper, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import { navigateInApp, useAppLocation } from '@/lib/apps/location'
import { cn } from '@/lib/utils'

interface Destination {
  id: string
  label: string
  path: string
  icon: LucideIcon
}

export const MARKETS_DESTINATIONS: readonly Destination[] = [
  { id: 'markets', label: 'Markets', path: '/apps/markets', icon: TrendingUp },
  { id: 'news', label: 'News', path: '/apps/markets/news', icon: Newspaper },
  { id: 'calendar', label: 'Calendar', path: '/apps/markets/calendar', icon: CalendarDays },
  { id: 'portfolio', label: 'Portfolio', path: '/apps/markets/portfolio', icon: Wallet },
  { id: 'menu', label: 'Menu', path: '/apps/markets/menu', icon: MenuIcon },
]

function isActiveDestination(pathname: string, destination: Destination): boolean {
  if (destination.path === '/apps/markets') return pathname === destination.path
  return pathname === destination.path || pathname.startsWith(`${destination.path}/`)
}

function DestinationButton({
  destination,
  active,
  orientation,
}: {
  destination: Destination
  active: boolean
  orientation: 'bottom' | 'rail'
}) {
  const Icon = destination.icon
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        navigateInApp(destination.path)
      }}
      className={cn(
        'flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        orientation === 'bottom' ? 'flex-1 flex-col gap-1 py-2 text-xs' : 'px-3 py-2 text-sm',
        active ? 'bg-primary/15 font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      <span>{destination.label}</span>
    </button>
  )
}

/** Renders both layouts; CSS breakpoints (`md:`) decide which one shows. */
export function MarketsNav() {
  const location = useAppLocation()
  const active = (destination: Destination) => isActiveDestination(location.pathname, destination)
  return (
    <>
      <nav
        aria-label="Markets"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border/60 bg-background/95 backdrop-blur md:hidden"
      >
        {MARKETS_DESTINATIONS.map((destination) => (
          <DestinationButton
            key={destination.id}
            destination={destination}
            active={active(destination)}
            orientation="bottom"
          />
        ))}
      </nav>
      <nav
        aria-label="Markets"
        className="sticky top-0 hidden h-fit flex-col gap-1 border-r border-border/60 pr-2 md:flex"
      >
        {MARKETS_DESTINATIONS.map((destination) => (
          <DestinationButton
            key={destination.id}
            destination={destination}
            active={active(destination)}
            orientation="rail"
          />
        ))}
      </nav>
    </>
  )
}
