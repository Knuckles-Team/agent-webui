/**
 * Static release gate for the generated site contract. Run after
 * generate-site-assets.mjs. It intentionally has no image dependency: PNG
 * dimensions are read from the PNG signature/IHDR header and byte budgets are
 * checked directly, keeping this gate usable in the minimal build image.
 */
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalOrigin, isVersionedLocalAssetPath, routePathIssue } from './site-assets-contract.mjs'
import { projectSpaRouteManifest, projectStaticRouteMetadata, readRouteRegistry } from './site-route-registry.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const INDEX = join(ROOT, 'index.html')
const errors = []
const fail = (message) => errors.push(message)
const envIndexable = (process.env.VITE_SITE_INDEXABLE ?? process.env.VITE_INDEXABLE_ENVIRONMENT) === 'true'

let routeProjection
let expectedSpaRouteManifest
try {
  const routeRegistry = await readRouteRegistry(ROOT)
  routeProjection = projectStaticRouteMetadata(routeRegistry)
  expectedSpaRouteManifest = projectSpaRouteManifest(routeRegistry)
} catch (error) {
  fail(`route metadata is not a valid static authority: ${error.message}`)
  routeProjection = { routes: [], disallowPaths: [] }
  expectedSpaRouteManifest = { schema_version: 1, routes: [] }
}

async function text(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    fail(`${path} is unreadable: ${error.message}`)
    return ''
  }
}

async function bytes(path, maxBytes) {
  try {
    const size = (await stat(path)).size
    if (size > maxBytes) fail(`${path} is ${size} bytes; maximum is ${maxBytes}`)
    return size
  } catch (error) {
    fail(`${path} is missing: ${error.message}`)
    return 0
  }
}

function required(html, pattern, label) {
  if (!pattern.test(html)) fail(`index.html is missing ${label}`)
}

function canonicalHrefs(html) {
  return [...html.matchAll(/<link\b[^>]*>/g)].flatMap((match) => {
    const tag = match[0]
    if (!/\brel="canonical"/.test(tag)) return []
    const href = tag.match(/\bhref="([^"]+)"/)?.[1]
    return href ? [href] : []
  })
}

function pngDimensions(buffer, path) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    fail(`${path} is not a PNG with an IHDR header`)
    return null
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function checkPng(name, width, height, maxBytes) {
  const path = join(PUBLIC, name)
  await bytes(path, maxBytes)
  try {
    const image = await readFile(path)
    const dimensions = pngDimensions(image, path)
    if (dimensions && (dimensions.width !== width || dimensions.height !== height)) {
      fail(`${path} is ${dimensions.width}x${dimensions.height}; expected ${width}x${height}`)
    }
  } catch {
    // bytes() recorded the missing/unreadable path.
  }
}

const html = await text(INDEX)
required(html, /<title>[^<]+<\/title>/, 'a non-empty title')
required(html, /<meta\s+name="description"\s+content="[^"]+"\s*\/>/, 'meta description')
required(html, /<meta name="theme-color" content="#[0-9a-fA-F]{6}"\s*\/>/, 'theme-color')
required(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"\s*\/>/, 'SVG favicon')
required(html, /<link rel="icon" type="image\/png" sizes="16x16" href="\/favicon-16x16\.png"\s*\/>/, '16px favicon')
required(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32x32\.png"\s*\/>/, '32px favicon')
required(html, /<link rel="icon" type="image\/png" sizes="48x48" href="\/favicon-48x48\.png"\s*\/>/, '48px favicon')
required(html, /<link rel="shortcut icon" href="\/favicon\.ico"\s*\/>/, 'ICO favicon')
required(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"\s*\/>/, 'Apple touch icon')
required(html, /<link rel="manifest" href="\/site\.webmanifest"\s*\/>/, 'web manifest')
required(html, /<meta property="og:type" content="website"\s*\/>/, 'Open Graph type')
required(html, /<meta property="og:title" content="[^"]+"\s*\/>/, 'Open Graph title')
required(html, /<meta\s+property="og:description"\s+content="[^"]+"\s*\/>/, 'Open Graph description')
required(html, /<meta property="og:image"[^>]*data-site-generated="og-image"[^>]*\/>/, 'Open Graph image')
required(html, /<meta property="og:image:alt" content="[^"]+"\s*\/>/, 'Open Graph image alt')
required(html, /<meta name="twitter:card" content="summary_large_image"\s*\/>/, 'Twitter card')
required(html, /<meta name="twitter:image"[^>]*data-site-generated="twitter-image"[^>]*\/>/, 'Twitter image')

const robots = await text(join(PUBLIC, 'robots.txt'))
const sitemap = await text(join(PUBLIC, 'sitemap.xml'))
if (!robots.endsWith('\n') || robots.endsWith('\n\n')) fail('robots.txt must end with exactly one newline')
let configuredOrigin = null
if (envIndexable) {
  try {
    const siteConfigModule = await import('../src/lib/site-config.ts')
    const siteConfig = siteConfigModule.getSiteConfig()
    if (!siteConfigModule.isIndexableSiteConfigReady(siteConfig)) {
      const validation = siteConfigModule.validateSiteConfig(siteConfig)
      fail(`site config is not release-ready for indexing: ${validation.errors.join('; ')}`)
    }
    configuredOrigin = canonicalOrigin(siteConfig.canonicalOrigin)
  } catch (error) {
    fail(`cannot validate the runtime site config; run with Node type stripping enabled: ${error.message}`)
  }
}
if (envIndexable) {
  if (!configuredOrigin) fail('VITE_SITE_ORIGIN must be an HTTPS origin when indexable')
  if (!/^User-agent: \*\nAllow: \/$/m.test(robots)) fail('indexable robots.txt must allow public routes')
  if (!robots.includes(`Sitemap: ${configuredOrigin}/sitemap.xml`))
    fail('indexable robots.txt must advertise the canonical sitemap')
  for (const tag of ['canonical', 'og:url', 'og:image', 'twitter:image']) {
    const pattern =
      tag === 'canonical'
        ? /<link rel="canonical" href="([^"]+)"/
        : new RegExp(`(?:property|name)="${tag}"[^>]+content="([^"]+)"`)
    const value = html.match(pattern)?.[1]
    if (!value || !value.startsWith(`${configuredOrigin}/`)) fail(`indexable ${tag} must be an absolute canonical URL`)
  }
  if (!/<url>/.test(sitemap)) fail('indexable sitemap must contain at least one explicit public route')
} else {
  if (!/Disallow: \/(?:\n|$)/.test(robots)) fail('non-indexable robots.txt must disallow all crawling')
  if (/^Sitemap:/m.test(robots)) fail('non-indexable robots.txt must not advertise a sitemap')
  if (/<url>/.test(sitemap)) fail('non-indexable sitemap must not contain public URLs')
  if (canonicalHrefs(html).some((href) => href.startsWith('/'))) {
    fail('non-indexable canonical links must be omitted or use an absolute configured origin')
  }
  for (const tag of ['canonical', 'og:url', 'og:image', 'twitter:image']) {
    const pattern =
      tag === 'canonical'
        ? /<link rel="canonical" href="([^"]+)"/
        : new RegExp(`(?:property|name)="${tag}"[^>]+content="([^"]+)"`)
    const value = html.match(pattern)?.[1]
    if (value?.startsWith('http')) fail(`non-indexable ${tag} must not expose a canonical origin`)
  }
}

