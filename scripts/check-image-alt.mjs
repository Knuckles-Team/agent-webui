/**
 * Static image accessibility gate.
 *
 * The TypeScript image wrappers enforce the value contract at their API
 * boundary. This complementary source check catches a future raw JSX image
 * element that bypasses those wrappers, while allowing the explicit
 * decorative form (`alt=""` plus `decorative`/presentation semantics).
 * Tests are excluded because hostile strings in security tests intentionally
 * contain literal `<img` snippets that are not JSX elements.
 */
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'))
const SOURCE_ROOT = join(ROOT, 'src')
const IMAGE_TAGS = ['img', 'AccessibleImage', 'Image', 'ExperimentalGeneratedImage', 'AvatarImage']
const errors = []

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') files.push(...(await sourceFiles(path)))
    } else if (extname(entry.name) === '.tsx' && !entry.name.endsWith('.test.tsx')) {
      files.push(path)
    }
  }
  return files
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function checkOpeningTag(source, path, tag, offset, opening) {
  const label = `${relative(ROOT, path)}:${lineNumber(source, offset)} <${tag}>`
  if (tag === 'ExperimentalGeneratedImage') {
    if (!/\balt\s*[:=]/.test(opening)) errors.push(`${label} must provide image alt text`)
    return
  }

  if (!/\balt\s*=/.test(opening)) {
    errors.push(`${label} is missing alt text`)
    return
  }

  if (/\balt\s*=\s*["']{2}/.test(opening)) {
    const explicitDecoration =
      /\bdecorative(?:\s*=\s*(?:\{\s*true\s*\}|["']true["']))?/.test(opening) ||
      /\baria-hidden\s*=\s*["']true["']/.test(opening) ||
      /\brole\s*=\s*["']presentation["']/.test(opening)
    if (!explicitDecoration) errors.push(`${label} uses empty alt without explicit decorative semantics`)
  }
}

const files = await sourceFiles(SOURCE_ROOT)
for (const path of files) {
  const source = await readFile(path, 'utf8')
  for (const tag of IMAGE_TAGS) {
    const pattern = new RegExp(`<${tag}\\b[\\s\\S]*?>`, 'g')
    for (const match of source.matchAll(pattern)) {
      checkOpeningTag(source, path, tag, match.index ?? 0, match[0])
    }
  }
}

if (errors.length > 0) {
  console.error(`image alt check failed (${errors.length} issue(s))`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`image alt check passed (${files.length} TSX source file(s) scanned)`)
}
