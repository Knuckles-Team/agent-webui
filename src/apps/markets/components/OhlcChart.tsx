/**
 * @file OhlcChart.tsx
 * @description The SVG OHLC renderer behind {@link ChartRenderer}: candles,
 * the trailing trend line coloured by direction (bearish also dashed, so the
 * state never rests on colour alone), flip labels with their price, the
 * flip-level tag, macro-event markers, a volume pane and indicator panes that
 * each own their scale. The chart is one slider: arrow keys (and Page Up/Down)
 * walk the bars, Home and End jump to the ends, and the value text is the
 * bar's date and prices.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { formatDate, formatPrice, formatVolume } from '../format'
import type { FlipMarker, OhlcBar } from '../schemas'
import {
  domainOf,
  nearestIndex,
  niceTicks,
  polyline,
  trailSegments,
  xAtIndex,
  xAtTime,
  yScale,
  type Band,
  type XAxis,
} from './chart-geometry'
import type { ChartLine, ChartModel, ChartRendererProps, EventMarker } from './chart-model'
import { useElementWidth } from './use-element-width'

const AXIS = 64
const PRICE = 320
const STRIP = 14
const VOLUME = 64
const PANE = 84
const GAP = 8
const BOTTOM = 22
const KEY_STEPS = new Map([
  ['ArrowLeft', -1],
  ['ArrowRight', 1],
  ['PageUp', -10],
  ['PageDown', 10],
])

const PALETTES = {
  convention: '[--mk-up:#1a9e5b] [--mk-down:#d6453d] dark:[--mk-up:#22a06b] dark:[--mk-down:#e5484d]',
  cvd: '[--mk-up:#1f8fcf] [--mk-down:#e0457b] dark:[--mk-up:#2e97d9] dark:[--mk-down:#e0457b]',
}

interface Layout {
  axis: XAxis
  price: Band
  strip: Band | null
  volume: Band | null
  panes: Band[]
  height: number
}

function layout(model: ChartModel, width: number): Layout {
  let cursor = PRICE
  const strip = model.events.length > 0 ? { top: cursor + 2, height: STRIP } : null
  cursor += strip ? STRIP + 2 : 0
  const volume = model.showVolume ? { top: cursor + GAP, height: VOLUME } : null
  cursor += volume ? VOLUME + GAP : 0
  const panes = model.panes.map(() => {
    const band = { top: cursor + GAP, height: PANE }
    cursor += PANE + GAP
    return band
  })
  return {
    axis: { count: model.bars.length, width: Math.max(1, width - AXIS) },
    price: { top: 8, height: PRICE - 16 },
    strip,
    volume,
    panes,
    height: cursor + BOTTOM,
  }
}

function priceValues(model: ChartModel): number[] {
  return [
    ...model.bars.flatMap((bar) => [bar.h, bar.l]),
    ...model.trail.map((point) => point.value),
    ...model.overlays.flatMap((line) => line.points.map((point) => point.value)),
  ]
}

function Candles({ bars, axis, y }: { bars: OhlcBar[]; axis: XAxis; y: (v: number) => number }) {
  const body = Math.max(1, (axis.width / Math.max(1, axis.count)) * 0.7)
  return (
    <g>
      {bars.map((bar, index) => {
        const x = xAtIndex(axis, index)
        const up = bar.c >= bar.o
        const color = up ? 'var(--mk-up)' : 'var(--mk-down)'
        const top = y(Math.max(bar.o, bar.c))
        return (
          <g
            key={bar.t}
            stroke={color}
            fill={up ? 'transparent' : color}
            strokeDasharray={bar.final ? undefined : '2 2'}
          >
            <line x1={x} x2={x} y1={y(bar.h)} y2={y(bar.l)} strokeWidth={1} />
            <rect x={x - body / 2} y={top} width={body} height={Math.max(1, y(Math.min(bar.o, bar.c)) - top)} />
          </g>
        )
      })}
    </g>
  )
}

function Trail({ model, x, y }: { model: ChartModel; x: (t: number) => number | null; y: (v: number) => number }) {
  const segments = useMemo(() => trailSegments(model.trail, x, y), [model.trail, x, y])
  return (
    <g fill="none" strokeWidth={2} strokeLinejoin="round">
      {segments.map((segment) => (
        <polyline
          key={`${segment.direction}-${segment.points[0][0]}`}
          points={polyline(segment.points)}
          stroke={segment.direction === 'bullish' ? 'var(--mk-up)' : 'var(--mk-down)'}
          strokeDasharray={segment.direction === 'bearish' ? '6 3' : undefined}
        />
      ))}
    </g>
  )
}

function FlipTags({
  flips,
  x,
  y,
  decimals,
}: {
  flips: FlipMarker[]
  x: (t: number) => number | null
  y: (v: number) => number
  decimals: number | null
}) {
  return (
    <g fontSize={11} fontWeight={600}>
      {flips.map((flip) => {
        const px = x(flip.bar_open)
        if (px === null) return null
        const bullish = flip.to === 'bullish'
        const py = y(flip.line) + (bullish ? 18 : -18)
        const label = bullish ? '▲ bullish' : '▼ bearish'
        return (
          <g key={flip.event_id}>
            <title>{`Flipped ${flip.to} at ${formatPrice(flip.price, decimals)}`}</title>
            <rect
              x={px - 34}
              y={py - 9}
              width={68}
              height={17}
              rx={4}
              fill={bullish ? 'var(--mk-up)' : 'var(--mk-down)'}
            />
            <text x={px} y={py + 4} textAnchor="middle" fill="white">
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Lines({ lines, x, y }: { lines: ChartLine[]; x: (t: number) => number | null; y: (v: number) => number }) {
  return (
    <g fill="none" strokeWidth={1.5} className="stroke-muted-foreground">
      {lines.map((line) => (
        <polyline
          key={line.id}
          aria-label={line.label}
          points={polyline(
            line.points.flatMap((point) => {
              const px = x(point.t)
              return px === null ? [] : [[px, y(point.value)] as [number, number]]
            }),
          )}
        />
      ))}
    </g>
  )
}

function YTicks({
  band,
  domain,
  right,
  format,
}: {
  band: Band
  domain: readonly [number, number]
  right: number
  format: (v: number) => string
}) {
  const y = yScale(domain, band)
  return (
    <g className="fill-muted-foreground text-[10px]">
      {niceTicks(domain, band.height > 150 ? 6 : 2).map((value) => (
        <g key={value}>
          <line x1={0} x2={right} y1={y(value)} y2={y(value)} className="stroke-border/40" strokeWidth={1} />
          <text x={right + 6} y={y(value) + 3}>
            {format(value)}
          </text>
        </g>
      ))}
    </g>
  )
}

function VolumePane({ bars, axis, band }: { bars: OhlcBar[]; axis: XAxis; band: Band }) {
  const y = yScale([0, Math.max(1, ...bars.map((bar) => bar.v))], band)
  const width = Math.max(1, (axis.width / Math.max(1, axis.count)) * 0.7)
  return (
    <g aria-label="Volume" opacity={0.55}>
      {bars.map((bar, index) => (
        <rect
          key={bar.t}
          x={xAtIndex(axis, index) - width / 2}
          y={y(bar.v)}
          width={width}
          height={Math.max(0, band.top + band.height - y(bar.v))}
          fill={bar.c >= bar.o ? 'var(--mk-up)' : 'var(--mk-down)'}
        />
      ))}
    </g>
  )
}

function EventStrip({ events, x, band }: { events: EventMarker[]; x: (t: number) => number | null; band: Band }) {
  return (
    <g aria-label="Macro events">
      {events.map((event) => {
        const px = x(event.t)
        if (px === null) return null
        return (
          <circle
            key={event.id}
            cx={px}
            cy={band.top + band.height / 2}
            r={5}
            className="fill-amber-500 stroke-background"
            strokeWidth={2}
          >
            <title>{`${event.title} (${event.action})`}</title>
          </circle>
        )
      })}
    </g>
  )
}

function useCursor(count: number) {
  const [cursor, setCursor] = useState<number | null>(null)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = count - 1
    const jump = new Map([
      ['Home', 0],
      ['End', last],
    ]).get(event.key)
    const step = KEY_STEPS.get(event.key)
    if (jump !== undefined) setCursor(jump)
    else if (step !== undefined) setCursor((current) => Math.max(0, Math.min(last, (current ?? last) + step)))
    else return
    event.preventDefault()
  }
  return { cursor, setCursor, onKeyDown }
}

function barSummary(bar: OhlcBar, model: ChartModel): string {
  const price = (value: number) => formatPrice(value, model.priceDecimals)
  return (
    `${formatDate(bar.t, model.timeframe)}: open ${price(bar.o)}, high ${price(bar.h)}, ` +
    `low ${price(bar.l)}, close ${price(bar.c)}, volume ${formatVolume(bar.v)}` +
    (bar.final ? '' : ' (bar still open)')
  )
}

function XLabels({ bars, axis, top, timeframe }: { bars: OhlcBar[]; axis: XAxis; top: number; timeframe: string }) {
  const every = Math.max(1, Math.ceil(bars.length / 6))
  return (
    <g className="fill-muted-foreground text-[10px]">
      {bars.map((bar, index) =>
        index % every === 0 ? (
          <text key={bar.t} x={xAtIndex(axis, index)} y={top + 14} textAnchor={index === 0 ? 'start' : 'middle'}>
            {formatDate(bar.t, timeframe)}
          </text>
        ) : null,
      )}
    </g>
  )
}

function FlipLevel({ model, y, right }: { model: ChartModel; y: (v: number) => number; right: number }) {
  if (model.flipLevel === null) return null
  const level = y(model.flipLevel)
  const bullish = model.trail.at(-1)?.direction !== 'bearish'
  return (
    <g>
      <line x1={0} x2={right} y1={level} y2={level} className="stroke-muted-foreground" strokeDasharray="2 4" />
      <rect
        x={right + 1}
        y={level - 8}
        width={AXIS - 2}
        height={16}
        rx={3}
        fill={bullish ? 'var(--mk-up)' : 'var(--mk-down)'}
      />
      <text x={right + 4} y={level + 4} fill="white" className="text-[10px] font-semibold">
        {formatPrice(model.flipLevel, model.priceDecimals)}
        <title>Flip level: a close beyond this line flips the trend</title>
      </text>
    </g>
  )
}

function IndicatorPane({
  line,
  band,
  x,
  right,
}: {
  line: ChartLine
  band: Band
  x: (t: number) => number | null
  right: number
}) {
  const domain = domainOf(line.points.map((point) => point.value))
  const y = yScale(domain, band)
  return (
    <g>
      <text x={4} y={band.top + 10} className="fill-muted-foreground text-[10px]">
        {line.label}
      </text>
      <YTicks band={band} domain={domain} right={right} format={formatPrice} />
      <Lines lines={[line]} x={x} y={y} />
    </g>
  )
}

export function OhlcChart({ model, palette }: ChartRendererProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>(900)
  const box = useMemo(() => layout(model, width), [model, width])
  const priceDomain = useMemo(() => domainOf(priceValues(model)), [model])
  const y = useMemo(() => yScale(priceDomain, box.price), [priceDomain, box.price])
  const x = useMemo(() => (t: number) => xAtTime(box.axis, model.bars, t), [box.axis, model.bars])
  const { cursor, setCursor, onKeyDown } = useCursor(model.bars.length)
  const svgRef = useRef<SVGSVGElement>(null)
  const shown = cursor ?? model.bars.length - 1
  const summary = shown >= 0 ? barSummary(model.bars[shown], model) : 'No bars.'
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const left = svgRef.current?.getBoundingClientRect().left ?? 0
    setCursor(nearestIndex(box.axis, event.clientX - left))
  }
  const right = box.axis.width

  return (
    <div ref={ref} className={cn('relative w-full', PALETTES[palette])}>
      <div
        role="slider"
        aria-roledescription="chart"
        aria-label={`${model.title}. Use the arrow keys to move between bars.`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, model.bars.length - 1)}
        aria-valuenow={cursor ?? Math.max(0, model.bars.length - 1)}
        aria-valuetext={summary}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg
          ref={svgRef}
          width={width}
          height={box.height}
          aria-hidden="true"
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            setCursor(null)
          }}
        >
          <YTicks
            band={box.price}
            domain={priceDomain}
            right={right}
            format={(value) => formatPrice(value, model.priceDecimals)}
          />
          <Candles bars={model.bars} axis={box.axis} y={y} />
          {model.trail.length > 0 && <Trail model={model} x={x} y={y} />}
          <Lines lines={model.overlays} x={x} y={y} />

          {model.showFlips && <FlipTags flips={model.flips} x={x} y={y} decimals={model.priceDecimals} />}
          {box.strip && <EventStrip events={model.events} x={x} band={box.strip} />}
          {box.volume && <VolumePane bars={model.bars} axis={box.axis} band={box.volume} />}
          {model.panes.map((line, index) => (
            <IndicatorPane key={line.id} line={line} band={box.panes[index]} x={x} right={right} />
          ))}
          {cursor !== null && (
            <line
              x1={xAtIndex(box.axis, cursor)}
              x2={xAtIndex(box.axis, cursor)}
              y1={0}
              y2={box.height - BOTTOM}
              className="stroke-foreground/40"
            />
          )}
          <FlipLevel model={model} y={y} right={right} />
          <XLabels bars={model.bars} axis={box.axis} top={box.height - BOTTOM} timeframe={model.timeframe} />
        </svg>
      </div>
      <p aria-hidden="true" className="mt-1 min-h-5 text-xs text-muted-foreground">
        {summary}
      </p>
    </div>
  )
}
