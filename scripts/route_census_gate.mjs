import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lintRouteCensus } from '../src/lib/arbora-api/route-census.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'agent/overstory/api_extensions.py')
const censusPath = resolve(root, 'src/lib/arbora-api/route-census.json')

try {
  const source = readFileSync(sourcePath, 'utf8')
  const census = JSON.parse(readFileSync(censusPath, 'utf8'))
  const entries = lintRouteCensus(source, census)
  console.log(`route census OK: ${entries.length} ${sourcePath}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
