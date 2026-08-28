/**
 * dependency-cruiser config — advisory boundary + cycle measurement for
 * agent-webui's ~290 .ts/.tsx sources.
 *
 * Rules chosen from what the codebase actually does today, not an invented
 * layering:
 *
 * 1. no-circular (warn/advisory) — this app has NO enforced acyclic-module
 *    discipline; nav-registry.ts is a composition root that lazy-imports
 *    every view, and several views/hooks import back from it for nav
 *    metadata, producing real cycles today. Reported, not blocked, per the
 *    "advisory means never fails" convention this program uses for knip.
 *    Do NOT flip this to `error` by adding a baseline/allowlist of the
 *    current cycles — that is a ratchet, forbidden project-wide. Flip it
 *    only once the 7 current cycles are actually broken.
 *
 * 2. ui-primitives-are-leaves (error) — verified by grepping the actual
 *    imports in src/components/ui/*: every file there imports only from
 *    itself, `@/hooks/use-mobile` (a generic environment hook), and
 *    `@/lib/utils` (the `cn()` classname helper). Zero files in
 *    components/ui import app state, API clients, views, or feature
 *    components. This is a real, currently-true invariant (the shadcn/ui
 *    "primitives are leaves" convention), so it is enforced as `error`
 *    from day one — enforcing a true invariant is not a ratchet; there is
 *    nothing to baseline because nothing currently violates it.
 *
 * 3. no-unresolvable (warn/advisory) — generic import-hygiene check, not an
 *    invented architecture. Kept advisory, NOT error: bisected a live false
 *    positive in this exact tree — src/components/views/CatalogueView.tsx's
 *    harmless two-line-wrapped `<p>` JSX text node (no expression, no
 *    special characters required — reproduces even with a plain-ASCII
 *    two-line paragraph) makes dependency-cruiser 18.2.0's extractor emit a
 *    phantom `✖` unresolved specifier. `tsc --noEmit -p tsconfig.json`
 *    passes clean on the same file (exit 0, zero diagnostics), and the
 *    violation vanishes the instant the paragraph is collapsed to one line
 *    or removed — nothing else about the file changes. That is a tool
 *    limitation, not an app bug: a real breakage will still surface in the
 *    reported warning count, but this rule must not gate the build until
 *    dependency-cruiser fixes the parser (or the eventual gate carves out
 *    wrapped JSX text some other way).
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment:
        'Advisory: reports real import cycles (currently rooted at ' +
        'src/lib/nav-registry.ts, the route composition root). Never ' +
        'fails the build. Do not baseline/allowlist the current cycles ' +
        '— fix them or leave them reported.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'ui-primitives-are-leaves',
      severity: 'error',
      comment:
        'src/components/ui/* are shadcn-style presentational primitives ' +
        'and must stay leaves: no app state, API/lib modules (besides ' +
        'lib/utils), views, or feature components. Verified zero current ' +
        'violations before enabling as error.',
      from: { path: '^src/components/ui/' },
      to: {
        path: [
          '^src/components/views/',
          '^src/components/mcp/',
          '^src/components/knowledge-graph/',
          '^src/components/knowledge-graph-3d/',
          '^src/components/ontology/',
          '^src/components/workflow/',
          '^src/components/capabilities/',
          '^src/components/renderers/',
          '^src/components/learn/',
          '^src/lib/(?!utils(\\.ts)?$)',
          '^src/(App|Chat|Part)\\.tsx$',
        ],
      },
    },
    {
      name: 'no-unresolvable',
      severity: 'warn',
      comment:
        'Advisory, not error: dependency-cruiser 18.2.0 has a confirmed ' +
        'false positive on this tree (CatalogueView.tsx, a two-line ' +
        'wrapped JSX <p> text node — see file header). A real broken ' +
        'import is always a bug and will show up in the warning count; ' +
        'this just cannot safely gate the build yet.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    exclude: {
      path: 'node_modules',
    },
  },
};
