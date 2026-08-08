import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ROUTES, SECTIONS, isDynamicPath, matchRoute, routesBySection } from '../nav-registry'

const HERE = dirname(fileURLToPath(import.meta.url))
const VIEWS_DIR = join(HERE, '..', '..', 'components', 'views')
const REGISTRY_SOURCE_PATH = join(HERE, '..', 'nav-registry.ts')

/**
 * Files under src/components/views/ that are legitimately NOT standalone pages: they
 * are internal sub-components rendered by a page that IS in ROUTES, not orphans. Each
 * entry documents the parent view that owns it, so this allowlist can't quietly grow
 * into a second, undocumented way to hide a page from the registry — see the
 * `KNOWN_NON_ROUTE_COMPONENTS entries all still exist` test below, which fails the
 * moment an entry stops matching a real file.
 */
const KNOWN_NON_ROUTE_COMPONENTS: Record<string, string> = {
  'DashboardSettings.tsx': 'rendered by DashboardView',
  'DefaultOverviewPanel.tsx': 'rendered by DashboardView (D-W6-9 default landing overview)',
  'dashboards/LineChart.tsx': 'rendered by LiveDashboardsView',
  'dashboards/LogsPanel.tsx': 'rendered by LiveDashboardsView',
  'dashboards/PanelShell.tsx': 'rendered by LiveDashboardsView',
  'dashboards/PromqlPanel.tsx': 'rendered by LiveDashboardsView',
  'dashboards/TracesPanel.tsx': 'rendered by LiveDashboardsView',
  'admin/BackupPanel.tsx': 'rendered by AdminView',
  'admin/RbacPanel.tsx': 'rendered by AdminView',
  'admin/ShardsPanel.tsx': 'rendered by AdminView',
  'admin/TenantsPanel.tsx': 'rendered by AdminView',
}

/** Recursively lists `*.tsx` files under `dir`, as paths relative to `dir`. */
function listViewFiles(dir: string, prefix = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue
    const fullPath = join(dir, entry)
    const relPath = prefix ? `${prefix}/${entry}` : entry
    if (statSync(fullPath).isDirectory()) {
      files.push(...listViewFiles(fullPath, relPath))
    } else if (entry.endsWith('.tsx')) {
      files.push(relPath)
    }
  }
  return files
}

// nav-registry.ts's own source text is the ground truth for which view files are
// wired into a route: every generic route element is built from
// `import('@/components/views/<Something>')`. Parsing the source (rather than
// introspecting the resolved `React.lazy` values, which hide their promise behind
// opaque React internals) is what lets this test statically prove wiring.
const registrySource = readFileSync(REGISTRY_SOURCE_PATH, 'utf-8')
const referencedViewFiles = new Set(
  Array.from(registrySource.matchAll(/@\/components\/views\/([\w./-]+)/g)).map((match) => `${match[1]}.tsx`),
)

describe('nav-registry: ROUTES', () => {
  it('gives every route a real, non-placeholder blurb', () => {
    const placeholder = /^(todo|tbd|fixme|placeholder|lorem ipsum|description here|change me)\b/i
    for (const route of ROUTES) {
      const blurb = route.blurb?.trim() ?? ''
      expect(blurb.length, `${route.id} is missing a blurb`).toBeGreaterThan(0)
      expect(blurb, `${route.id} blurb looks like a placeholder, not real copy`).not.toMatch(placeholder)
      expect(
        /[.?!]$/.test(blurb),
        `${route.id} blurb "${blurb}" should read as a plain sentence ending in . ? or !`,
      ).toBe(true)
    }
  })

  it('gives every route a unique, stable id and a unique path', () => {
    const ids = ROUTES.map((route) => route.id)
    const paths = ROUTES.map((route) => route.path)
    expect(new Set(ids).size, 'duplicate RouteDef.id found').toBe(ids.length)
    expect(new Set(paths).size, 'duplicate RouteDef.path found').toBe(paths.length)
  })

  it('every view component is referenced by a RouteDef, or is a documented sub-component', () => {
    const viewFiles = listViewFiles(VIEWS_DIR)
    const unreferenced = viewFiles.filter(
      (file) => !referencedViewFiles.has(file) && !(file in KNOWN_NON_ROUTE_COMPONENTS),
    )
    expect(
      unreferenced,
      `Dead page(s) found: these live under src/components/views/ but are wired into no ` +
        `RouteDef in nav-registry.ts and are not declared in KNOWN_NON_ROUTE_COMPONENTS. ` +
        `Either add a route or document why not: ${unreferenced.join(', ')}`,
    ).toEqual([])
  })

  it('has no stale KNOWN_NON_ROUTE_COMPONENTS entries', () => {
    const viewFiles = new Set(listViewFiles(VIEWS_DIR))
    const stale = Object.keys(KNOWN_NON_ROUTE_COMPONENTS).filter((file) => !viewFiles.has(file))
    expect(stale, `KNOWN_NON_ROUTE_COMPONENTS names file(s) that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  // The operator's own finding: au.arpa landed on an "agent-OS Dashboard" that had
  // no left-nav entry, so it was unreachable once you clicked anywhere else — a page
  // can be perfectly wired into ROUTES (proven above) and STILL be an orphan if it
  // isn't reachable from the one navigation surface (`app-sidebar.tsx`, driven by
  // `routesBySection`). This closes that gap: every non-dynamic route must appear in
  // its section's sidebar listing, and the app's actual landing target ('/') must
  // resolve to one of them.
  it('has no orphans: every reachable route is listed in its section, and the landing route resolves to one', () => {
    const nonDynamicRoutes = ROUTES.filter((route) => !isDynamicPath(route.path))
    const sectionIds = new Set(SECTIONS.map((section) => section.id))
    const listedIds = new Set(SECTIONS.flatMap((section) => routesBySection(section.id).map((route) => route.id)))

    const unknownSection = nonDynamicRoutes.filter((route) => !sectionIds.has(route.section))
    expect(
      unknownSection,
      `route(s) declare a section not in SECTIONS, so they render nowhere in the sidebar: ` +
        unknownSection.map((route) => route.id).join(', '),
    ).toEqual([])

    const unlisted = nonDynamicRoutes.filter((route) => !listedIds.has(route.id))
    expect(
      unlisted,
      `orphaned route(s): reachable by path but absent from every sidebar section — ` +
        unlisted.map((route) => route.id).join(', '),
    ).toEqual([])

    const landing = matchRoute('/')
    expect(landing, "the landing path '/' does not resolve to any registered route").not.toBeNull()
    expect(
      landing && listedIds.has(landing.route.id),
      `the landing route ('${landing?.route.id}') is not reachable from the sidebar once the ` +
        `user navigates away — this is exactly the orphaned-landing-page defect the operator hit`,
    ).toBe(true)
  })
})
