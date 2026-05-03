import { useState, useEffect, useMemo } from 'react'
import { Zap, ZapOff, Search, Tag as TagIcon, RefreshCw, LayoutGrid, List, Wrench, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Describes a single skill / capability / MCP tool exposed by the agent.
 *
 * CONCEPT:KG-003 — Granular Resource Queries
 */
interface Skill {
  id: string
  name: string
  description?: string
  enabled: boolean
  type?: string
  tags: string[]
  source?: string
}

const UNTAGGED_GROUP = 'untagged'

interface ErrorResponse {
  detail?: string
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ErrorResponse
    if (body && typeof body.detail === 'string') return body.detail
  } catch {
    // ignore — response wasn't JSON
  }
  return fallback
}

/**
 * Normalize an arbitrary payload from `/api/enhanced/skills` into a strict
 * `Skill[]`. Tolerates missing `id`, `tags`, `enabled`, and `description`.
 */
function normalizeSkills(raw: unknown): Skill[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item, idx): Skill | null => {
      if (!item || typeof item !== 'object') return null
      const rec = item as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name : null
      if (!name) return null

      const id =
        typeof rec.id === 'string'
          ? rec.id
          : typeof rec.skill_id === 'string'
            ? rec.skill_id
            : `${name}-${idx}`

      const rawTags: unknown = rec.tags
      const tags = Array.isArray(rawTags)
        ? rawTags.filter((t): t is string => typeof t === 'string')
        : []

      return {
        id,
        name,
        description: typeof rec.description === 'string' ? rec.description : undefined,
        enabled: rec.enabled === true,
        type: typeof rec.type === 'string' ? rec.type : undefined,
        tags,
        source: typeof rec.source === 'string' ? rec.source : undefined,
      }
    })
    .filter((s): s is Skill => s !== null)
}

