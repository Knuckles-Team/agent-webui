import { describe, expect, it, vi } from 'vitest'
import { createMarketsTools, type MarketsToolController } from '../webmcp'
import { DEFAULT_FILTERS } from '../view-state'

const signal = new AbortController().signal

function controller(overrides: Partial<MarketsToolController> = {}): MarketsToolController {
  return {
    view: { page: 'overview', listingId: null, filters: DEFAULT_FILTERS, chart: null, visibleRows: 0 },
    setFilters: vi.fn(),
    openListing: vi.fn(),
    ...overrides,
  }
}

describe('Markets WebMCP tools', () => {
  it('are namespaced, validated and bound to the page that mounted them', () => {
    const names = createMarketsTools(controller()).map((tool) => tool.name)
    expect(names).toEqual([
      'graphos.apps.markets.get-view',
      'graphos.apps.markets.search-listings',
      'graphos.apps.markets.open-listing',
      'graphos.apps.markets.set-scanner-filters',
    ])
    expect(createMarketsTools(controller({ setFilters: undefined, setChart: vi.fn() })).at(-1)?.name).toBe(
      'graphos.apps.markets.set-chart',
    )
  })

  it('change local view state only, after strict validation', async () => {
    const control = controller()
    const setFilters = createMarketsTools(control).find((tool) => tool.name.endsWith('set-scanner-filters'))
    const filters = { ...DEFAULT_FILTERS, direction: 'bearish' }
    await expect(setFilters?.execute(filters, { signal })).resolves.toEqual({ updated: true })
    expect(control.setFilters).toHaveBeenCalledWith(filters)
    await expect(setFilters?.execute({ ...filters, direction: 'sideways' }, { signal })).rejects.toThrow()
    await expect(setFilters?.execute({ ...filters, order: 'buy' }, { signal })).rejects.toThrow()
  })

  it('refuse a listing id that is not one', async () => {
    const control = controller()
    const open = createMarketsTools(control).find((tool) => tool.name.endsWith('open-listing'))
    await expect(open?.execute({ listingId: '../../admin' }, { signal })).rejects.toThrow()
    await expect(open?.execute({ listingId: 'listing:binance:SOLUSDT:spot' }, { signal })).resolves.toEqual({
      updated: true,
    })
    expect(control.openListing).toHaveBeenCalledWith('listing:binance:SOLUSDT:spot')
  })

  it('declare read tools as reads and view changes as confirmed local mutations', () => {
    const tools = createMarketsTools(controller())
    const classes = Object.fromEntries(
      tools.map((tool) => [tool.name.split('.').at(-1), tool.capability?.mutationClass]),
    )
    expect(classes).toEqual({
      'get-view': 'read',
      'search-listings': 'read',
      'open-listing': 'local-ui-mutation',
      'set-scanner-filters': 'local-ui-mutation',
    })
  })
})
