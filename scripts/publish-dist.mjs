#!/usr/bin/env node
/**
 * @file publish-dist.mjs
 * @description BUG-PE-062: publish the frontend build ATOMICALLY.
 *
 * `agent/agent_webui/dist` is not just a build artifact -- the production
 * deployment live-mounts it (over NFS) straight into the running
 * `agent-webui` pod, and `server.py` resolves it fresh on every request
 * (`SPAStaticFiles(directory=str(dist_path))`). Vite empties `outDir` and
 * writes hundreds of files into it over the course of a build, `index.html`
 * LAST. Building straight into `dist` (the old behavior) meant any
 * interrupted build -- Ctrl-C, an OOM kill, a laptop sleeping mid `git
 * push`, a merge triggering the pre-push build hook that then got cut off
 * -- left a headless `dist` (every hashed asset present, no entrypoint)
 * being served to every signed-in user for as long as the interruption
 * lasted. This reproduced live twice in one day (2026-08-25); the second
 * time via a merge commit.
 *
 * `vite.config.ts` now builds into a STAGING directory (`dist.tmp`), never
 * the live path directly. This script is the only thing allowed to touch
 * the live `dist` directory, and does so with two `rename()` syscalls
 * (POSIX-atomic on a same-filesystem move -- `dist.tmp` and `dist.prev`
 * are siblings of `dist`, guaranteed to share `dist`'s filesystem): a
 * request in flight during the swap sees either the complete OLD tree or
 * the complete NEW tree, never a partially-written mix, and the exposure
 * window collapses from "the whole build duration, possibly forever if
 * interrupted" to "a sub-millisecond gap between two renames" -- during
 * which the existing dist-missing guard in `server.py`
 * (`create_agent_web_app`'s `dist_path.is_dir()` check) reports a clean,
 * loud "not found" rather than a masked, silently-broken 404.
 *
 * A staged build missing its own `index.html` is refused outright and the
 * CURRENT `dist` is left untouched -- this script never publishes a build
 * it cannot verify completed.
 */

import { existsSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = join(here, '..', 'agent', 'agent_webui')
const staging = join(base, 'dist.tmp')
const live = join(base, 'dist')
const backup = join(base, 'dist.prev')

function fail(message) {
  console.error(`publish-dist: ${message}`)
  process.exit(1)
}

if (!existsSync(staging)) {
  fail(`staging build directory not found at "${staging}" -- did \`vite build\` run first?`)
}
if (!existsSync(join(staging, 'index.html'))) {
  // The one guarantee this script exists to enforce: never publish a
  // headless build over a good one. Vite writes `index.html` last, so its
  // absence here means the build itself was interrupted.
  fail(
    `"${staging}/index.html" is missing -- the staged build did not complete. ` +
      'Refusing to publish; the current dist (if any) is left untouched.',
  )
}

// Clean up a stale backup left by a prior interrupted run before we start.
if (existsSync(backup)) {
  rmSync(backup, { recursive: true, force: true })
}

if (existsSync(live)) {
  renameSync(live, backup)
}
renameSync(staging, live)
if (existsSync(backup)) {
  rmSync(backup, { recursive: true, force: true })
}

console.log(`publish-dist: published "${staging}" -> "${live}"`)
