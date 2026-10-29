// spec: OVERSTORY-DESIGN-R011
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
    { theme: 'dark' },
    { deviceScaleFactor: 2 },
    { sourceDirty: 'false' },
    { browser: 'Firefox 1' },
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

test('lossless delivery retains original provenance and verifies decoded pixels', async () => {
  const { prepareDelivery, validateDelivered } = await import('./documentation-screenshots.mjs')
  const bytes = await readFile(new URL('../docs/assets/screenshots/atlas-workspace.png', import.meta.url))
  const viewport = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  const capture = { file: 'explore-wide.png', path: '/workspace/explore', viewport }
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
  const prepared = prepareDelivery(record, bytes, capture)
  assert.equal(prepared.record.file, record.file)
  assert.equal(prepared.record.sha256, record.sha256)
  assert.equal(prepared.record.sourceRevision, record.sourceRevision)
  assert.equal(prepared.record.delivery.file, 'explore-wide.webp')
  assert.equal(prepared.record.delivery.encoding, 'lossless-webp')
  assert.equal(prepared.record.delivery.optimizer.pillow, '12.3.0')
  validateDelivered(prepared.record, prepared.bytes, capture)
  for (const change of [
    { sha256: '0'.repeat(64) },
    { rgbaSha256: '0'.repeat(64) },
    { encoding: 'lossy-webp' },
    { file: '../escape.webp' },
    { optimizer: { pillow: '0', libwebp: '0' } },
  ])
    assert.throws(() =>
      validateDelivered(
        { ...prepared.record, delivery: { ...prepared.record.delivery, ...change } },
        prepared.bytes,
        capture,
      ),
    )
  assert.throws(() => validateDelivered({ ...prepared.record, sourceRevision: 'main' }, prepared.bytes, capture))
  assert.throws(() => validateDelivered(prepared.record, Buffer.alloc(1_000_001), capture), /storage budget/)
  const lossy = Buffer.from(prepared.bytes)
  lossy.write('VP8 ', 12)
  assert.throws(() =>
    validateDelivered(
      {
        ...prepared.record,
        delivery: { ...prepared.record.delivery, sha256: createHash('sha256').update(lossy).digest('hex') },
      },
      lossy,
      capture,
    ),
  )
  assert.throws(() => prepareDelivery(record, bytes, capture, '/missing/screenshot-python'), /optimizer unavailable/)
})

test('incomplete import leaves the published set untouched', async () => {
  const { mkdtemp, writeFile, rm, readdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { importCaptures } = await import('./documentation-screenshots.mjs')
  const folder = await mkdtemp(join(tmpdir(), 'screenshot-import-'))
  try {
    await writeFile(join(folder, 'keep.txt'), 'published')
    await assert.rejects(importCaptures('/missing/source-artifact', folder))
    assert.deepEqual(await readdir(folder), ['keep.txt'])
    assert.equal(await readFile(join(folder, 'keep.txt'), 'utf8'), 'published')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
