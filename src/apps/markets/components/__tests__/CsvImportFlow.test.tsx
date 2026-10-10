import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CsvImportFlow } from '../CsvImportFlow'
import type { ColumnMapping, CsvImportPreview } from '../../csv-import'

const HEADERS = ['Trade Date', 'Side', 'Qty', 'Price', 'Fee', 'Ccy', 'Settle Date']
const FULL_MAPPING: ColumnMapping = {
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

const UNMAPPED: ColumnMapping = {
  header_to_field: Object.fromEntries(Object.entries(FULL_MAPPING.header_to_field).filter(([, v]) => v !== 'fees')),
}

describe('CsvImportFlow (FUI-11.2)', () => {
  // spec: FUI-11.2
  it('previews the column mapping and row errors before anything commits', () => {
    const preview: CsvImportPreview = {
      file_digest: 'sha256:abc',
      row_count: 3,
      mapping: UNMAPPED,
      row_errors: [{ row_index: 1, message: 'quantity is not numeric' }],
    }
    render(<CsvImportFlow headers={HEADERS} mapping={UNMAPPED} preview={preview} />)
    expect(screen.getByTestId('csv-import-row-count')).toHaveTextContent('3 rows')
    expect(screen.getByTestId('csv-import-mapping-errors')).toHaveTextContent('missing=fees')
    expect(screen.getAllByTestId('csv-import-row-error')).toHaveLength(1)
    expect(screen.queryByTestId('csv-import-holdings')).toBeNull()
  })

  // spec: FUI-11.2
  it('shows no mapping errors for a complete mapping and reports the digest as the receipt', () => {
    const preview: CsvImportPreview = {
      file_digest: 'sha256:abc',
      row_count: 3,
      mapping: FULL_MAPPING,
      row_errors: [],
    }
    render(<CsvImportFlow headers={HEADERS} mapping={FULL_MAPPING} preview={preview} />)
    expect(screen.queryByTestId('csv-import-mapping-errors')).toBeNull()
    expect(screen.getByTestId('csv-import-receipt')).toHaveTextContent('sha256:abc')
  })

  // spec: FUI-11.2
  it('marks a repeated import of a duplicate-digest file as the same logical receipt', () => {
    const preview: CsvImportPreview = {
      file_digest: 'sha256:abc',
      row_count: 3,
      mapping: FULL_MAPPING,
      row_errors: [],
    }
    render(<CsvImportFlow headers={HEADERS} mapping={FULL_MAPPING} preview={preview} priorReceipt="sha256:abc" />)
    expect(screen.getByTestId('csv-import-receipt')).toHaveAttribute('data-repeat', 'true')
  })

  // spec: FUI-11.2
  it('displays post-import holdings exactly as the owning service returned them', () => {
    const preview: CsvImportPreview = {
      file_digest: 'sha256:abc',
      row_count: 1,
      mapping: FULL_MAPPING,
      row_errors: [],
    }
    render(
      <CsvImportFlow
        headers={HEADERS}
        mapping={FULL_MAPPING}
        preview={preview}
        holdings={{
          receipt: 'sha256:abc',
          holdings: [{ symbol: 'AAPL', quantity: '12.5', cost_basis: '187.3421' }],
        }}
      />,
    )
    expect(screen.getByTestId('csv-import-holdings')).toHaveAttribute('data-receipt', 'sha256:abc')
    expect(screen.getByTestId('csv-import-holding-row')).toHaveTextContent('AAPL: 12.5 @ cost basis 187.3421')
  })
})
