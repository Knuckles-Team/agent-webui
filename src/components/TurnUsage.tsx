import type { TurnUsageReceipt } from '@/lib/turn-usage'

const labels = {
  requests: 'Requests',
  tool_calls: 'Tool calls',
  input_tokens: 'Input tokens',
  output_tokens: 'Output tokens',
  total_tokens: 'Total tokens',
} as const
const formatter = new Intl.NumberFormat('en-US')

/** Render measured values only. Missing categories are not zero or a subtotal. */
export function TurnUsage({ receipt }: { receipt: TurnUsageReceipt | null }) {
  const known = Object.entries(labels).flatMap(([key, label]) => {
    const value = receipt?.counts[key as keyof typeof labels]
    return value === undefined ? [] : [{ label, value }]
  })
  if (known.length === 0) return <p className="text-xs text-muted-foreground">Turn usage: unavailable</p>
  return (
    <section aria-label="Turn usage" className="text-xs text-muted-foreground">
      <p>Turn usage</p>
      <dl className="flex flex-wrap gap-x-3 gap-y-1">
        {known.map(({ label, value }) => (
          <div key={label} className="flex gap-1">
            <dt>{label}:</dt>
            <dd>{formatter.format(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
