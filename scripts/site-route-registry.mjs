/**
 * Dependency-free bridge from the runtime route authority to static assets.
 *
 * `nav-registry.ts` owns route declarations and `page-metadata.ts` projects
 * them at runtime. The static build cannot import the React/lucide route module
 * directly, so this deliberately small source reader extracts only the scalar
 * route fields needed by robots/sitemap generation. It accepts no authored
 * route file and fails when the registry shape is not recognizable.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  concreteCanonicalPath,
  isPublicIndexableRoute,
  NON_PAGE_PROTECTED_PATHS,
  robotsDisallowPath,
} from '../src/lib/route-metadata-seam.mjs'
import { routePathIssue } from './site-assets-contract.mjs'

const ROUTE_ARRAY_NAMES = Object.freeze(['ROUTES', 'PUBLIC_ROUTES'])

function skipQuoted(source, start, quote) {
  let escaped = false
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === quote) {
      return index + 1
    }
  }
  throw new Error(`unterminated ${quote} string in nav-registry.ts`)
}

function skipComment(source, start) {
  if (source.startsWith('//', start)) {
    const newline = source.indexOf('\n', start + 2)
    return newline < 0 ? source.length : newline + 1
  }
  if (source.startsWith('/*', start)) {
    const end = source.indexOf('*/', start + 2)
    if (end < 0) throw new Error('unterminated block comment in nav-registry.ts')
    return end + 2
  }
  return start
}

function matchingBracket(source, start, opening, closing) {
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuoted(source, index, character) - 1
      continue
    }
    const commentEnd = skipComment(source, index)
    if (commentEnd !== index) {
      index = commentEnd - 1
      continue
    }
    if (character === opening) depth += 1
    if (character === closing) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new Error(`unterminated ${opening}${closing} block in nav-registry.ts`)
}

function exportedArrayBody(source, name) {
  const declaration = new RegExp(`export\\s+const\\s+${name}\\s*:[^=]+=`).exec(source)
  if (!declaration) throw new Error(`nav-registry.ts is missing ${name}`)
  const start = source.indexOf('[', declaration.index + declaration[0].length)
  if (start < 0) throw new Error(`nav-registry.ts ${name} declaration is missing [`)
  return source.slice(start + 1, matchingBracket(source, start, '[', ']'))
}

function topLevelObjects(arrayBody) {
  const objects = []
  let objectStart = -1
  let depth = 0
  for (let index = 0; index < arrayBody.length; index += 1) {
    const character = arrayBody[index]
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuoted(arrayBody, index, character) - 1
      continue
    }
    const commentEnd = skipComment(arrayBody, index)
    if (commentEnd !== index) {
      index = commentEnd - 1
      continue
    }
    if (character === '{') {
      if (depth === 0) objectStart = index
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0 && objectStart >= 0) {
        objects.push(arrayBody.slice(objectStart, index + 1))
        objectStart = -1
      }
    }
  }
  if (depth !== 0) throw new Error('unbalanced route object in nav-registry.ts')
  return objects
}

function scalarString(object, field) {
  const pattern = new RegExp(`\\b${field}\\s*:\\s*(['"])(.*?)\\1`, 's')
  return pattern.exec(object)?.[2]
}

function scalarBoolean(object, field) {
  return new RegExp(`\\b${field}\\s*:\\s*(true|false)`).exec(object)?.[1] === 'true'
}

function routeRecord(object, sourceName) {
  const id = scalarString(object, 'id')
  const path = scalarString(object, 'path')
  if (!id || !path) throw new Error(`${sourceName} contains a route without scalar id/path metadata`)
  return {
    id,
    path,
    visibility: scalarString(object, 'visibility') ?? 'private',
    indexable: scalarBoolean(object, 'indexable'),
    canonicalPath: scalarString(object, 'canonicalPath'),
  }
}

/** Read scalar route metadata from the same registry used by the application. */
export async function readRouteRegistry(root) {
  const source = await readFile(join(root, 'src/lib/nav-registry.ts'), 'utf8')
  const routes = ROUTE_ARRAY_NAMES.flatMap((name) =>
    topLevelObjects(exportedArrayBody(source, name)).map((object) => routeRecord(object, name)),
  )
  const ids = new Set()
  const paths = new Set()
  for (const route of routes) {
    if (ids.has(route.id)) throw new Error(`duplicate route metadata id in nav-registry.ts: ${route.id}`)
    ids.add(route.id)
    if (route.path !== '*' && paths.has(route.path)) {
      throw new Error(`duplicate route metadata path in nav-registry.ts: ${route.path}`)
    }
    if (route.path !== '*') paths.add(route.path)
  }
  return routes
}

/** Project the registry once for both static generation and its release gate. */
export function projectStaticRouteMetadata(routes) {
  const disallowPaths = new Set(NON_PAGE_PROTECTED_PATHS)
  for (const route of routes) {
    const path = concreteCanonicalPath(route)
    if (route.visibility === 'public' && route.indexable && path === undefined) {
      throw new Error(`indexable public route is dynamic and cannot enter a sitemap: ${route.id}`)
    }
    if (isPublicIndexableRoute(route)) continue
    const disallowPath = robotsDisallowPath(route)
    if (disallowPath && disallowPath !== '/') disallowPaths.add(disallowPath)
  }
  const publicPaths = new Set()
  const protectedPaths = [...disallowPaths]
  for (const route of routes) {
    if (!isPublicIndexableRoute(route)) continue
    const path = concreteCanonicalPath(route)
    const issue = routePathIssue(path, protectedPaths)
    if (issue) throw new Error(`${route.id} has an unsafe public canonical path (${issue})`)
    if (publicPaths.has(path)) throw new Error(`duplicate public canonical path in route metadata: ${path}`)
    publicPaths.add(path)
  }
  return {
    routes: [...publicPaths].map((path) => ({ path })),
    disallowPaths: [...disallowPaths],
  }
}

/** Build-only handoff used by the Python SPA server for truthful HTTP status. */
export function projectSpaRouteManifest(routes) {
  return {
    schema_version: 1,
    routes: routes.filter((route) => route.path !== '*').map((route) => route.path),
  }
}

export { concreteCanonicalPath, isPublicIndexableRoute, robotsDisallowPath }
