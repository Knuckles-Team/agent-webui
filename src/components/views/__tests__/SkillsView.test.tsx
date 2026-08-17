import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import SkillsView, {
  skillSchema,
  skillGraphSchema,
  skillWorkflowSchema,
  toolsDataSchema,
} from '@/components/views/SkillsView'

/**
 * GOC-60-W06c/d coverage for SkillsView:
 *
 * 1. A zod round-trip test proving `domain`/`tags`/`runnable`/`resource_type`/
 *    `kg_classified` actually survive backend-shaped JSON through the zod
 *    boundary. Before this fix, `SkillGraph`/`SkillWorkflow` kept only
 *    `{id, name, type, file_path, enabled}` and `Skill` had no `domain` at
 *    all, so zod's default key-stripping silently dropped everything else
 *    the backend already sent (`_parse_skill_md` extracts `domain`/`tags`
 *    for every SKILL.md).
 * 2. A render test proving the cognitive registry groups by `domain` instead
 *    of rendering one flat unsectioned list, and that a describe-only
 *    workflow reads as "Describe-only" while a KG-verified skill reads as
 *    "Runnable" -- runnability shown explicitly, not implied by which box
 *    it's in.
 */

describe('SkillsView zod schemas — domain/tags/runnable round-trip (GOC-60-W06c)', () => {
  it('skillSchema keeps domain, tags, runnable, resource_type, and kg_classified', () => {
    const raw = {
      id: 'gitlab-issues',
      name: 'gitlab-issues',
      description: 'Manage GitLab issues.',
      enabled: true,
      tags: ['gitlab', 'issues'],
      domain: 'devops',
      type: 'Agent Skill',
      runnable: true,
      resource_type: 'AGENT_SKILL',
      kg_classified: true,
    }
    const parsed = skillSchema.parse(raw)
    expect(parsed.domain).toBe('devops')
    expect(parsed.tags).toEqual(['gitlab', 'issues'])
    expect(parsed.runnable).toBe(true)
    expect(parsed.resource_type).toBe('AGENT_SKILL')
    expect(parsed.kg_classified).toBe(true)
  })

  it('skillGraphSchema keeps domain and tags (previously absent from the type entirely)', () => {
    const raw = {
      id: 'skill-graph:finance-pipeline',
      name: 'finance-pipeline',
      type: 'Skill Graph',
      file_path: 'skill://finance-pipeline',
      enabled: true,
      domain: 'finance',
      tags: ['pipeline', 'quant'],
    }
    const parsed = skillGraphSchema.parse(raw)
    expect(parsed.domain).toBe('finance')
    expect(parsed.tags).toEqual(['pipeline', 'quant'])
  })

  it('skillWorkflowSchema keeps domain, tags, and the KG runnability fields', () => {
    const raw = {
      id: 'pairs-trading-project',
      name: 'pairs-trading-project',
      type: 'Skill Workflow',
      file_path: 'skill://pairs-trading-project',
      enabled: true,
      domain: 'finance-workflows',
      tags: ['quant', 'pairs-trading'],
      runnable: false,
      resource_type: 'WORKFLOW_DEFINITION',
      kg_classified: true,
    }
    const parsed = skillWorkflowSchema.parse(raw)
    expect(parsed.domain).toBe('finance-workflows')
    expect(parsed.tags).toEqual(['quant', 'pairs-trading'])
    expect(parsed.runnable).toBe(false)
    expect(parsed.resource_type).toBe('WORKFLOW_DEFINITION')
    expect(parsed.kg_classified).toBe(true)
  })

  it('toolsDataSchema round-trips the full /api/enhanced/tools payload including skill_unclassified and skill_classification', () => {
    const raw = {
      mcp_tools: [],
      mcp_status: { source: 'multiplexer', error: null },
      builtin_tools: [],
      skills: [
        {
          id: 'a',
          name: 'a',
          enabled: true,
          tags: ['x'],
          domain: 'ops',
          type: 'Agent Skill',
          runnable: true,
          resource_type: 'AGENT_SKILL',
          kg_classified: true,
        },
      ],
      skill_graphs: [],
      skill_workflows: [],
      skill_unclassified: [
        {
          id: 'b',
          name: 'b',
          enabled: true,
          tags: [],
          domain: 'never-ingested',
          type: 'Unclassified',
          runnable: false,
          resource_type: null,
          kg_classified: false,
        },
      ],
      skill_classification: {
        source: 'kg_resource_type',
        kg_reachable: true,
        filesystem_skill_md_count: 2,
        kg_agent_skill_count: 1,
        kg_workflow_definition_count: 0,
        runnable_count: 1,
        describe_only_count: 0,
        unclassified_count: 1,
      },
    }
    const parsed = toolsDataSchema.parse(raw)
    expect(parsed.skills[0]?.domain).toBe('ops')
    expect(parsed.skill_unclassified[0]?.kg_classified).toBe(false)
    expect(parsed.skill_classification.unclassified_count).toBe(1)
  })
})

