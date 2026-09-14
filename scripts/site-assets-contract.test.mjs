import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { projectSpaRouteManifest, projectStaticRouteMetadata, readRouteRegistry } from './site-route-registry.mjs'
import { isVersionedLocalAssetPath, routePathIssue } from './site-assets-contract.mjs'

const root = resolve(import.meta.dirname, '..')
const routeRegistry = await readRouteRegistry(root)
const projection = projectStaticRouteMetadata(routeRegistry)
const spaRouteManifest = projectSpaRouteManifest(routeRegistry)

assert.equal(new Set(routeRegistry.map((route) => route.id)).size, routeRegistry.length)
assert.deepEqual(
  projection.routes.map((route) => route.path),
  ['/privacy', '/terms', '/contact'],
  'sitemap paths must match the public route metadata exactly',
)
assert.ok(
  projection.routes.every((route) => !route.path.endsWith('/')),
  'runtime paths must not gain a slash',
)
assert.ok(projection.disallowPaths.includes('/api/'))
assert.ok(projection.disallowPaths.includes('/object/'))
assert.ok(projection.disallowPaths.includes('/thank-you'))
assert.equal(spaRouteManifest.schema_version, 1)
assert.deepEqual(
  spaRouteManifest.routes,
  routeRegistry.filter((route) => route.path !== '*').map((route) => route.path),
  'SPA route manifest must be derived from the runtime registry and exclude only the catch-all',
)
assert.throws(
  () =>
    projectStaticRouteMetadata([
      ...routeRegistry,
      { id: 'test.public.graph-collision', path: '/graph', visibility: 'public', indexable: true },
    ]),
  /collides with a registered private route/,
)
assert.match(routePathIssue('/object/:id'), /dynamic pattern/)
assert.match(routePathIssue('/private%2Fid'), /percent-encoded/)
assert.equal(routePathIssue('/privacy'), null)
assert.equal(isVersionedLocalAssetPath('/og-image-v1.png'), true)
assert.equal(isVersionedLocalAssetPath('https://cdn.example/og-image-v1.png'), false)
assert.equal(isVersionedLocalAssetPath('/og-image.png'), false)

console.log('site asset route-authority tests passed')
