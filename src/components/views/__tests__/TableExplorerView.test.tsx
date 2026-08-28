import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TableExplorerView from '@/components/views/TableExplorerView'

const schemaResponse = {
  status: 'success',
  result: {
    catalogs: [
      {
        catalog: 'eg',
        schemas: [
          {
            schema: 'public',
            tables: [
              {
                catalog: 'eg',
                schema: 'public',
                name: 'widgets',
                kind: 'table',
                table_type: 'BASE TABLE',
                columns: [
                  { name: 'id', position: 1, data_type: 'text', nullable: false, primary_key: true },
                  { name: 'title', position: 2, data_type: 'text', nullable: true, primary_key: null },
                ],
              },
            ],
          },
        ],
      },
    ],
    capabilities: { primary_keys: true, nullability: false },
    counts: { catalogs: 1, schemas: 1, tables: 1, columns: 2 },
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

/** Route every fetch through one dispatcher keyed on the URL suffix, mirroring
 * `DataAnalystView`-style tests that hit more than one gateway route per render. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): void {
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  ) as unknown as typeof fetch
}

describe('TableExplorerView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the schema tree and renders the catalog', async () => {
    stubFetch((url) => (url.includes('/sql-schema') ? jsonResponse(schemaResponse) : jsonResponse({}, 404)))
    render(<TableExplorerView />)

    await waitFor(() => {
      expect(screen.getByText('public')).toBeInTheDocument()
    })
  })

  it('shows the "not activated" hint when /sql-schema 404s', async () => {
    stubFetch(() => jsonResponse({}, 404))
    render(<TableExplorerView />)

    await waitFor(() => {
      expect(screen.getByText(/not serving on this backend yet/i)).toBeInTheDocument()
    })
  })

  it('selecting a table shows its columns and lets the user drill into one', async () => {
    stubFetch((url) => (url.includes('/sql-schema') ? jsonResponse(schemaResponse) : jsonResponse({}, 404)))
    const user = userEvent.setup()
    render(<TableExplorerView />)

    await waitFor(() => {
      expect(screen.getByText('public')).toBeInTheDocument()
    })
    await user.click(screen.getByText('public'))
    await waitFor(() => {
      expect(screen.getByText('widgets')).toBeInTheDocument()
    })
    await user.click(screen.getByText('widgets'))

    await waitFor(() => {
      expect(screen.getByText('public.widgets')).toBeInTheDocument()
    })
  })
})
