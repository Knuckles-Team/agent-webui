import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SKILLS_DIR = resolve(import.meta.dirname, '../../../../agent/agent_webui/skills')

/** Directory names under agent/agent_webui/skills that hold a SKILL.md. */
function skillDirNames(): string[] {
  return readdirSync(SKILLS_DIR).filter((name) => {
    const path = resolve(SKILLS_DIR, name)
    return statSync(path).isDirectory() && readdirSync(path).includes('SKILL.md')
  })
}

/** The `name:` field declared in a SKILL.md frontmatter block, if present. */
function declaredName(dirName: string): string {
  const source = readFileSync(resolve(SKILLS_DIR, dirName, 'SKILL.md'), 'utf8')
  const match = /^name:\s*(.+)$/m.exec(source)
  return match ? match[1].trim() : dirName
}

describe('skill name inventory (WEBUI-DESIGN-R001)', () => {
  // spec: WEBUI-DESIGN-R001
  it('installs no duplicate skill directory or declared skill name', () => {
    const dirs = skillDirNames()
    expect(dirs.length).toBeGreaterThan(0)
    expect(new Set(dirs).size).toBe(dirs.length)

    const owners = new Map<string, string[]>()
    for (const dir of dirs) {
      const name = declaredName(dir)
      owners.set(name, [...(owners.get(name) ?? []), dir])
    }
    const duplicates = [...owners.entries()].filter(([, ownerDirs]) => ownerDirs.length > 1)
    expect(duplicates, `duplicate skill name(s): ${JSON.stringify(duplicates)}`).toHaveLength(0)
  })
})
