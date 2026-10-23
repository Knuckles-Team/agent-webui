/**
 * @file ChartSvg.tsx
 * @description A small accessible SVG line or bar chart (WEBUI-DASH-R014). Series use
 * theme tokens (`currentColor` from `text-primary`), line charts add point markers, and
 * the figure carries a text summary, so no meaning rests on color alone.
 */
const W = 400
const H = 180
const PAD = { l: 44, r: 12, t: 12, b: 28 }

export interface ChartSvgProps {
  kind: 'line' | 'bar'
  labels: readonly string[]
  values: readonly number[]
  summary: string
}

function ticks(min: number, max: number): number[] {
  if (min === max) return [min]
  return [min, (min + max) / 2, max]
}

function fmt(value: number): string {
  return Math.abs(value) >= 1_000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : String(Math.round(value * 100) / 100)
}

export function ChartSvg({ kind, labels, values, summary }: ChartSvgProps) {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo === 0 ? 1 : hi - lo
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const y = (v: number) => PAD.t + innerH - ((v - lo) / span) * innerH
  const step = values.length > 1 ? innerW / (values.length - 1) : innerW
  const barW = Math.max(2, (innerW / Math.max(values.length, 1)) * 0.7)
  const xLine = (i: number) => PAD.l + (values.length > 1 ? i * step : innerW / 2)
  const xBar = (i: number) => PAD.l + (i + 0.5) * (innerW / values.length)
  const labelEvery = Math.max(1, Math.ceil(values.length / 6))
  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      role="img"
      aria-label={summary}
      className="h-auto w-full text-primary"
    >
      {ticks(lo, hi).map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {fmt(t)}
          </text>
        </g>
      ))}
      {kind === 'line' ? (
        <>
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            points={values.map((v, i) => `${String(xLine(i))},${String(y(v))}`).join(' ')}
          />
          {values.map((v, i) => (
            <circle key={`${String(i)}-${labels[i] ?? ''}`} cx={xLine(i)} cy={y(v)} r={3} fill="currentColor" />
          ))}
        </>
      ) : (
        values.map((v, i) => (
          <rect
            key={`${String(i)}-${labels[i] ?? ''}`}
            x={xBar(i) - barW / 2}
            width={barW}
            y={Math.min(y(v), y(0))}
            height={Math.abs(y(v) - y(0))}
            fill="currentColor"
          />
        ))
      )}
      {labels.map((label, i) =>
        i % labelEvery === 0 ? (
          <text
            key={`${String(i)}-${label}`}
            x={kind === 'line' ? xLine(i) : xBar(i)}
            y={H - 10}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {label.slice(0, 10)}
          </text>
        ) : null,
      )}
    </svg>
  )
}
