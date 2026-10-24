import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captures, fixture, fixedTime, theme } from '../e2e/fixtures/documentation-screenshots.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export const output = join(root, 'docs/assets/screenshots')
const staging = join(root, 'test-results/documentation-screenshots')

export function validateCapture(record, bytes, capture) {
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

async function main(command) {
  if (command === 'check') {
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest.schemaVersion, 1)
    await readCaptures(output, manifest.captures)
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
    const records = await Promise.all(
      captures.map((capture) =>
        readFile(join(directory, capture.file.replace('.png', '.json')), 'utf8').then(JSON.parse),
      ),
    )
    const manifest = await readCaptures(directory, records)
    await mkdir(output, { recursive: true })
    for (const capture of captures) await copyFile(join(directory, capture.file), join(output, capture.file))
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  } else {
    throw new Error('Usage: node scripts/documentation-screenshots.mjs refresh|check|import <artifact-directory>')
  }
  console.log(`Documentation screenshots ${command}: ${captures.length} verified PNG files.`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2])
}
