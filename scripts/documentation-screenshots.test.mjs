// spec: WEBUI-DESIGN-R011
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { validateCapture, readCaptures } from './documentation-screenshots.mjs'
import { captures, responses, fixture, fixedTime, theme, baseURL } from '../e2e/fixtures/documentation-screenshots.mjs'

test('captures exactly the three contexts at the existing wide and narrow viewports', () => {
  assert.deepEqual(
    captures.map((capture) => capture.file),
    [
      'work-wide.png',
      'work-narrow.png',
      'explore-wide.png',
      'explore-narrow.png',
      'operate-wide.png',
      'operate-narrow.png',
    ],
  )
  assert.equal(new URL(baseURL).hostname, '127.0.0.1')
  for (const capture of captures) assert.ok(capture.path.startsWith('/workspace/'))
  assert.equal(responses['/auth/session'].tenant, 'synthetic')
  assert.equal(responses['/auth/session'].csrf_token, fixture)
  assert.deepEqual(responses['/api/enhanced/mcp/servers/arbora/tools'], {
    tools: [],
    total: 0,
    offset: 0,
    limit: 200,
    has_more: false,
  })
  assert.equal(responses['/api/dashboard/readiness'].observed_at, fixedTime)
})

test('manifest binds image bytes, dimensions, fixture and exact source revision', async () => {
  // Use an existing real screenshot; no generated pixels enter documentation.
  const bytes = await readFile(new URL('../docs/assets/screenshots/atlas-workspace.png', import.meta.url))
  const viewport = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  const capture = { file: 'test.png', path: '/workspace/explore', viewport }
  const record = {
    ...capture,
    fixture,
    fixedTime,
    theme,
    sourceRevision: 'a'.repeat(40),
    sourceDirty: false,
    deviceScaleFactor: 1,
    browser: 'Chromium 1',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  validateCapture(record, bytes, capture)
  for (const change of [
    { file: '../outside.png' },
    { path: 'https://example.org' },
    { fixture: 'live' },
    { sourceRevision: 'main' },
    { sha256: '0'.repeat(64) },
    { viewport: { width: 1, height: 1 } },
  ])
    assert.throws(() => validateCapture({ ...record, ...change }, bytes, capture))
  assert.throws(() => validateCapture(record, Buffer.from('not an image'), capture))
})

test('incomplete and duplicate captures cannot replace the published set', async () => {
  await assert.rejects(readCaptures('/unused', []), /Incomplete screenshot set/)
  await assert.rejects(readCaptures('/unused', Array(6).fill({ file: 'work-wide.png' })), /Duplicate screenshot/)
})
