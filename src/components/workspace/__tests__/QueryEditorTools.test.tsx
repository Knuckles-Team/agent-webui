// spec: OVERSTORY-APPS-R049.1.8
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { QueryValidationLens } from '@/components/query-validation/QueryValidationLens'
import { useQueryValidationLens } from '@/components/query-validation/useQueryValidationLens'
import { api } from '@/lib/api'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { QueryEditorTools } from '../QueryEditorTools'
const state = vi.hoisted(() => ({
  tools: new Map<string, WebMcpToolDefinition>(),
  confirm: (() => undefined) as () => void,
  cancel: (() => undefined) as () => void,
}))
vi.mock('@/components/ui/dialog', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/ui/dialog')>()
  return {
    ...original,
    DialogContent: (props: ComponentProps<typeof original.DialogContent>) => {
      const capture = (children: ReactNode) => {
        Children.forEach(children, (child) => {
          if (!isValidElement<{ children?: ReactNode; onClick?: (event: unknown) => void }>(child)) return
          if (child.type === 'button' && child.props.children === 'Confirm provider submission')
            state.confirm = () => child.props.onClick?.({})
          if (child.type === 'button' && child.props.children === 'Cancel submission')
            state.cancel = () => child.props.onClick?.({})
          capture(child.props.children)
        })
      }
      capture(props.children)
      return <original.DialogContent {...props} />
    },
  }
})
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    for (const tool of tools) state.tools.set(tool.name, tool)
  },
}))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    runSparqlQuery: vi.fn(async () => ({ status: 'success', head: { vars: [] }, results: { bindings: [] } })),
    validateOntologyCandidate: vi.fn(async () => ({ valid: true, errors: [], warnings: [], summary: {} })),
  },
}))
function Harness({ lens = 'query' as 'query' | 'validation' }) {
  const controller = useQueryValidationLens()
  return (
    <>
      <QueryValidationLens controller={controller} />
      <QueryEditorTools
        controller={controller}
        lens={lens}
        context="fixture"
        restoreFocus={() => undefined}
        isAttendedGesture={() => true}
      />
    </>
  )
}
const invoke = (name: string, input = {}) =>
  state.tools.get(`agent-webui.explore.${name}`)!.execute(input, { signal: new AbortController().signal })
beforeEach(() => {
  vi.clearAllMocks()
  state.tools.clear()
})
describe('query review local mutation boundary with an injected test gesture', () => {
  it('submits the reviewed current text once and does not claim backend success', async () => {
    renderWithProviders(<Harness />)
    await act(async () => {
      await invoke('edit-query', { text: 'SELECT ?review WHERE {}' })
    })
    await act(async () => {
      expect(await invoke('request-query-submission')).toEqual({ reviewRequired: true })
    })
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: 'Confirm provider submission' })
    await act(async () => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(api.runSparqlQuery).toHaveBeenCalledExactlyOnceWith('SELECT ?review WHERE {}')
  })
  it('refuses edited text at confirmation even with an admitted gesture', async () => {
    renderWithProviders(<Harness />)
    await act(async () => {
      await invoke('request-query-submission')
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'SPARQL query', hidden: true }), {
      target: { value: 'SELECT ?different WHERE {}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm provider submission' }))
    expect(screen.getByRole('alert')).toHaveTextContent('changed')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel submission' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('shares validation source and source type with the existing callback', async () => {
    renderWithProviders(<Harness lens="validation" />)
    await act(async () => {
      await invoke('edit-query', { text: 'candidate', sourceType: 'text' })
    })
    await act(async () => {
      await invoke('request-query-submission')
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm provider submission' }))
    })
    expect(api.validateOntologyCandidate).toHaveBeenCalledExactlyOnceWith({ source: 'candidate', source_type: 'text' })
  })
  it('rejects duplicate review and byte-overbudget editor input without effects', async () => {
    renderWithProviders(<Harness />)
    await expect(invoke('edit-query', { text: '🔥'.repeat(2500) })).rejects.toThrow('byte budget')
    await expect(invoke('edit-query', { text: 'SELECT', sourceType: 'url' })).rejects.toThrow('only valid')
    await act(async () => {
      await invoke('request-query-submission')
      await expect(invoke('request-query-submission')).rejects.toThrow('already pending')
    })
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
  })
})

it('does not let callbacks from a cancelled review consume or dismiss its replacement', async () => {
  renderWithProviders(<Harness />)
  await act(async () => {
    await invoke('request-query-submission')
  })
  const oldConfirm = state.confirm
  const oldCancel = state.cancel
  fireEvent.click(screen.getByRole('button', { name: 'Cancel submission' }))
  await act(async () => {
    await invoke('request-query-submission')
  })
  await act(async () => {
    oldCancel()
    oldConfirm()
  })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(api.runSparqlQuery).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm provider submission' }))
  })
  expect(api.runSparqlQuery).toHaveBeenCalledTimes(1)
})
