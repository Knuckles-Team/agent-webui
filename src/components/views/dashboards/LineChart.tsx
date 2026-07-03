/**
 * @file LineChart.tsx
 * @description Dependency-free SVG multi-series line chart for dashboard panels.
 *
 * The repo ships no charting library (see package.json — only graph/network viz
 * via sigma/graphology), so metrics are drawn with a lightweight inline SVG to
 * avoid pulling a heavy new dependency. A single point renders as a dot; two or
 * more render as a polyline.
 */

import type { MetricSeries } from './queries'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7']

export function LineChart({ series, height = 200 }: { series: MetricSeries[]; height?: number }) {
  const width = 640
  const pad = 24

  const flat = series.flatMap((s) => s.points)
  if (flat.length === 0) {
    return <p className="text-muted-foreground text-sm">No data points.</p>
  }

  const ts = flat.map((p) => p.t)
  const vs = flat.map((p) => p.v)
  const tMin = Math.min(...ts)
  const tMax = Math.max(...ts)
  const vMin = Math.min(...vs)
  const vMax = Math.max(...vs)
  const tSpan = tMax - tMin || 1
  const vSpan = vMax - vMin || 1

  const x = (t: number) => pad + ((t - tMin) / tSpan) * (width - 2 * pad)
  const y = (v: number) => height - pad - ((v - vMin) / vSpan) * (height - 2 * pad)

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="w-full h-auto"
      role="img"
      aria-label="metric chart"
    >
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      {series.map((s, i) => {
        if (s.points.length === 0) return null
        const pts = s.points.map((p) => `${String(x(p.t))},${String(y(p.v))}`).join(' ')
        const color = COLORS[i % COLORS.length]
        return s.points.length === 1 ? (
          <circle key={s.label} cx={x(s.points[0].t)} cy={y(s.points[0].v)} r={3} fill={color} />
        ) : (
          <polyline key={s.label} points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        )
      })}
    </svg>
  )
}

export function chartColor(i: number): string {
  return COLORS[i % COLORS.length]
}