function mockFetch(body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })))
}

const GROUPED_PAYLOAD = {
  mcp_tools: [],
  mcp_status: { source: 'multiplexer', error: null },
  builtin_tools: [],
  skills: [
    {
      id: 'finance-skill',
      name: 'finance-skill',
      description: 'A runnable finance skill.',
      enabled: true,
      tags: ['quant'],
      domain: 'finance',
      type: 'Agent Skill',
      runnable: true,
      resource_type: 'AGENT_SKILL',
      kg_classified: true,
    },
    {
      id: 'ops-skill',
      name: 'ops-skill',
      description: 'A runnable ops skill.',
      enabled: true,
      tags: [],
      domain: 'ops',
      type: 'Agent Skill',
      runnable: true,
      resource_type: 'AGENT_SKILL',
      kg_classified: true,
    },
  ],
  skill_graphs: [],
  skill_workflows: [
    {
      id: 'finance-workflow',
      name: 'finance-workflow',
      type: 'Skill Workflow',
      file_path: 'skill://finance-workflow',
      enabled: true,
      domain: 'finance',
      tags: [],
      runnable: false,
      resource_type: 'WORKFLOW_DEFINITION',
      kg_classified: true,
    },
  ],
  skill_unclassified: [],
  skill_classification: {
    source: 'kg_resource_type',
    kg_reachable: true,
    filesystem_skill_md_count: 3,
    kg_agent_skill_count: 2,
    kg_workflow_definition_count: 1,
    runnable_count: 2,
    describe_only_count: 1,
    unclassified_count: 0,
  },
}

describe('SkillsView cognitive registry — grouped by domain (GOC-60-W06d)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch(GROUPED_PAYLOAD))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('groups Agent Skills by domain and shows the Cognitive Skills tab count', async () => {
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Cognitive Skills')).toBeInTheDocument()
    })
    // The default active tab is MCP Servers; switch to Cognitive Skills.
    screen.getByText('Cognitive Skills').closest('button')?.click()

    await waitFor(() => {
      expect(screen.getByText('finance-skill')).toBeInTheDocument()
    })
    // Both domain group headers render -- proof of grouping, not a flat list.
    // "finance" appears twice (Agent Skills box + Skill Workflows box).
    expect(screen.getAllByText('finance').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('ops')).toBeInTheDocument()
    expect(screen.getByText('ops-skill')).toBeInTheDocument()
  })

  it('shows a runnable skill and a describe-only workflow distinguished explicitly', async () => {
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Cognitive Skills')).toBeInTheDocument()
    })
    screen.getByText('Cognitive Skills').closest('button')?.click()

    await waitFor(() => {
      expect(screen.getByText('finance-workflow')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Runnable').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Describe-only').length).toBeGreaterThan(0)
  })
})
