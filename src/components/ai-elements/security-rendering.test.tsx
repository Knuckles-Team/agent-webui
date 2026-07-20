import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SAFE_MERMAID_OPTIONS } from './response'
import { Source } from './sources'
import { WEB_PREVIEW_SANDBOX } from './web-preview'

describe('untrusted URL rendering', () => {
  it('renders an unsafe source without a navigable href', () => {
    render(<Source href="javascript:alert(1)" title="Untrusted source" />)

    const source = screen.getByTitle('Untrusted source')
    expect(source).not.toHaveAttribute('href')
    expect(source).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps preview documents on an opaque sandbox origin', () => {
    expect(WEB_PREVIEW_SANDBOX).toBe('allow-scripts allow-forms allow-presentation')
    expect(WEB_PREVIEW_SANDBOX).not.toContain('allow-same-origin')
    expect(WEB_PREVIEW_SANDBOX).not.toContain('allow-popups')
  })

  it('keeps model-authored Mermaid diagrams in strict mode', () => {
    expect(SAFE_MERMAID_OPTIONS.config?.securityLevel).toBe('strict')
  })
})
