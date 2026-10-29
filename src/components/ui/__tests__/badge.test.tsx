import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PromptInputSubmit } from '@/components/ai-elements/prompt-input'
import { Input } from '@/components/ui/input'

// spec: OVERSTORY-DESIGN-R002.1.1
it('pairs destructive badge fills with the theme foreground without an alpha override', () => {
  render(<Badge variant="destructive">Failed</Badge>)
  const badge = screen.getByText('Failed')
  expect(badge).toHaveClass('bg-destructive', 'text-destructive-foreground')
  expect(badge).not.toHaveClass('text-white', 'dark:bg-destructive/60')
})

// spec: OVERSTORY-DESIGN-R002.1.1
it('keeps disabled control text on solid semantic surfaces without enabling input', () => {
  render(
    <>
      <Button disabled variant="destructive">
        Delete
      </Button>
      <Input disabled aria-label="Unavailable field" />
    </>,
  )
  for (const control of [screen.getByRole('button', { name: 'Delete' }), screen.getByRole('textbox')]) {
    expect(control).toBeDisabled()
    expect(control).toHaveClass('disabled:bg-muted', 'disabled:text-muted-foreground')
    expect(control).not.toHaveClass('disabled:opacity-50')
  }
})

it('uses the shared translucent primary token and paired foreground for chat submission', () => {
  render(<PromptInputSubmit aria-label="Send" />)
  const send = screen.getByRole('button', { name: 'Send' })
  expect(send).toHaveClass('bg-[var(--button-primary)]', 'text-primary-foreground')
  expect(send).not.toHaveClass('bg-pydantic-brand', 'text-white')
})
