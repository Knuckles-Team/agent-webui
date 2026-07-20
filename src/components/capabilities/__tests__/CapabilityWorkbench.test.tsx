import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../__tests__/fixtures'
import type { CapabilityDescriptor } from '../../../lib/capabilities-api'
import { PageContextProvider } from '../../../lib/page-context'
import { CapabilityWorkbench } from '../CapabilityWorkbench'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const descriptor: CapabilityDescriptor = {
  id: 'object_edits',
  title: 'Edit ontology object',
  one_line: 'Apply an audited object edit.',
  intent_verbs: ['edit'],
  actions: [
    {
      id: 'edit-object',
      input_schema: {
        type: 'object',
        required: ['action', 'object_id', 'note'],
        properties: {
          action: { const: 'edit-object' },
          object_id: { type: 'string', description: 'Object selected in the workspace.' },
          note: { type: 'string' },
          credential: { type: 'string', format: 'password', writeOnly: true, 'x-sensitive': true },
        },
      },
      typed_io: {
        legacy_rest_route: '/object/edit',
        legacy_request_encoding: 'action_in_body',
        frontend_executable: false,
      },
      side_effects: { mutates: true, audited: true, idempotent: false },
      policy: { approval_class: 'policy', target_input: 'object_id', authoritative_at_execution: true },
    },
  ],
  typed_io: {
    legacy_rest_route: '/object/edit',
    tags: ['object', 'audit'],
  },
  availability: {
    status: 'available',
    readiness: 'cold',
    reasons: ['engine_initializes_on_first_use'],
    missing_preconditions: [],
  },
  execution: {
    transports: ['rest'],
    response_mode: 'request_response',
    streaming: false,
    governed_invoke_route: '/api/capabilities/object_edits/invoke',
    normative_frontend_contract: 'governed_invoke',
    eventual_result_event: 'tool_result',
  },
  render: { renderer: 'json', source: 'annotation' },
}

