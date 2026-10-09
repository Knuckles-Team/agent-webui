/**
 * @file csv-import.ts
 * @description Typed CSV import preview contract (FUI-11.1), mirroring
 * `agent_connector_sdk.finance.csv_import`: a preview reports the column
 * mapping, the row count it would produce, and a stable file digest before
 * anything is committed; re-previewing byte-identical content yields the
 * same digest, so a repeated import is idempotent rather than duplicated.
 * Post-import holdings are displayed from the owning service's response,
 * never computed here. Wiring a file-upload UI to this contract and to the
 * owner's holdings response is FUI-11.2.
 */

export interface ColumnMapping {
  header_to_field: Record<string, string>
}

export const REQUIRED_CSV_FIELDS = [
  'event_time_utc',
  'action',
  'quantity',
  'price',
  'fees',
  'currency',
  'settlement_time_utc',
] as const

export interface CsvImportPreview {
  file_digest: string
  row_count: number
  mapping: ColumnMapping
  /** Per-row validation errors found before commit, e.g. a malformed row. */
  row_errors: readonly { row_index: number; message: string }[]
}

/** A mapping is ambiguous when a required field is unmapped or two headers map to the same field. */
export function mappingErrors(headers: readonly string[], mapping: ColumnMapping): string[] {
  const mappedFields = Object.values(mapping.header_to_field)
  const missing = REQUIRED_CSV_FIELDS.filter((field) => !mappedFields.includes(field))
  const duplicated = [...new Set(mappedFields.filter((field) => mappedFields.filter((f) => f === field).length > 1))]
  const unknownHeaders = Object.keys(mapping.header_to_field).filter((header) => !headers.includes(header))
  const errors: string[] = []
  if (missing.length > 0) errors.push(`missing=${missing.join(',')}`)
  if (duplicated.length > 0) errors.push(`duplicated=${duplicated.join(',')}`)
  if (unknownHeaders.length > 0) errors.push(`unknown_headers=${unknownHeaders.join(',')}`)
  return errors
}

/** Re-previewing the same bytes and mapping must report the same receipt (same digest, same row count). */
export function isIdempotentReimport(first: CsvImportPreview, second: CsvImportPreview): boolean {
  return first.file_digest === second.file_digest && first.row_count === second.row_count
}