export default function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [groupByTag, setGroupByTag] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'skill' | 'mcp_tool'>('all')

  useEffect(() => {
    void fetchSkills()
  }, [])

  const fetchSkills = async () => {
    try {
      setLoading(true)
      // Fetch from both /skills and /tools endpoints (CONCEPT:KG-003)
      const [skillsRes, toolsRes] = await Promise.allSettled([
        fetch('/api/enhanced/skills'),
        fetch('/api/enhanced/tools'),
      ])

      let allItems: Skill[] = []

      if (skillsRes.status === 'fulfilled' && skillsRes.value.ok) {
        const skillData = (await skillsRes.value.json()) as unknown
        allItems.push(...normalizeSkills(skillData))
      }

      if (toolsRes.status === 'fulfilled' && toolsRes.value.ok) {
        const toolData = (await toolsRes.value.json()) as unknown
        const normalizedTools = normalizeSkills(toolData)
        // Avoid duplicates
        const existingIds = new Set(allItems.map((s) => s.id))
        for (const tool of normalizedTools) {
          if (!existingIds.has(tool.id)) {
            allItems.push(tool)
          }
        }
      }

      allItems.sort((a, b) => a.name.localeCompare(b.name))
      setSkills(allItems)
    } catch (_err) {
      toast.error('Failed to load skills and tools')
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (id: string) => {
    const previous = skills
    // Optimistic update so the switch responds instantly even if the network
    // round-trip is slow; we roll back on failure.
    setSkills((current) => current.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)))
    try {
      const res = await fetch(`/api/enhanced/skills/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
      })
      if (!res.ok) {
        setSkills(previous)
        toast.error(await extractErrorMessage(res, 'Failed to update skill'))
        return
      }
      toast.success('Skill updated')
    } catch (_err) {
      setSkills(previous)
      toast.error('Failed to update skill')
    }
  }

  const filteredSkills = useMemo(() => {
    let filtered = skills

    // Type filter (CONCEPT:KG-003)
    if (typeFilter !== 'all') {
      filtered = filtered.filter((s) => s.type === typeFilter)
    }

    // Text search
    const query = searchQuery.trim().toLowerCase()
    if (!query) return filtered
    return filtered.filter((skill) => {
      if (skill.name.toLowerCase().includes(query)) return true
      if (skill.description?.toLowerCase().includes(query)) return true
      if (skill.id.toLowerCase().includes(query)) return true
      if (skill.tags.some((t) => t.toLowerCase().includes(query))) return true
      return false
    })
  }, [skills, searchQuery, typeFilter])

  /**
   * Groups the filtered skills by tag. Skills without tags land in an
   * `untagged` bucket. Skills with multiple tags appear in each of their
   * groups so the user can surface them from any angle.
   */
  const grouped = useMemo(() => {
    const groups = new Map<string, Skill[]>()
    for (const skill of filteredSkills) {
      if (skill.tags.length === 0) {
        const bucket = groups.get(UNTAGGED_GROUP) ?? []
        bucket.push(skill)
        groups.set(UNTAGGED_GROUP, bucket)
        continue
      }
      for (const tag of skill.tags) {
        const bucket = groups.get(tag) ?? []
        bucket.push(skill)
        groups.set(tag, bucket)
      }
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === UNTAGGED_GROUP) return 1
      if (b === UNTAGGED_GROUP) return -1
      return a.localeCompare(b)
    })
  }, [filteredSkills])

  const totalTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const skill of skills) {
      for (const tag of skill.tags) tagSet.add(tag)
    }
    return tagSet.size
  }, [skills])

  const enabledCount = useMemo(() => skills.filter((s) => s.enabled).length, [skills])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Agent Skills</CardTitle>
              <CardDescription>
                Manage your agent's capabilities and integrated tools
                {skills.length > 0 && (
                  <span className="ml-2">
                    · {enabledCount}/{skills.length} enabled
                    {totalTags > 0 && ` · ${totalTags} tags`}
                    {skills.filter((s) => s.type === 'mcp_tool').length > 0 &&
                      ` · ${skills.filter((s) => s.type === 'mcp_tool').length} MCP tools`}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | 'skill' | 'mcp_tool')}>
                <SelectTrigger className="w-[130px] h-9">
                  <Filter className="size-3.5 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="skill">Skills</SelectItem>
                  <SelectItem value="mcp_tool">MCP Tools</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGroupByTag((v) => !v)}
                disabled={loading || skills.length === 0}
                title={groupByTag ? 'Show flat list' : 'Group by tag'}
              >
                {groupByTag ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
                <span className="ml-1 hidden sm:inline">{groupByTag ? 'Flat' : 'By tag'}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchSkills()}
                disabled={loading}
                title="Refresh"
              >
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, description, or tag..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading skills...</p>
          ) : skills.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No skills discovered in the current workspace.
            </p>
          ) : filteredSkills.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No skills match your search.</p>
          ) : groupByTag ? (
            <ScrollArea className="max-h-[calc(100vh-20rem)]">
              <div className="space-y-6 pr-4">
                {grouped.map(([tag, groupSkills]) => (
                  <div key={tag}>
                    <div className="flex items-center gap-2 mb-3">
                      <TagIcon className="size-4 text-muted-foreground" />
                      <h3 className="font-semibold text-sm">
                        {tag === UNTAGGED_GROUP ? 'Untagged' : tag}
                      </h3>
                      <Badge variant="secondary" className="text-[10px]">
                        {groupSkills.length}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {groupSkills.map((skill) => (
                        <SkillCard key={`${tag}-${skill.id}`} skill={skill} onToggle={handleToggle} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Presentational card for a single skill. Kept local to avoid leaking a
 * component module that isn't reused elsewhere.
 */
function SkillCard({ skill, onToggle }: { skill: Skill; onToggle: (id: string) => void }) {
  return (
    <div
      className={cn(
        'flex flex-col p-4 border rounded-lg bg-card text-card-foreground shadow-sm transition-all',
        skill.enabled ? 'border-primary/30' : '',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              'p-2 rounded-md shrink-0',
              skill.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            {skill.enabled ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-sm leading-none truncate">{skill.name}</h3>
              {skill.type && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-secondary-foreground uppercase tracking-wider">
                  {skill.type}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">{skill.id}</p>
            {skill.source && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] h-4 mt-0.5',
                  skill.type === 'mcp_tool'
                    ? 'border-purple-400/30 text-purple-400'
                    : skill.source === 'universal-skills'
                      ? 'border-blue-400/30 text-blue-400'
                      : 'border-muted-foreground/30 text-muted-foreground',
                )}
              >
                {skill.type === 'mcp_tool' ? (
                  <><Wrench className="size-2.5 mr-0.5" />{skill.source}</>
                ) : (
                  skill.source
                )}
              </Badge>
            )}
          </div>
        </div>
        <Switch
          checked={skill.enabled}
          onCheckedChange={() => onToggle(skill.id)}
          aria-label={`Toggle ${skill.name}`}
        />
      </div>
      <p className="text-sm text-muted-foreground line-clamp-2 mt-2">
        {skill.description ?? 'No description provided for this skill.'}
      </p>
      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {skill.tags.slice(0, 6).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              <TagIcon className="size-2.5 mr-1" />
              {tag}
            </Badge>
          ))}
          {skill.tags.length > 6 && (
            <Badge variant="secondary" className="text-[10px]">
              +{skill.tags.length - 6}
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
