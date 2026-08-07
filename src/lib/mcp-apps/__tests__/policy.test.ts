import { describe, expect, it } from 'vitest'

import { buildFrameSrcDoc, resolveFramePolicy } from '../policy'
import type { McpUiMeta } from '../types'

describe('resolveFramePolicy', () => {
  it('only keeps declared domains the host allow-list also contains', () => {
    const meta: McpUiMeta = {
      resourceUri: 'ui://x',
      csp: {
        connectDomains: ['https://trusted.example', 'https://evil.example'],
        resourceDomains: ['https://trusted.example'],
      },
    }
    const resolved = resolveFramePolicy(meta, ['https://trusted.example'])
    expect(resolved.connectDomains).toEqual(['https://trusted.example'])
    expect(resolved.resourceDomains).toEqual(['https://trusted.example'])
    expect(resolved.frameDomains).toEqual([])
  })

  it('grants nothing when the host allow-list is empty, regardless of what the server declares', () => {
    const meta: McpUiMeta = {
      resourceUri: 'ui://x',
      csp: { connectDomains: ['https://anything.example'] },
    }
    const resolved = resolveFramePolicy(meta, [])
    expect(resolved.connectDomains).toEqual([])
  })

  it('handles no declared csp at all', () => {
    const resolved = resolveFramePolicy({ resourceUri: 'ui://x' }, ['https://trusted.example'])
    expect(resolved).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [] })
  })
})

describe('buildFrameSrcDoc', () => {
  it('injects a CSP meta tag into an existing <head>', () => {
    const html = '<html><head><title>x</title></head><body>hi</body></html>'
    const out = buildFrameSrcDoc(html, { connectDomains: [], resourceDomains: [], frameDomains: [] })
    expect(out).toContain('<meta http-equiv="Content-Security-Policy"')
    expect(out.indexOf('<meta http-equiv="Content-Security-Policy"')).toBeLessThan(out.indexOf('<title>'))
  })

  it('wraps bare HTML fragments with a head containing the CSP', () => {
    const out = buildFrameSrcDoc('<p>hi</p>', { connectDomains: [], resourceDomains: [], frameDomains: [] })
    expect(out).toContain('<head><meta http-equiv="Content-Security-Policy"')
    expect(out).toContain('<p>hi</p>')
  })

  it('reflects only the resolved (host-enforced) domains, defaulting to none', () => {
    const out = buildFrameSrcDoc('<head></head>', {
      connectDomains: ['https://trusted.example'],
      resourceDomains: [],
      frameDomains: [],
    })
    expect(out).toContain('connect-src https://trusted.example')
    expect(out).toContain("frame-src 'none'")
  })
})