const sitemapPaths = []
for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const value = match[1]
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(`sitemap loc is not an absolute URL: ${value}`)
    continue
  }
  if (parsed.search || parsed.hash || parsed.pathname.includes(':'))
    fail(`sitemap loc contains a query, fragment, or dynamic path: ${value}`)
  const pathIssue = routePathIssue(parsed.pathname)
  if (pathIssue) fail(`unsafe path leaked into sitemap (${pathIssue}): ${value}`)
  sitemapPaths.push(parsed.pathname)
}
const expectedSitemapPaths = envIndexable ? routeProjection.routes.map((route) => route.path) : []
if (JSON.stringify(sitemapPaths) !== JSON.stringify(expectedSitemapPaths)) {
  fail(`sitemap paths do not match route metadata: expected ${expectedSitemapPaths.join(', ') || '(empty)'}`)
}
if (envIndexable) {
  const actualDisallowPaths = [...robots.matchAll(/^Disallow: (.+)$/gm)].map((match) => match[1])
  for (const path of routeProjection.disallowPaths) {
    if (!actualDisallowPaths.includes(path)) fail(`robots.txt is missing route-derived private path: ${path}`)
  }
}

const spaRouteManifest = await text(join(PUBLIC, 'spa-routes.json'))
try {
  const parsed = JSON.parse(spaRouteManifest)
  if (JSON.stringify(parsed) !== JSON.stringify(expectedSpaRouteManifest)) {
    fail('spa-routes.json does not match the runtime route registry')
  }
  if (parsed.routes?.includes('*')) fail('spa-routes.json must exclude the catch-all route')
} catch (error) {
  fail(`spa-routes.json is invalid JSON: ${error.message}`)
}

const manifest = await text(join(PUBLIC, 'site.webmanifest'))
try {
  const parsed = JSON.parse(manifest)
  if (!Array.isArray(parsed.icons) || parsed.icons.length < 2)
    fail('site.webmanifest must provide 192px and 512px icons')
  for (const icon of parsed.icons ?? [])
    if (!/^\/(icon-192x192|icon-512x512)\.png$/.test(icon.src))
      fail(`manifest icon has an unexpected source: ${icon.src}`)
} catch (error) {
  fail(`site.webmanifest is invalid JSON: ${error.message}`)
}

await bytes(join(PUBLIC, 'favicon.svg'), 10_000)
await bytes(join(PUBLIC, 'favicon.ico'), 100_000)
await checkPng('favicon-16x16.png', 16, 16, 25_000)
await checkPng('favicon-32x32.png', 32, 32, 25_000)
await checkPng('favicon-48x48.png', 48, 48, 25_000)
await checkPng('apple-touch-icon.png', 180, 180, 75_000)
await checkPng('icon-192x192.png', 192, 192, 100_000)
await checkPng('icon-512x512.png', 512, 512, 150_000)
const ogImagePath = envIndexable ? (process.env.VITE_OG_IMAGE_PATH ?? '/og-image-v1.png') : '/og-image-v1.png'
if (!isVersionedLocalAssetPath(ogImagePath)) fail(`Open Graph image is not a local versioned asset: ${ogImagePath}`)
await checkPng(ogImagePath.slice(1), 1200, 630, 250_000)

if (errors.length) {
  console.error(`site asset check failed (${errors.length} issue(s))`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`site asset check passed (${envIndexable ? 'indexable' : 'safe noindex'} mode)`)
}
