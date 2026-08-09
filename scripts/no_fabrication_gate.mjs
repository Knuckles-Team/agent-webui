#!/usr/bin/env node
/**
 * @file no_fabrication_gate.mjs
 * @description Static gate for BUG-008 (Ecosystem UI fabricates operational
 * state). Rejects production source patterns that invent operational
 * data -- fake progress/queue/job rows, `Math.random()`-derived IDs or
 * metrics, hardcoded numeric fallbacks standing in for real telemetry, and
 * `setTimeout`-driven fake async completion toasts -- instead of an honest
 * `loading | ready | empty | unavailable | error` state.
 *
 * This program has been burned three times by gates that looked green while
 * enforcing nothing (see workspace CLAUDE.md / MEMORY "Gates report more
 * coverage than they have"). Do not trust this gate on a green run alone --
 * `pnpm run gate:no-fabrication:selftest` proves it catches each rule
 * against a known-bad fixture; run that after any change to the rules below.
 *
 * Scope (D-GOC28-1): this gate scans exactly the files this lane owns --
 * `EcosystemView.tsx` and the widget/panel components it renders (see
 * `TARGET_GLOBS`). It intentionally does NOT scan the rest of `src/` --
 * three other workers are concurrently editing `nav-registry.ts`,
 * `SkillsView.tsx`, `GraphView.tsx`, `mcp-context.tsx`, and the backend
 * `server.py`/`api_extensions.py` in this same repo right now (see
 * `agent-webui/AGENTS.md` "Branching & isolation" / GOC-28 lane file
 * ownership); making this gate commit-blocking repo-wide would fail every
 * other worker's unrelated commit on fabrication these rules were never
 * reviewed against, and isn't this lane's file to fix. Broadening it to the
 * rest of the dashboard is deliberately left to whichever lane owns
 * dashboard-wide truthfulness (GOC-28-W06 / the hostile-baseline work).
 *
 * Allowlisting: a genuinely intentional static illustration (e.g. a
 * Storybook/test fixture that must live outside `__tests__` for some
 * structural reason) is allowed ONLY via an explicit, reviewed
 * `// no-fabrication-allow: <reason>` comment on the line immediately
 * before the flagged line. There is no environment variable, CLI flag, or
 * broad suppression that disables a rule -- only a per-line, per-reason,
 * grep-able allowlist entry that shows up in `git blame`/code review. Every
 * allowlist use is printed by this gate so it cannot silently accumulate.
 */
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

// D-GOC28-1: scoped to this lane's ownership -- see file header.
const TARGET_GLOBS = [
  'src/components/views/EcosystemView.tsx',
  'src/components/views/ecosystem/**/*.{ts,tsx}',
]

