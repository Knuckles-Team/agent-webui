import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import { detectWebMcpAdapter, registerWebMcpTools } from '../adapter'
import { createPageTools } from '../tools'
import type { WebMcpToolDefinition } from '../types'

function Location() {
  return <output aria-label="Current location">{useWorkspaceLocation()}</output>
}

// Structural document API fixture: this is not native-browser acceptance.
function registrationFixture() {
  let acknowledge!: () => void
  let reject!: (error: Error) => void
  let callback!: WebMcpToolDefinition
  const adapter = detectWebMcpAdapter({
    modelContext: {
      registerTool: (tool: WebMcpToolDefinition) => {
        callback = tool
        return new Promise<void>((resolve, fail) => {
          acknowledge = resolve
          reject = fail
        })
      },
    },
  } as unknown as Document)
  if (!adapter) throw new Error('fixture adapter missing')
  const tool = createPageTools({
    role: 'reader',
    context: {
      schemaVersion: '1.0',
      route: '/',
      view: 'dashboard',
      selection: [],
      filters: {},
      allowedActions: [],
      capturedAt: '2026-10-24T00:00:00.000Z',
    },
  }).find((entry) => entry.name === 'overstory.navigate')
  if (!tool) throw new Error('navigation tool missing')
  const handle = registerWebMcpTools(adapter, [tool])
  return {
    handle,
    acknowledge,
    reject,
    navigate: (path: string, signal = new AbortController().signal) => callback.execute({ path }, { signal }),
  }
}

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('document adapter navigation lifetime', () => {
  it('refuses pending and retired callbacks while active navigation updates rendered state', async () => {
    render(<Location />)
    const registration = registrationFixture()
    await expect(registration.navigate('/object/pending')).rejects.toThrow('registration is not active')
    expect(screen.getByLabelText('Current location')).toHaveTextContent(/^\/$/)

    registration.acknowledge()
    await registration.handle.acknowledged
    await act(async () => {
      await expect(registration.navigate('/object/example')).resolves.toMatchObject({
        navigated: true,
        path: '/object/example',
        routeId: 'knowledge.object-detail',
      })
    })
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/object/example')
    const historyLength = window.history.length

    registration.handle()
    registration.handle()
    await expect(registration.navigate('/object/stale')).rejects.toThrow('registration is not active')
    expect(window.history.length).toBe(historyLength)
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/object/example')
  })

  it('refuses failed registrations and late acknowledgements after cleanup', async () => {
    const failed = registrationFixture()
    failed.reject(new Error('registration refused'))
    await failed.handle.acknowledged
    await expect(failed.navigate('/object/failed')).rejects.toThrow('registration is not active')

    const retired = registrationFixture()
    retired.handle()
    retired.acknowledge()
    await retired.handle.acknowledged
    await expect(retired.navigate('/object/late')).rejects.toThrow('registration is not active')
    expect(window.location.pathname).toBe('/')
  })

  it('preserves role, path and execution-cancellation checks for active callbacks', async () => {
    const registration = registrationFixture()
    registration.acknowledge()
    await registration.handle.acknowledged
    const controller = new AbortController()
    controller.abort()
    await expect(registration.navigate('/object/cancelled', controller.signal)).rejects.toThrow('cancelled')
    await expect(registration.navigate('/workflows')).rejects.toThrow('not permitted')
    await expect(registration.navigate('//outside.test')).rejects.toThrow()
    expect(window.location.pathname).toBe('/')
    registration.handle()
  })
})
