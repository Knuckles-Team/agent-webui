/**
 * Release gate for consistent product branding (APP-01, WEBUI-APPS-R002).
 *
 * Confirms the browser-facing title/metadata/web manifest, the docs site
 * name, and the README all present the GraphOS product identity. This does
 * not check package, import, or environment naming — that is a separate,
 * larger identifier rename tracked by APP-02/WEBUI-APPS-R003.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const fail = (message) => errors.push(message)
const BRAND = /graph\s*os/i

async function text(path) {
  try {
    return await readFile(join(ROOT, path), 'utf8')
  } catch (error) {
    fail(`${path} is unreadable: ${error.message}`)
    return ''
  }
}

function requireBrand(path, content, label) {
  if (!BRAND.test(content)) fail(`${path} ${label} does not present the GraphOS brand`)
}

const indexHtml = await text('index.html')
const title = indexHtml.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
requireBrand('index.html', title, '<title>')
requireBrand(
  'index.html',
  indexHtml.match(/<meta property="og:site_name" content="([^"]*)"/)?.[1] ?? '',
  'og:site_name meta',
)

const manifest = await text('public/site.webmanifest')
try {
  const parsed = JSON.parse(manifest)
  requireBrand('public/site.webmanifest', parsed.name ?? '', 'name')
} catch (error) {
  fail(`public/site.webmanifest is not valid JSON: ${error.message}`)
}

const mkdocs = await text('mkdocs.yml')
requireBrand('mkdocs.yml', mkdocs.match(/^site_name:\s*(.*)$/m)?.[1] ?? '', 'site_name')

const readme = await text('README.md')
requireBrand('README.md', readme.match(/^#\s+(.*)$/m)?.[1] ?? '', 'top-level heading')

if (errors.length > 0) {
  console.error(`site brand check failed (${errors.length} issue(s))`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('site brand check passed (title, web manifest, docs site name, and README all present the GraphOS brand)')
}