const EXCLUDE_PATTERNS = [/__tests__\//, /\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /\.stories\.[tj]sx?$/, /\.fixture\.[tj]sx?$/]

const ALLOW_COMMENT = /no-fabrication-allow:\s*(.+)/

/**
 * Rule set. Each rule is a `{ id, description, pattern }` where `pattern`
 * is tested per-line (RULE_MATH_RANDOM, RULE_METRIC_FALLBACK) or is a
 * bracket-depth scan across the whole file (RULE_TIMEOUT_TOAST). Every rule
 * below corresponds to a fabrication this lane found and removed from
 * `EcosystemView.tsx` -- see the file's own D-WUI-BUG-008 comments for the
 * removed originals.
 */
const RULE_MATH_RANDOM = {
  id: 'math-random',
  description:
    'Math.random() used in a production path to fabricate an id, metric, or other operational value. ' +
    '(Removed example: submitStirlingPdf/addMediaDownload used `pdf-${Math.floor(Math.random() * 1000)}`.)',
  linePattern: /Math\.random\s*\(/,
}

// Curated list of operational/telemetry-shaped identifiers. A numeric (or
// short quoted-string) fallback directly on one of these via `??` is
// exactly the "backend error/unavailable rendered as a plausible number"
// anti-pattern BUG-008 names -- e.g. the removed
// `resources?.cpu_percent ?? 24.5`.
const METRIC_IDENTIFIERS = [
  'cpu_percent',
  'memory',
  'disk',
  'percent',
  'progress',
  'latency',
  'uptime',
  'uptime_24h',
  'accuracy',
  'loss',
  'val_loss',
  'tokens',
  'dl_speed',
  'ul_speed',
  'used_gb',
  'total_gb',
  'r2_test',
]
const RULE_METRIC_FALLBACK = {
  id: 'metric-fallback',
  description:
    'A numeric/string literal fallback via `??` directly on an operational-metric field. A missing or ' +
    'errored value must render an explicit unavailable/error state, never a plausible-looking number. ' +
    `(Removed example: `.concat(
      '`resources?.cpu_percent ?? 24.5`.) Flagged identifiers: ',
      METRIC_IDENTIFIERS.join(', '),
    ),
  linePattern: new RegExp(`\\.(?:${METRIC_IDENTIFIERS.join('|')})\\s*\\?\\?\\s*['"\`]?-?\\d`),
}

const RULE_TIMEOUT_TOAST = {
  id: 'timeout-fake-completion',
  description:
    'A success/info toast (or a state setter assigning a terminal status like "completed"/"success"/' +
    '"downloading") fired from inside a setTimeout callback, with no fetch/await in between -- a fabricated ' +
    'delayed "async completion" that never touched a backend. (Removed example: submitStirlingPdf\'s ' +
    "setTimeout(() => { ...status: 'completed'... toast.info(...) }, 3000).)",
}

const RULES = [RULE_MATH_RANDOM, RULE_METRIC_FALLBACK, RULE_TIMEOUT_TOAST]

/** Scan a setTimeout(...) callback body (bracket-depth) for a fake-completion signature. */
function scanTimeoutBlocks(text, lines) {
  const violations = []
  const timeoutRe = /setTimeout\s*\(/g
  let match
  while ((match = timeoutRe.exec(text)) !== null) {
    const start = match.index
    // Find the callback body: the first `{` after the match, then walk
    // bracket depth to its matching `}`.
    const braceStart = text.indexOf('{', start)
    if (braceStart === -1) continue
    let depth = 0
    let end = -1
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) continue
    const body = text.slice(braceStart, end)
    const hasFetchOrAwait = /\bawait\b|\bfetch\s*\(/.test(body)
    const hasFakeCompletion =
      /toast\.(success|info)\s*\(/.test(body) ||
      /status\s*:\s*['"](completed|success|downloading|done)['"]/.test(body)
    if (hasFakeCompletion && !hasFetchOrAwait) {
      const lineNo = text.slice(0, braceStart).split('\n').length
      violations.push({ rule: RULE_TIMEOUT_TOAST, line: lineNo })
    }
  }
  return violations
}

/**
 * Look upward from `lineIndex` through the contiguous block of `//` comment
 * lines immediately preceding it (a multi-line justification is normal --
 * `no-fabrication-allow:` need not be the very last comment line, just
 * somewhere in the unbroken comment block directly above the flagged code).
 * Stops at the first non-comment, non-blank line.
 */
function isAllowed(lines, lineIndex) {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (!trimmed.startsWith('//')) break
    const m = ALLOW_COMMENT.exec(line)
    if (m) return m[1].trim()
  }
  return null
}

function scanFile(absPath) {
  const text = readFileSync(absPath, 'utf8')
  const lines = text.split('\n')
  const relPath = relative(REPO_ROOT, absPath)
  const violations = []
  const allowlisted = []

  lines.forEach((line, idx) => {
    for (const rule of [RULE_MATH_RANDOM, RULE_METRIC_FALLBACK]) {
      if (rule.linePattern.test(line)) {
        const reason = isAllowed(lines, idx)
        if (reason) {
          allowlisted.push({ file: relPath, line: idx + 1, rule: rule.id, reason })
        } else {
          violations.push({ file: relPath, line: idx + 1, rule: rule.id, description: rule.description, text: line.trim() })
        }
      }
    }
  })

  for (const v of scanTimeoutBlocks(text, lines)) {
    const idx = v.line - 1
    const reason = isAllowed(lines, idx)
    if (reason) {
      allowlisted.push({ file: relPath, line: v.line, rule: v.rule.id, reason })
    } else {
      violations.push({
        file: relPath,
        line: v.line,
        rule: v.rule.id,
        description: v.rule.description,
        text: lines[idx]?.trim() ?? '',
      })
    }
  }

  return { violations, allowlisted }
}

function main() {
  const files = TARGET_GLOBS.flatMap((pattern) =>
    globSync(pattern, { cwd: REPO_ROOT, exclude: (p) => EXCLUDE_PATTERNS.some((re) => re.test(p)) }),
  ).map((f) => `${REPO_ROOT}/${f}`)

  if (files.length === 0) {
    console.error(`no-fabrication-gate: no files matched TARGET_GLOBS (${TARGET_GLOBS.join(', ')}) -- refusing to pass silently.`)
    process.exit(2)
  }

  let allViolations = []
  let allAllowlisted = []
  for (const f of files) {
    const { violations, allowlisted } = scanFile(f)
    allViolations = allViolations.concat(violations)
    allAllowlisted = allAllowlisted.concat(allowlisted)
  }

  if (allAllowlisted.length > 0) {
    console.log(`no-fabrication-gate: ${allAllowlisted.length} allowlisted pattern(s) (reviewed, reasoned):`)
    for (const a of allAllowlisted) {
      console.log(`  ${a.file}:${a.line} [${a.rule}] -- ${a.reason}`)
    }
  }

  if (allViolations.length > 0) {
    console.error(`\nno-fabrication-gate: FAILED -- ${allViolations.length} fabrication pattern(s) found in production paths:\n`)
    for (const v of allViolations) {
      console.error(`  ${v.file}:${v.line} [${v.rule}]`)
      console.error(`    ${v.description}`)
      console.error(`    > ${v.text}`)
      console.error(
        '    Fix: replace with a real backend read or an explicit unavailable/error state. If this is a ' +
          'deliberately reviewed static illustration, add `// no-fabrication-allow: <reason>` on the line above.',
      )
      console.error('')
    }
    process.exit(1)
  }

  console.log(`no-fabrication-gate: OK -- scanned ${files.length} file(s) (${TARGET_GLOBS.join(', ')}), 0 violations.`)
}

main()
