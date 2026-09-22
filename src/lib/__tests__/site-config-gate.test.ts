import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const GATE = resolve(ROOT, 'scripts/check-site-config.mjs')

const PUBLICATION_VARIABLES = [
  'VITE_SITE_INDEXABLE',
  'VITE_INDEXABLE_ENVIRONMENT',
  'VITE_SITE_ORIGIN',
  'VITE_OG_IMAGE_PATH',
  'VITE_LEGAL_OWNER',
  'VITE_LEGAL_CONTACT_ADDRESS',
  'VITE_LEGAL_CONTACT_EMAIL',
  'VITE_LEGAL_EFFECTIVE_DATE',
  'VITE_LEGAL_REVISION',
  'VITE_PRIVACY_POLICY_TEXT',
  'VITE_TERMS_TEXT',
] as const
const PUBLICATION_VARIABLE_SET = new Set<string>(PUBLICATION_VARIABLES)

function gateEnvironment(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  const values = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !PUBLICATION_VARIABLE_SET.has(name)),
  )
  return { ...values, ...overrides }
}

function publicGateEnvironment(): Record<string, string | undefined> {
  return gateEnvironment({
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
  })
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

  it('allows the default safe noindex build without public or legal metadata', () => {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', GATE], {
      cwd: ROOT,
      env: gateEnvironment(),
      encoding: 'utf8',
    })
    expect(output).toContain('safe noindex mode')
  })

  it('executes the real validator successfully with reviewed public release configuration', () => {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', GATE], {
      cwd: ROOT,
      env: publicGateEnvironment(),
      encoding: 'utf8',
    })
    expect(output).toContain('public origin, legal identity, and reviewed content configured')
  })

  it('fails closed when public mode omits legal identity and reviewed policy text', () => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', GATE], {
      cwd: ROOT,
      env: gateEnvironment({
        VITE_SITE_INDEXABLE: 'true',
        VITE_SITE_ORIGIN: 'https://agents.example.invalid',
      }),
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('VITE_LEGAL_OWNER')
    expect(result.stderr).toContain('VITE_PRIVACY_POLICY_TEXT')
    expect(result.stderr).toContain('VITE_TERMS_TEXT')
  })
})