describe('CapabilityWorkbench', () => {
  it('runs catalog → context → preflight → approval request → exact governed resume', async () => {
    let eventStreamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const encoder = new TextEncoder()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/capabilities?include_actions=true') {
        return jsonResponse({
          schema_version: '2.0',
          catalog_version: 'catalog-test',
          generated_at: '2026-07-13T00:00:00Z',
          runtime: { engine_active: false, backend_ready: false, status: 'initializing' },
          count: 1,
          action_count: 1,
          capabilities: [descriptor],
        })
      }
      if (url === '/api/capabilities/object_edits') return jsonResponse(descriptor)
      if (url === '/api/capabilities/object_edits/preflight') {
        return jsonResponse({
          capability_id: 'object_edits',
          action: 'edit-object',
          valid: true,
          validation_issues: [],
          availability: descriptor.availability,
          policy: {
            decision: 'queue_approval',
            tier: 'human',
            reason: 'A human approval is required.',
            approval_required: true,
            source: 'ActionPolicy.evaluate',
            authoritative: false,
            identity_evaluated: false,
            must_recheck_at_execution: true,
          },
          eligible: true,
          executable_now: false,
          side_effects: descriptor.actions[0].side_effects,
        })
      }
      if (url === '/api/capabilities/object_edits/invoke') {
        expect(init?.method).toBe('POST')
        const body = JSON.parse(String(init?.body)) as { approval_id?: string }
        if (body.approval_id) {
          queueMicrotask(() => {
            eventStreamController?.enqueue(
              encoder.encode(
                'id: run-edit-1:3\nevent: tool_result\ndata: {"schema_version":"1.0","event_id":"run-edit-1:3","sequence":3,"timestamp":"2026-07-13T00:00:03Z","type":"tool_result","run_id":"run-edit-1","session_id":"session-test","source":"capability-invoke","payload":{"result":{"updated":true,"object_id":"customer-7"}}}\n\n',
              ),
            )
            eventStreamController?.close()
          })
          return jsonResponse({ status: 'running', run_id: 'run-edit-1', session_id: 'session-test' }, 202)
        }
        return jsonResponse(
          {
            status: 'approval_required',
            approval_id: 'approval-edit-1',
            run_id: 'run-edit-1',
            session_id: 'session-test',
          },
          202,
        )
      }
      if (url === '/api/runs/run-edit-1') {
        return jsonResponse({
          run_id: 'run-edit-1',
          session_id: 'session-test',
          status: 'waiting_for_input',
          first_sequence: 1,
          last_sequence: 2,
          event_count: 2,
          last_event_type: 'approval_required',
        })
      }
      if (url.includes('/api/runs/run-edit-1/events?') && url.includes('follow=true')) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              eventStreamController = controller
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (url.startsWith('/api/runs/run-edit-1/events?')) {
        return jsonResponse({ schema_version: '1.0', run_id: 'run-edit-1', after: 0, events: [], next_after: 0 })
      }
      return jsonResponse({ detail: `Unexpected request: ${url}` }, 404)
    })
    globalThis.fetch = fetchMock
    window.localStorage.removeItem('activeConversationId')
    window.localStorage.setItem('capabilityWorkbenchSessionId', 'session-test')

    const { user } = renderWithProviders(
      <PageContextProvider
        route="/object/customer-7"
        view="object"
        baseSelection={[{ kind: 'ontology-object', id: 'customer-7', label: 'Customer 7' }]}
      >
        <CapabilityWorkbench />
      </PageContextProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Open capability launcher' }))
    expect(await screen.findByText(/Runtime is cold but callable/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /Edit ontology object/ }))

    expect(await screen.findByText('Callable now; the engine warms on first use.')).toBeInTheDocument()
    expect(screen.getByText('/api/capabilities/object_edits/invoke')).toBeInTheDocument()
    expect(screen.getByText('Legacy transport metadata · display only')).toBeInTheDocument()
    const objectId = await screen.findByLabelText(/Object Id/)
    expect(objectId).toHaveValue('customer-7')
    expect(screen.getByLabelText(/Credential/)).toHaveAttribute('type', 'password')
    await user.type(screen.getByLabelText(/Note/), 'Correct customer tier')
    await user.click(screen.getByRole('button', { name: 'Review preflight' }))

    expect(await screen.findByText('Preflight preview')).toBeInTheDocument()
    await waitFor(() => {
      const preflightCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/preflight'))
      expect(preflightCall).toBeDefined()
      expect(JSON.parse(String(preflightCall?.[1]?.body))).toEqual({
        action: 'edit-object',
        inputs: { action: 'edit-object', object_id: 'customer-7', note: 'Correct customer tier' },
        target: 'customer-7',
      })
    })

    const invoke = screen.getByRole('button', { name: 'Request approval' })
    expect(invoke).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(invoke).toBeEnabled()
    await user.click(invoke)

    expect(await screen.findByRole('region', { name: 'Pending capability approval' })).toBeInTheDocument()
    expect(screen.getByText('approval-edit-1')).toBeInTheDocument()
    expect(await screen.findByText('Live')).toBeInTheDocument()
    const initialInvoke = fetchMock.mock.calls.find(([url, init]) => {
      if (!String(url).endsWith('/invoke')) return false
      const body = JSON.parse(String(init?.body)) as { approval_id?: string }
      return !body.approval_id
    })
    expect(JSON.parse(String(initialInvoke?.[1]?.body))).toEqual({
      action: 'edit-object',
      inputs: { action: 'edit-object', object_id: 'customer-7', note: 'Correct customer tier' },
      target: 'customer-7',
      session_id: 'session-test',
    })

    await user.click(screen.getByRole('button', { name: 'Resume approved action' }))
    expect(await screen.findByText('Execution accepted')).toBeInTheDocument()
    expect((await screen.findAllByText(/"updated": true/)).length).toBeGreaterThan(0)
    const resumedInvoke = fetchMock.mock.calls.find(([url, init]) => {
      if (!String(url).endsWith('/invoke')) return false
      const body = JSON.parse(String(init?.body)) as { approval_id?: string }
      return body.approval_id === 'approval-edit-1'
    })
    expect(JSON.parse(String(resumedInvoke?.[1]?.body))).toEqual({
      action: 'edit-object',
      inputs: { action: 'edit-object', object_id: 'customer-7', note: 'Correct customer tier' },
      target: 'customer-7',
      session_id: 'session-test',
      approval_id: 'approval-edit-1',
      run_id: 'run-edit-1',
    })
  })
})
