/**
 * @file SymbolSearch.tsx
 * @description Cross-venue symbol search: one ticker across every venue that
 * lists it, narrowed by asset-class chips. The list is a listbox driven from
 * the input (arrow keys move, Enter opens), so it works without a pointer.
 */
import { useDeferredValue, useId, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { searchListings } from '../api'
import type { AssetClass, MarketListing } from '../schemas'
import { Chips } from './Chips'
import { RequestFailed } from './Availability'

const TYPES = [
  { value: 'all', label: 'All' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'stock', label: 'Stocks' },
  { value: 'etf', label: 'Funds' },
  { value: 'commodity', label: 'Commodities' },
  { value: 'forex', label: 'Forex' },
  { value: 'index', label: 'Indices' },
] as const
type TypeChip = (typeof TYPES)[number]['value']

const STEP = new Map([
  ['ArrowDown', 1],
  ['ArrowUp', -1],
])

function ResultRow({
  listing,
  active,
  id,
  onPick,
}: {
  listing: MarketListing
  active: boolean
  id: string
  onPick: () => void
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm', active && 'bg-accent')}
    >
      <span>
        <span className="font-semibold">{listing.symbol}</span>
        {listing.quote && <span className="text-muted-foreground"> / {listing.quote}</span>}
        <span className="ml-2 text-xs text-muted-foreground">{listing.name}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {listing.listing_type} {listing.asset_class} ·{' '}
        <span className="font-medium text-foreground">{listing.venue}</span>
      </span>
    </li>
  )
}

export function SymbolSearch({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (listing: MarketListing) => void
}) {
  const [text, setText] = useState('')
  const [type, setType] = useState<TypeChip>('all')
  const [active, setActive] = useState(0)
  const query = useDeferredValue(text.trim())
  const listId = useId()
  const assetClass: AssetClass | null = type === 'all' ? null : type
  const results = useQuery({
    queryKey: ['markets', 'search', query, assetClass],
    queryFn: () => searchListings(query, assetClass),
    enabled: open,
  })
  const listings = results.data?.listings ?? []
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = STEP.get(event.key)
    if (step !== undefined) {
      event.preventDefault()
      setActive((current) => Math.max(0, Math.min(listings.length - 1, current + step)))
    } else if (event.key === 'Enter' && active < listings.length) {
      event.preventDefault()
      onPick(listings[active])
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Symbol search</DialogTitle>
          <DialogDescription>
            One symbol can trade on many venues and against many quotes; pick the listing.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 rounded-md border border-border/60 px-3">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <input
            role="combobox"
            aria-expanded={listings.length > 0}
            aria-controls={listId}
            aria-activedescendant={active < listings.length ? `${listId}-${active}` : undefined}
            aria-label="Symbol, name or venue"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="h-10 w-full bg-transparent text-sm outline-none"
          />
        </label>
        <Chips
          label="Asset type"
          options={TYPES}
          selected={new Set([type])}
          onToggle={(value) => {
            setType(value)
          }}
        />
        {results.isError && <RequestFailed what="Listings" error={results.error} />}
        <ul
          id={listId}
          role="listbox"
          aria-label="Listings"
          className="max-h-80 overflow-y-auto rounded-md border border-border/40"
        >
          {listings.map((listing, index) => (
            <ResultRow
              key={listing.listing_id}
              listing={listing}
              active={index === active}
              id={`${listId}-${index}`}
              onPick={() => {
                onPick(listing)
              }}
            />
          ))}
          {results.isSuccess && listings.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No listing matches.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
