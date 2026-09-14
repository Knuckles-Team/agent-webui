import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const GATE = resolve(ROOT, 'scripts/check-site-config.mjs')

function gateEnvironment(): Record<string, string | undefined> {
  return {
    ...process.env,
    VITE_SITE_INDEXABLE: 'true',
    VITE_SITE_ORIGIN: 'https://agents.example.invalid',
    VITE_OG_IMAGE_PATH: '/og-image-v1.png',
    VITE_LEGAL_OWNER: 'Configured Owner',
    VITE_LEGAL_CONTACT_ADDRESS: '1 Reviewed Way, Example City',
    VITE_LEGAL_CONTACT_EMAIL: 'owner@example.invalid',
    VITE_LEGAL_EFFECTIVE_DATE: '2026-09-14',
    VITE_LEGAL_REVISION: 'privacy-terms-1',
    VITE_PRIVACY_POLICY_TEXT: 'Reviewed privacy policy.',
    VITE_TERMS_TEXT: 'Reviewed terms.',
  }
}

describe('site config release gate wiring', () => {
  it('build invokes the dedicated gate that imports the runtime validator', () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: { build: string; 'site:config:check': string }
    }
    const gateSource = readFileSync(GATE, 'utf8')
    expect(packageJson.scripts['site:config:check']).toContain('check-site-config.mjs')
    expect(packageJson.scripts.build).toContain('pnpm run site:config:check')
    expect(gateSource).toContain('../src/lib/site-config.ts')
    expect(gateSource).toContain('validateSiteConfig')
  })

  it('executes the real validator successfully with reviewed release configuration', () => {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', GATE], {
      cwd: ROOT,
      env: gateEnvironment(),
      encoding: 'utf8',
    })
    expect(output).toContain('site config check passed')
  })
})
