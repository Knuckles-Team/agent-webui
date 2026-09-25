import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FilterBar } from '../FilterBar'
import type { AdapterCapabilities, FilterSet, SchemaNode } from '@/lib/atlas/types'

const fields: SchemaNode[] = [{ id: 'name', label: 'Name', kind: 'field', dataType: 'string' }]
const capabilities: AdapterCapabilities = {
  introspect: true,
  filters: ['eq'],
  freeTextSearch: false,
  sort: false,
  rawQuery: false,
  graphProjection: false,
  pivots: false,
  live: false,
}
const filters: FilterSet = {
  search: '',
  clauses: [
    { id: 'first', field: 'name', op: 'eq', value: 'Ada' },
    { id: 'second', field: 'name', op: 'eq', value: 'Grace' },
  ],
  combinator: 'and',
  sort: null,
  limit: 500,
}

describe('FilterBar', () => {
  it('names each clause and its controls distinctly, then removes the requested clause', async () => {
    const onChange = vi.fn()
    render(<FilterBar filters={filters} fields={fields} capabilities={capabilities} onChange={onChange} />)

    const first = screen.getByRole('group', { name: 'Filter 1' })
    const second = screen.getByRole('group', { name: 'Filter 2' })
    expect(within(first).getByRole('combobox', { name: 'Filter 1 field' })).toBeInTheDocument()
    expect(within(second).getByRole('combobox', { name: 'Filter 2 operator' })).toBeInTheDocument()
    expect(within(first).getByRole('textbox', { name: 'Filter 1 value' })).toHaveValue('Ada')
    expect(within(second).getByRole('textbox', { name: 'Filter 2 value' })).toHaveValue('Grace')

    await userEvent.setup().click(within(second).getByRole('button', { name: 'Remove filter 2' }))
    expect(onChange).toHaveBeenCalledWith({ ...filters, clauses: [filters.clauses[0]] })
  })
})
