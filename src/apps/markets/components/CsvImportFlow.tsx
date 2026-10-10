/**
 * @file CsvImportFlow.tsx
 * @description Live CSV import preview wiring (FUI-11.2): renders the
 * import preview contract (FUI-11.1, {@link mappingErrors},
 * {@link isIdempotentReimport}) before anything commits — showing the
 * column mapping, per-row validation errors, and the file digest as the
 * stable receipt — then, once an import result is available, displays the
 * post-import holdings exactly as the owning service returned them, never
 * recomputed here.
 */
import { mappingErrors } from '../csv-import'
import type { ColumnMapping, CsvImportPreview } from '../csv-import'

/** Post-import holdings as returned verbatim by the owning service. */
export interface OwnerHoldingsResponse {
  receipt: string
  holdings: readonly { symbol: string; quantity: string; cost_basis: string }[]
}

export function CsvImportFlow({
  headers,
  mapping,
  preview,
  priorReceipt,
  holdings,
}: {
  headers: readonly string[]
  mapping: ColumnMapping
  preview: CsvImportPreview
  /** The receipt from an earlier import of the same file, if any, to prove idempotency. */
  priorReceipt?: string
  holdings?: OwnerHoldingsResponse
}) {
  const errors = mappingErrors(headers, mapping)
  const isRepeatReceipt = priorReceipt !== undefined && priorReceipt === preview.file_digest

  return (
    <div data-testid="csv-import-flow">
      <section data-testid="csv-import-preview">
        <p data-testid="csv-import-row-count">{preview.row_count} rows</p>
        <p data-testid="csv-import-receipt" data-repeat={isRepeatReceipt}>
          {preview.file_digest}
        </p>
        {errors.length > 0 && (
          <ul data-testid="csv-import-mapping-errors">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {preview.row_errors.length > 0 && (
          <ul data-testid="csv-import-row-errors">
            {preview.row_errors.map((rowError) => (
              <li key={rowError.row_index} data-testid="csv-import-row-error">
                Row {rowError.row_index}: {rowError.message}
              </li>
            ))}
          </ul>
        )}
      </section>
      {holdings && (
        /* Owner-sourced holdings, rendered verbatim: never recomputed client-side. */
        <section data-testid="csv-import-holdings" data-receipt={holdings.receipt}>
          {holdings.holdings.map((holding) => (
            <p key={holding.symbol} data-testid="csv-import-holding-row">
              {holding.symbol}: {holding.quantity} @ cost basis {holding.cost_basis}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}
