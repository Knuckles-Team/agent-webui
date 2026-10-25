import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captures, fixture, fixedTime, theme } from '../e2e/fixtures/documentation-screenshots.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export const output = join(root, 'docs/assets/screenshots')
const staging = join(root, 'test-results/documentation-screenshots')
export const maxImageBytes = 1_000_000
const encodedFile = (capture) => (capture.file === 'explore-wide.png' ? 'explore-wide.webp' : capture.file)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function validateMetadata(record, capture) {
  assert.equal(record.file, capture.file, 'Unexpected screenshot path')
  assert.equal(record.path, capture.path, 'Unexpected application route')
  assert.deepEqual(record.viewport, { width: capture.viewport.width, height: capture.viewport.height })
  assert.equal(record.theme, theme)
  assert.equal(record.fixture, fixture)
  assert.equal(record.fixedTime, fixedTime)
  assert.equal(record.deviceScaleFactor, 1)
  assert.match(record.sourceRevision, /^[a-f0-9]{40}$/)
  assert.equal(typeof record.sourceDirty, 'boolean')
  assert.match(record.browser, /^Chromium \d/)
}

export function validateCapture(record, bytes, capture) {
  validateMetadata(record, capture)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Not a PNG screenshot')
  assert.equal(bytes.readUInt32BE(16), record.viewport.width, 'Wrong screenshot width')
  assert.equal(bytes.readUInt32BE(20), record.viewport.height, 'Wrong screenshot height')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, 'Screenshot digest mismatch')
}

export async function readCaptures(directory, records) {
  assert.equal(records.length, captures.length, 'Incomplete screenshot set')
  assert.equal(new Set(records.map((record) => record.file)).size, captures.length, 'Duplicate screenshot')
  for (const capture of captures) {
    const record = records.find((item) => item.file === capture.file)
    assert.ok(record, `Missing ${capture.file}`)
    validateCapture(record, await readFile(join(directory, capture.file)), capture)
  }
  assert.equal(new Set(records.map((record) => record.sourceRevision)).size, 1, 'Mixed source revisions')
  return { schemaVersion: 1, captures: records }
}

function encodingHelper(command, bytes, python = process.env.SCREENSHOT_PYTHON ?? 'python3') {
  const child = spawnSync(python, [join(root, 'scripts/screenshot_encoding.py'), command], {
    input: bytes,
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(
    child.status,
    0,
    `Pinned screenshot optimizer unavailable or refused input: ${child.error ?? child.stderr}`,
  )
  return JSON.parse(child.stdout.toString('utf8'))
}

export function validateDelivered(record, bytes, capture, python) {
  validateMetadata(record, capture)
  assert.ok(bytes.length <= maxImageBytes, 'Screenshot exceeds one-million-byte storage budget')
  if (!record.delivery) {
    assert.equal(encodedFile(capture), capture.file, 'Missing lossless delivery provenance')
    validateCapture(record, bytes, capture)
    return
  }
  const delivery = record.delivery
  assert.equal(record.file, capture.file)
  assert.match(record.sha256, /^[a-f0-9]{64}$/)
  assert.equal(delivery.file, encodedFile(capture))
  assert.equal(delivery.file, 'explore-wide.webp')
  assert.equal(delivery.encoding, 'lossless-webp')
  assert.equal(delivery.optimizer.pillow, '12.3.0')
  assert.match(delivery.optimizer.libwebp, /^\d+\.\d+\.\d+$/)
  assert.equal(sha256(bytes), delivery.sha256, 'Delivered screenshot digest mismatch')
  // A single VP8L chunk proves lossless coding; reject lossy, animation or color chunks.
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF')
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8)
  assert.equal(bytes.subarray(8, 16).toString(), 'WEBPVP8L')
  const size = bytes.readUInt32LE(16)
  assert.equal(20 + size + (size % 2), bytes.length)
  assert.equal(bytes[20], 0x2f)
  const geometry = bytes.readUInt32LE(21)
  assert.equal((geometry & 0x3fff) + 1, capture.viewport.width)
  assert.equal(((geometry >>> 14) & 0x3fff) + 1, capture.viewport.height)
  const decoded = encodingHelper('inspect', bytes, python)
  assert.equal(decoded.width, capture.viewport.width)
  assert.equal(decoded.height, capture.viewport.height)
  assert.equal(decoded.rgbaSha256, delivery.rgbaSha256, 'Delivered screenshot pixels mismatch')
}

export function prepareDelivery(record, bytes, capture, python) {
  validateCapture(record, bytes, capture)
  if (encodedFile(capture) === capture.file) {
    validateDelivered(record, bytes, capture, python)
    return { record, bytes }
  }
  const encoded = encodingHelper('encode', bytes, python)
  const delivered = Buffer.from(encoded.bytes, 'base64')
  const next = {
    ...record,
    delivery: {
      file: encodedFile(capture),
      sha256: sha256(delivered),
      encoding: 'lossless-webp',
      rgbaSha256: encoded.rgbaSha256,
      optimizer: encoded.optimizer,
    },
  }
  validateDelivered(next, delivered, capture, python)
  return { record: next, bytes: delivered }
}

export async function importCaptures(directory, destination = output, python) {
  const records = await Promise.all(
    captures.map((capture) =>
      readFile(join(directory, capture.file.replace('.png', '.json')), 'utf8').then(JSON.parse),
    ),
  )
  await readCaptures(directory, records)
  // Validate and encode the complete set before touching the published directory.
  const prepared = await Promise.all(
    captures.map(async (capture) =>
      prepareDelivery(
        records.find((record) => record.file === capture.file),
        await readFile(join(directory, capture.file)),
        capture,
        python,
      ),
    ),
  )
  await mkdir(destination, { recursive: true })
  for (const item of prepared) {
    await writeFile(join(destination, item.record.delivery?.file ?? item.record.file), item.bytes)
  }
  await writeFile(
    join(destination, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        captures: prepared.map((item) => item.record),
      },
      null,
      2,
    )}\n`,
  )
  await rm(join(destination, 'explore-wide.png'), { force: true })
}

async function main(command) {
  if (command === 'check') {
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest.schemaVersion, 2)
    assert.equal(manifest.captures.length, captures.length)
    assert.equal(new Set(manifest.captures.map((record) => record.file)).size, captures.length)
    assert.equal(new Set(manifest.captures.map((record) => record.sourceRevision)).size, 1)
    for (const capture of captures) {
      const record = manifest.captures.find((item) => item.file === capture.file)
      assert.ok(record, `Missing ${capture.file}`)
      validateDelivered(record, await readFile(join(output, encodedFile(capture))), capture)
    }
  } else if (command === 'refresh' || command === 'import') {
    let directory = staging
    if (command === 'refresh') {
      // Only this isolated config runs; no live target or authentication setup.
      const child = spawnSync(
        'pnpm',
        ['exec', 'playwright', 'test', '--config', 'e2e/documentation-screenshots.config.ts'],
        { cwd: root, stdio: 'inherit', timeout: 600_000 },
      )
      assert.equal(child.status, 0, 'Capture failed; published documentation images were not changed')
    } else {
      assert.ok(process.argv[3], 'Supply the extracted documentation-screenshots artifact directory')
      directory = resolve(process.argv[3])
    }
    await importCaptures(directory)
  } else {
    throw new Error('Usage: node scripts/documentation-screenshots.mjs refresh|check|import <artifact-directory>')
  }
  console.log(`Documentation screenshots ${command}: ${captures.length} verified screenshot files.`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2])
}
