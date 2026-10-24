// spec: WEBUI-DESIGN-R002.1
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { WorkspaceFrame } from '../WorkspaceFrame'
import { WorkspaceCommandsProvider, useWorkspaceCommandNavigation } from '../WorkspaceCommands'

let catalog: ReturnType<typeof useWorkspaceCommandNavigation>
function Capture() {
  catalog = useWorkspaceCommandNavigation()
  return null
}
function Surface({ owner = 'one', enabled = true }: { owner?: string; enabled?: boolean }) {
  return (
    <WorkspaceCommandsProvider owner={owner} role="maintainer" enabled={enabled}>
      <Capture />
      <WorkspaceFrame enabled={enabled}>
        <textarea aria-label="Retained draft" defaultValue="draft" />
      </WorkspaceFrame>
    </WorkspaceCommandsProvider>
  )
}
afterEach(() => {
  window.history.replaceState({}, '', '/')
})

it('retires callbacks when catalog ownership changes or the consumer unmounts', () => {
  window.history.replaceState({}, '', '/workspace/work')
  const view = render(<Surface />)
  const stale = catalog.select
  view.rerender(<Surface owner="two" />)
  expect(() => {
    stale('/workspace/explore')
  }).toThrow('stale or unavailable')
  expect(() => {
    catalog.select('/admin')
  }).toThrow('stale or unavailable')
  const live = catalog.select
  act(() => {
    live('/workspace/explore')
  })
  expect(window.location.pathname).toBe('/workspace/explore')
  expect(() => {
    live('/workspace/work')
  }).toThrow('stale or unavailable')
  const retired = catalog.select
  view.unmount()
  expect(() => {
    retired('/workspace/work')
  }).toThrow('stale or unavailable')
})

it('retains native task DOM and draft through map visibility and legacy layout changes', () => {
  window.history.replaceState({}, '', '/workspace/work')
  const view = render(<Surface />)
  const draft = screen.getByRole('textbox', { name: 'Retained draft' })
  fireEvent.change(draft, { target: { value: 'unsent work' } })
  fireEvent.click(screen.getByRole('button', { name: 'Hide map' }))
  expect(screen.queryByRole('complementary', { name: 'Workspace map' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Focus map' }))
  expect(screen.getByRole('heading', { name: 'Workspace navigation' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Focus current task' }))
  expect(screen.getByRole('region', { name: 'Current workspace task' })).toHaveFocus()
  view.rerender(<Surface enabled={false} />)
  expect(screen.getByRole('textbox', { name: 'Retained draft' })).toBe(draft)
  expect(draft).toHaveValue('unsent work')
  view.rerender(<Surface />)
  expect(screen.getByRole('textbox', { name: 'Retained draft' })).toBe(draft)
  expect(draft).toHaveValue('unsent work')
})
