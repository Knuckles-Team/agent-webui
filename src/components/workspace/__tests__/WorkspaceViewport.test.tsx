// spec: OVERSTORY-DESIGN-R004.2.1
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceViewport } from '../WorkspaceViewport'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('retains draft, selection and focus through visual viewport changes, without reflowing pinch zoom', () => {
  vi.useFakeTimers()
  const viewport = Object.assign(new EventTarget(), { height: 700, scale: 1 })
  vi.stubGlobal('visualViewport', viewport)
  const reveal = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
  const { container, unmount } = render(
    <WorkspaceViewport enabled>
      <textarea aria-label="Draft" defaultValue="Retained draft" />
    </WorkspaceViewport>,
  )
  const draft = screen.getByRole('textbox') as HTMLTextAreaElement
  draft.focus()
  draft.setSelectionRange(2, 5)
  viewport.height = 280
  act(() => {
    viewport.dispatchEvent(new Event('resize'))
    vi.runAllTimers()
  })
  expect(container.firstElementChild).toHaveStyle('--workspace-visible-height: 280px')
  expect(screen.getByRole('textbox')).toBe(draft)
  expect(draft).toHaveFocus()
  expect(draft).toHaveValue('Retained draft')
  expect([draft.selectionStart, draft.selectionEnd]).toEqual([2, 5])
  expect(reveal).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  reveal.mockClear()
  viewport.scale = 2
  viewport.height = 140
  act(() => {
    viewport.dispatchEvent(new Event('resize'))
    vi.runAllTimers()
  })
  expect(container.firstElementChild).toHaveStyle('--workspace-visible-height: 280px')
  expect(reveal).not.toHaveBeenCalled()
  unmount()
  viewport.scale = 1
  act(() => {
    viewport.dispatchEvent(new Event('resize'))
    vi.runAllTimers()
  })
  expect(reveal).not.toHaveBeenCalled()
})

it('leaves other surfaces alone and supports browsers without VisualViewport', () => {
  vi.useFakeTimers()
  vi.stubGlobal('visualViewport', undefined)
  const reveal = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
  const { container, rerender } = render(
    <WorkspaceViewport enabled={false}>
      <input aria-label="Draft" />
    </WorkspaceViewport>,
  )
  fireEvent.focusIn(screen.getByRole('textbox'))
  act(() => {
    window.dispatchEvent(new Event('resize'))
    vi.runAllTimers()
  })
  expect(reveal).not.toHaveBeenCalled()
  expect(container.firstElementChild).toHaveClass('overflow-auto')
  rerender(
    <WorkspaceViewport enabled>
      <input aria-label="Draft" />
    </WorkspaceViewport>,
  )
  screen.getByRole('textbox').focus()
  act(() => {
    window.dispatchEvent(new Event('resize'))
    vi.runAllTimers()
  })
  expect(container.firstElementChild).toHaveClass('workspace-viewport')
  expect(reveal).toHaveBeenCalled()
})
