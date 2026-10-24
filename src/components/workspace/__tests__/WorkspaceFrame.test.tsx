// spec: WEBUI-DESIGN-R002.1
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceHeaderDisclosure } from '../WorkspaceHeaderDisclosure'
import { WorkspaceMapResize } from '../WorkspaceMapResize'
import { useWorkspaceMapWidth } from '../useWorkspaceMapWidth'
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
      <div key={owner}>
        <div id="workspace-map-toggle-slot" />
        <div id="workspace-frame-tools-slot" />
      </div>
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
  expect(screen.getAllByRole('button', { name: 'Show map' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: 'Focus map' })).toHaveLength(1)
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
  expect(screen.queryByRole('complementary', { name: 'Workspace map' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show map' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide map' }))
  expect(screen.queryByRole('complementary', { name: 'Workspace map' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Focus map' }))
  expect(screen.getByRole('searchbox', { name: 'Filter loaded destinations' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Focus current task' }))
  expect(screen.getByRole('region', { name: 'Current workspace task' })).toHaveFocus()
  view.rerender(<Surface enabled={false} />)
  expect(screen.queryByRole('button', { name: 'Focus map' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Retained draft' })).toBe(draft)
  expect(draft).toHaveValue('unsent work')
  view.rerender(<Surface />)
  expect(screen.getByRole('textbox', { name: 'Retained draft' })).toBe(draft)
  expect(draft).toHaveValue('unsent work')
})

function ResizeSurface() {
  const width = useWorkspaceMapWidth(null)
  return <WorkspaceMapResize control={width} />
}

it.each([
  ['not-a-number', 14],
  ['Infinity', 14],
  ['100', 22],
  ['1', 12],
])('bounds stored map width %s and persists keyboard resizing', (saved, expected) => {
  localStorage.setItem('agent-webui.workspace-map-width', saved)
  render(<ResizeSurface />)
  const separator = screen.getByRole('separator', { name: 'Resize workspace map' })
  expect(separator).toHaveAttribute('aria-valuenow', String(expected))
  fireEvent.keyDown(separator, { key: 'Home' })
  expect(separator).toHaveAttribute('aria-valuenow', '12')
  fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true })
  expect(separator).toHaveAttribute('aria-valuenow', '14')
  expect(localStorage.getItem('agent-webui.workspace-map-width')).toBe('14')
  fireEvent.keyDown(separator, { key: 'End' })
  expect(separator).toHaveAttribute('aria-valuenow', '22')
  localStorage.removeItem('agent-webui.workspace-map-width')
})

it('retains keyboard resizing when preference storage is unavailable', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('unavailable')
  })
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('unavailable')
  })
  try {
    render(<ResizeSurface />)
    const separator = screen.getByRole('separator')
    expect(separator).toHaveAttribute('aria-valuenow', '14')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator).toHaveAttribute('aria-valuenow', '15')
  } finally {
    read.mockRestore()
    write.mockRestore()
  }
})

it('keeps compact context disclosure open for disabled and modified links', () => {
  render(
    <WorkspaceHeaderDisclosure id="test-context" label="Context" caption="Context">
      <a
        href="#unavailable"
        aria-disabled="true"
        onClick={(event) => {
          event.preventDefault()
        }}
      >
        Unavailable
      </a>
      <a
        href="#available"
        onClick={(event) => {
          event.preventDefault()
        }}
      >
        Available
      </a>
    </WorkspaceHeaderDisclosure>,
  )
  const trigger = screen.getByRole('button', { name: 'Context' })
  fireEvent.click(trigger)
  const unavailable = screen.getByRole('link', { name: 'Unavailable' })
  unavailable.focus()
  fireEvent.click(unavailable)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(unavailable).toHaveFocus()
  fireEvent.click(screen.getByRole('link', { name: 'Available' }), { ctrlKey: true })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
})

// spec: WEBUI-DESIGN-R004.1.1
it('reflows the automatic map default but preserves an explicit expansion and retained task', () => {
  let wide = true
  const media = Object.assign(new EventTarget(), {
    get matches() {
      return wide
    },
  })
  Object.defineProperty(media, 'matches', { get: () => wide })
  const original = window.matchMedia
  const match = vi
    .spyOn(window, 'matchMedia')
    .mockImplementation((query) => (query === '(min-width: 64rem)' ? (media as MediaQueryList) : original(query)))
  try {
    render(<Surface />)
    const draft = screen.getByRole('textbox', { name: 'Retained draft' })
    expect(screen.getByRole('button', { name: 'Hide map' })).toBeInTheDocument()
    act(() => {
      wide = false
      media.dispatchEvent(new Event('change'))
    })
    expect(screen.getByRole('button', { name: 'Show map' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Retained draft' })).toBe(draft)
    act(() => {
      wide = true
      media.dispatchEvent(new Event('change'))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Focus map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus current task' }))
    act(() => {
      wide = false
      media.dispatchEvent(new Event('change'))
    })
    expect(screen.getByRole('button', { name: 'Hide map' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus map' }))
    expect(screen.getByRole('searchbox')).toHaveFocus()
    act(() => {
      wide = true
      media.dispatchEvent(new Event('change'))
    })
    act(() => {
      wide = false
      media.dispatchEvent(new Event('change'))
    })
    expect(screen.getByRole('button', { name: 'Hide map' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveFocus()
  } finally {
    match.mockRestore()
  }
})
