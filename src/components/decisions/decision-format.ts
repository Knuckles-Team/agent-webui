/**
 * @file decision-format.ts
 * @description Small, pure display helpers shared by the decision explorer
 * and calibration tabs — no fetching, no state, so both tabs (and their
 * tests) can use these without a component tree.
 */

/** `created_at_ms`/`recorded_at_ms` (or absent) to a locale-formatted stamp. */
export function formatEpochMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/** A digest/id, shortened to a leading prefix for a compact list cell. */
export function shortenId(value: string, length = 12): string {
  return value.length <= length ? value : `${value.slice(0, length)}…`
}

/** `successes / trials` as a whole-number percentage, or `null` with no trials. */
export function successRatePercent(successes: number, trials: number): number | null {
  if (trials <= 0) return null
  return Math.round((successes / trials) * 100)
}

/**
 * Tailwind classes for the evidence/resolution-kind badges — one fixed
 * category-color mapping reused everywhere the value appears, never derived
 * per call site (dataviz: "assign categorical hues in fixed order, never
 * cycled"). Falls back to a neutral tone for a value this table does not
 * name (a newer engine build adding a variant must never crash the badge).
 */
const CATEGORY_TONES: Record<string, string> = {
  // Evidence classes, strongest first.
  proof: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  observation: 'bg-teal-500/10 border-teal-500/30 text-teal-400',
  claim: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  // Resolution kinds.
  constraint: 'bg-sky-500/10 border-sky-500/30 text-sky-400',
  entailment: 'bg-violet-500/10 border-violet-500/30 text-violet-400',
  optimization: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  statistical: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  abstention: 'bg-red-500/10 border-red-500/30 text-red-400',
  // Outcomes.
  solved: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  abstained: 'bg-red-500/10 border-red-500/30 text-red-400',
}
const NEUTRAL_TONE = 'bg-muted/20 border-border/30 text-muted-foreground'

export function categoryTone(value: string | null | undefined): string {
  if (!value) return NEUTRAL_TONE
  return CATEGORY_TONES[value] ?? NEUTRAL_TONE
}

/** One trace-fidelity segment's fixed legend color (categorical, fixed order). */
const FIDELITY_TONES: Record<string, string> = {
  full_step: 'bg-emerald-500',
  tool_calls: 'bg-teal-500',
  final_output: 'bg-amber-500',
  censored: 'bg-muted-foreground/40',
}

export function fidelityTone(key: string): string {
  return FIDELITY_TONES[key] ?? 'bg-muted-foreground/40'
}

/** Human label for a `snake_case` wire value: `full_step` -> `Full step`. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—'
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
