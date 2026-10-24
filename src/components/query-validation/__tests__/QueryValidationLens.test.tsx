import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryValidationLens } from '../QueryValidationLens'
import { useQueryValidationLens } from '../useQueryValidationLens'

function RetainedHost() {
  const controller = useQueryValidationLens()
  const [visible, setVisible] = useState(true)
  return (
    <>
      <button
        onClick={() => {
          setVisible(!visible)
        }}
      >
        Toggle lens
      </button>
      {visible && <QueryValidationLens controller={controller} />}
    </>
  )
}
function IndependentLens() {
  const controller = useQueryValidationLens()
  return <QueryValidationLens controller={controller} />
}

afterEach(() => {
  vi.unstubAllGlobals()
})
describe('retained workspace query lens', () => {
  // spec: WEBUI-APPS-R049
  it('retains pending SELECT execution, new draft and response provenance across lens unmount', async () => {
    let finish!: (response: Response) => void
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<RetainedHost />)
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'SELECT ?submitted WHERE { ?submitted ?p ?o }' },
    })
    await user.click(screen.getByRole('button', { name: 'Run Query' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SELECT ?draft WHERE { ?draft ?p ?o }' } })
    await user.click(screen.getByRole('button', { name: 'Toggle lens' }))
    expect(screen.queryByRole('region', { name: 'Query and validation' })).not.toBeInTheDocument()
    finish(
      new Response(
        JSON.stringify({
          status: 'success',
          head: { vars: ['s'] },
          results: { bindings: [{ s: { value: 'ex:kept' } }] },
        }),
        { status: 200 },
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Toggle lens' }))
    await screen.findByText('ex:kept')
    expect(screen.getByRole('textbox')).toHaveValue('SELECT ?draft WHERE { ?draft ?p ?o }')
    expect(screen.getByRole('group', { name: 'Response submitted input' })).toHaveTextContent('SELECT ?submitted')
    expect(screen.getByText(/Current draft differs/)).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  // spec: WEBUI-DESIGN-R004.2.1
  it('keeps validation mode, source, errors and focused pane across host visibility changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: 'Synthetic unavailable' }), { status: 503 }))),
    )
    const user = userEvent.setup()
    render(<RetainedHost />)
    await user.click(screen.getByRole('tab', { name: 'SHACL' }))
    await user.type(screen.getByRole('textbox'), 'ex:Draft a owl:Class .')
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Results' }))
    await user.click(screen.getByRole('button', { name: 'Toggle lens' }))
    await user.click(screen.getByRole('button', { name: 'Toggle lens' }))
    expect(screen.getByRole('tab', { name: 'SHACL' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Results' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic unavailable')
    await user.click(screen.getByRole('button', { name: 'Editor' }))
    expect(screen.getByRole('textbox')).toHaveValue('ex:Draft a owl:Class .')
  })

  // spec: WEBUI-DESIGN-R004.1
  it('isolates simultaneous lenses and labels each source selector uniquely', async () => {
    const user = userEvent.setup()
    render(
      <>
        <IndependentLens />
        <IndependentLens />
      </>,
    )
    const lenses = screen.getAllByRole('region', { name: 'Query and validation' })
    for (const lens of lenses) await user.click(within(lens).getByRole('tab', { name: 'SHACL' }))
    const selectors = screen.getAllByRole('combobox', { name: 'Source type' })
    expect(selectors[0].id).not.toBe(selectors[1].id)
    await user.type(within(lenses[0]).getByRole('textbox'), 'first draft')
    await waitFor(() => {
      expect(within(lenses[1]).getByRole('textbox')).toHaveValue('')
    })
  })
})

// spec: WEBUI-APPS-R049
it('retires execution callbacks when the authorized controller owner unmounts', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { result, unmount } = renderHook(() => useQueryValidationLens())
  const retired = result.current
  unmount()
  await retired.runSparql()
  await retired.runValidate()
  expect(fetch).not.toHaveBeenCalled()
})
