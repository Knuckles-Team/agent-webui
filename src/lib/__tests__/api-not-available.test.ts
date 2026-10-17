import { describe, expect, it } from 'vitest'
import { ApiError, isNotAvailable } from '../api-validation'

const body = JSON.stringify({
  detail: {
    error: 'not_available',
    feature: 'Graph browser',
    needs_operation: 'graph.nodes.list',
    message: 'Graph browser is not available: Arbora does not serve the graph.nodes.list operation yet.',
  },
})

describe('ApiError not-available state', () => {
  it.each([
    [501, body, true],
    [501, '{"detail":"Not Implemented"}', false],
    [500, body, false],
    [501, 'not json', false],
  ])('status %i body %s -> %s', (status, raw, expected) => {
    const error = new ApiError(status, raw)
    expect(isNotAvailable(error)).toBe(expected)
  })

  it('uses the backend message as the error text', () => {
    const error = new ApiError(501, body)
    expect(error.message).toContain('Graph browser is not available')
    expect(error.notAvailable?.operation).toBe('graph.nodes.list')
  })
})
