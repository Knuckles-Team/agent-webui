import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ResultRenderer, selectResultRenderer, unwrapCapabilityResult } from '../ResultRenderer'

describe('capability result renderer registry', () => {
  it('unwraps canonical execution envelopes', () => {
    expect(unwrapCapabilityResult({ status: 'success', result: { value: 42 } })).toEqual({ value: 42 })
  })

  it('selects graph, evidence, table, and JSON fallbacks by truthful payload shape', () => {
    expect(selectResultRenderer('graph', { nodes: [{ id: 'a' }], relationships: [] })).toBe('graph')
    expect(selectResultRenderer('evidence', { citations: [{ title: 'Primary source' }] })).toBe('evidence')
    expect(selectResultRenderer('table', { rows: [{ id: 1 }] })).toBe('table')
    expect(selectResultRenderer('timeseries', { value: 12 })).toBe('json')
  })

  it('renders a graph-friendly summary with raw payload access', () => {
    render(
      <ResultRenderer
        hint="graph"
        value={{
          nodes: [{ id: 'customer-1', name: 'Customer' }],
          edges: [{ source: 'customer-1', target: 'order-1' }],
        }}
      />,
    )
    expect(screen.getByText('Graph result')).toBeInTheDocument()
    expect(screen.getByText('1 nodes')).toBeInTheDocument()
    expect(screen.getByText('1 edges')).toBeInTheDocument()
    expect(screen.getByText('Customer')).toBeInTheDocument()
  })
})
