// spec: OVERSTORY-APPS-R049.1.3
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ACTIVE_CONVERSATION_STORAGE_KEY, useConversationIdFromUrl } from './useConversationIdFromUrl'
function Session({ name }: { name: string }) {
  const [id, setId] = useConversationIdFromUrl()
  return (
    <div>
      <output aria-label={name}>{id}</output>
      <button
        onClick={() => {
          setId('/')
        }}
      >
        Clear {name}
      </button>
    </div>
  )
}
afterEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})
describe('Work conversation continuity', () => {
  it('updates both mounted consumers after URL mutation without reviving the cleared session', () => {
    window.history.replaceState({}, '', '/workspace/work?conversation=previous&task=task-a&run=trace-a')
    render(
      <>
        <Session name="assistant" />
        <Session name="workspace" />
      </>,
    )
    expect(screen.getByLabelText('assistant')).toHaveTextContent('/previous')
    fireEvent.click(screen.getByRole('button', { name: 'Clear assistant' }))
    expect(screen.getByLabelText('assistant').textContent).toBe('/')
    expect(screen.getByLabelText('workspace').textContent).toBe('/')
    expect(localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBeNull()
    expect(window.location.search).toBe('?task=task-a&run=trace-a')
    act(() => {
      window.history.replaceState({}, '', '/workspace/work?conversation=previous&task=task-a')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByLabelText('workspace')).toHaveTextContent('/previous')
  })
})
