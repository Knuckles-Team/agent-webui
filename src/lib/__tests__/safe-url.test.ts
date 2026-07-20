import { describe, expect, it } from 'vitest'

import { safeExternalUrl } from '../safe-url'

describe('safeExternalUrl', () => {
  it('accepts and canonicalizes ordinary HTTP(S) links', () => {
    expect(safeExternalUrl(' https://example.test/docs?q=1 ')).toBe('https://example.test/docs?q=1')
    expect(safeExternalUrl('http://example.test')).toBe('http://example.test/')
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'https://user:secret@example.test/',
    '/relative/path',
    'https://example.test/\nnext',
  ])('rejects an unsafe navigation target: %s', (value) => {
    expect(safeExternalUrl(value)).toBeUndefined()
  })
})
