import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SchemaActionForm } from '../SchemaActionForm'
import type { PageContextEnvelope } from '@/lib/page-context'

const context: PageContextEnvelope = {
  schemaVersion: '1.0',
  route: '/skills',
  view: 'skills',
  selection: [],
  filters: {},
  allowedActions: [],
  capturedAt: '2026-09-26T00:00:00Z',
}

describe('SchemaActionForm accessibility', () => {
  it('links a validation error and help text to its input', () => {
    const onSubmit = vi.fn()
    render(
      <SchemaActionForm
        schema={{
          type: 'object',
          properties: {
            target: { type: 'string', title: 'Target', description: 'Select a target.' },
            use_cache: { type: 'boolean', title: 'Use cache', description: 'Reuse previous results.' },
          },
          required: ['target'],
        }}
        context={context}
        onSubmit={onSubmit}
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Use cache' })
    expect(checkbox).toHaveAttribute('aria-describedby')
    const checkboxDescription = checkbox.getAttribute('aria-describedby')
    expect(document.getElementById(checkboxDescription ?? '')).toHaveTextContent('Reuse previous results.')

    fireEvent.click(screen.getByRole('button', { name: 'Review preflight' }))
    const input = screen.getByRole('textbox', { name: /Target/ })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const descriptionIds = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(descriptionIds).toHaveLength(2)
    expect(document.getElementById(descriptionIds[0])).toHaveTextContent('Select a target.')
    expect(document.getElementById(descriptionIds[1])).toHaveTextContent('Required value is missing')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
