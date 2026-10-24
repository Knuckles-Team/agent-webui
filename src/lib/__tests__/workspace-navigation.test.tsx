// spec: WEBUI-APPS-R046.1
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeWorkspaceDestination, navigateWorkspace, useWorkspaceLocation } from '../workspace-navigation'
import { navigateWithinWebUi } from '../webmcp/navigation'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

describe('shared workspace navigation', () => {
  it('uses the exact same dispatcher for browser controls and WebMCP', () => {
    expect(navigateWithinWebUi).toBe(navigateWorkspace)
    const { result } = renderHook(() => useWorkspaceLocation())
    act(() => {
      navigateWorkspace('/chat', 'user')
    })
    expect(result.current).toBe('/chat')
    act(() => {
      navigateWithinWebUi('/object/example', 'reader')
    })
    expect(result.current).toBe('/object/example')
    expect(describeWorkspaceDestination(result.current)).toMatchObject({
      routeId: 'knowledge.object-detail',
      parameters: { id: 'example' },
    })
  })

  it('observes existing conversation query links and history traversal without a second router', () => {
    const { result } = renderHook(() => useWorkspaceLocation())
    act(() => {
      window.history.pushState({}, '', '/chat?conversation=existing-id')
      window.dispatchEvent(new Event('history-state-changed'))
    })
    expect(result.current).toBe('/chat?conversation=existing-id')
    act(() => {
      window.history.replaceState({}, '', '/explore')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current).toBe('/explore')
  })

  it.each([
    '//outside.test',
    'https://outside.test',
    '/explore?token=secret',
    '/explore#state',
    '/?token=secret',
    '/prompts?lens=prompts',
    '/not-a-route',
  ])('rejects unsafe or unknown target %s without history writes', (path) => {
    const push = vi.spyOn(window.history, 'pushState')
    expect(() => navigateWorkspace(path, 'admin')).toThrow()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not let human navigation bypass the tool role boundary', () => {
    expect(() => navigateWorkspace('/workflows', 'reader')).toThrow('not permitted')
  })
})

// spec: WEBUI-APPS-R049.1.2
it.each([
  ['/', 'user', '/workspace/work', 'workspace.work-proof'],
  ['/', 'reader', '/workspace/operate', 'workspace.operate'],
  ['/prompts', 'admin', '/workspace/work?lens=prompts', 'workspace.work-proof'],
  ['/overview', 'reader', '/overview', 'observability.dashboard'],
] as const)('shares canonical manual/tool entry %s for %s', (path, role, expected, routeId) => {
  expect(navigateWorkspace(path, role)).toMatchObject({ path: expected, routeId })
  expect(`${window.location.pathname}${window.location.search}`).toBe(expected)
  expect(navigateWithinWebUi(path, role)).toMatchObject({ path: expected, routeId })
})
it('retains source role admission for compatibility links', () => {
  const push = vi.spyOn(window.history, 'pushState')
  expect(() => navigateWorkspace('/prompts', 'user')).toThrow('not permitted')
  expect(push).not.toHaveBeenCalled()
})
