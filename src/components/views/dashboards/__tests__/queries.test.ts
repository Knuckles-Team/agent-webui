import { describe, it, expect } from 'vitest'
import { adaptSeries, adaptLogs, adaptTraces, rangeBounds, TIME_RANGES } from '../queries'

describe('dashboards/queries adapters', () => {
  it('adaptSeries parses a Prometheus range response', () => {
    const raw = {
      data: {
        result: [
          {
            metric: { __name__: 'up', job: 'kg' },
            values: [
              [1000, '1'],
              [1060, '2.5'],
            ],
          },
        ],
      },
    }
    const series = adaptSeries(raw)
    expect(series).toHaveLength(1)
    expect(series[0].points).toHaveLength(2)
    expect(series[0].points[1].v).toBe(2.5)
  })

  it('adaptSeries parses a flat {series:[{label,points}]} response', () => {
    const raw = { series: [{ label: 'a', points: [{ t: 1, v: 10 }] }] }
    const series = adaptSeries(raw)
    expect(series[0].label).toBe('a')
    expect(series[0].points[0].v).toBe(10)
  })

  it('adaptSeries never fabricates on an unrecognised payload', () => {
    expect(adaptSeries(null)).toEqual([])
    expect(adaptSeries({ nope: true })).toEqual([])
    expect(adaptSeries('junk')).toEqual([])
  })

  it('adaptLogs maps varied log field names', () => {
    const logs = adaptLogs({
      logs: [{ ts: 1000, msg: 'hello', severity: 'WARN', source: 'graph-os' }],
    })
    expect(logs).toHaveLength(1)
    expect(logs[0].message).toBe('hello')
    expect(logs[0].level).toBe('WARN')
    expect(logs[0].stream).toBe('graph-os')
  })

  it('adaptTraces derives span_count from spans when absent', () => {
    const traces = adaptTraces({
      traces: [{ trace_id: 't1', spans: [{ name: 's1', start: 0, duration: 5 }] }],
    })
    expect(traces[0].trace_id).toBe('t1')
    expect(traces[0].span_count).toBe(1)
  })

  it('rangeBounds returns a window ending now', () => {
    const oneHour = TIME_RANGES.find((r) => r.id === '1h')!
    const { start, end } = rangeBounds(oneHour, 3_600_000_000)
    expect(end - start).toBe(3600)
  })
})
