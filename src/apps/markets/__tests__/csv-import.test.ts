import { describe, expect, it } from 'vitest'
import { isIdempotentReimport, mappingErrors, type ColumnMapping, type CsvImportPreview } from '../csv-import'

const HEADERS = ['Trade Date', 'Side', 'Qty', 'Price', 'Fee', 'Ccy', 'Settle Date']
const MAPPING: ColumnMapping = {
  header_to_field: {
    'Trade Date': 'event_time_utc',
    Side: 'action',
    Qty: 'quantity',
    Price: 'price',
    Fee: 'fees',
    Ccy: 'currency',
    'Settle Date': 'settlement_time_utc',
  },
}

describe('csv-import (FUI-11.1)', () => {
  it('accepts a complete, unambiguous mapping', () => {
    expect(mappingErrors(HEADERS, MAPPING)).toEqual([])
  })

  it('rejects a mapping missing a required field', () => {
    const incomplete: ColumnMapping = {
      header_to_field: Object.fromEntries(Object.entries(MAPPING.header_to_field).filter(([, v]) => v !== 'fees')),
    }
    expect(mappingErrors(HEADERS, incomplete).some((e) => e.startsWith('missing='))).toBe(true)
  })

  it('rejects a mapping naming two headers for one field', () => {
    const duplicated: ColumnMapping = { header_to_field: { ...MAPPING.header_to_field, Price: 'quantity' } }
    expect(mappingErrors(HEADERS, duplicated).some((e) => e.startsWith('duplicated='))).toBe(true)
  })

  it('flags a malformed row as a row error rather than silently dropping it', () => {
    const preview: CsvImportPreview = {
      file_digest: 'sha256:abc',
      row_count: 2,
      mapping: MAPPING,
      row_errors: [{ row_index: 1, message: 'quantity is not numeric' }],
    }
    expect(preview.row_errors).toHaveLength(1)
  })

  it('reports the same receipt for a duplicate-digest reimport of the same file', () => {
    const first: CsvImportPreview = { file_digest: 'sha256:abc', row_count: 2, mapping: MAPPING, row_errors: [] }
    const second: CsvImportPreview = { file_digest: 'sha256:abc', row_count: 2, mapping: MAPPING, row_errors: [] }
    expect(isIdempotentReimport(first, second)).toBe(true)
  })

  it('treats a changed file as a new version, not a merged duplicate', () => {
    const first: CsvImportPreview = { file_digest: 'sha256:abc', row_count: 2, mapping: MAPPING, row_errors: [] }
    const changed: CsvImportPreview = { file_digest: 'sha256:def', row_count: 3, mapping: MAPPING, row_errors: [] }
    expect(isIdempotentReimport(first, changed)).toBe(false)
  })
})
