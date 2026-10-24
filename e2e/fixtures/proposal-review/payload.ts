import { canonicalJson } from '../../../src/lib/webmcp/canonical'

export const requesterAgent = 'agent-'.padEnd(512, 'a')
export const runReference = `pref_agent_run_${'b'.repeat(64)}`
export const longArguments = canonicalJson({ message: `${'x'.repeat(8175)}END` })
export const tallArguments = canonicalJson({ rows: Array.from({ length: 500 }, (_, index) => `row-${index}`) })
