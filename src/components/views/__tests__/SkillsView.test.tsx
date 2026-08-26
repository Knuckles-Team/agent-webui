import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { toast } from 'sonner'
import SkillsView, {
  skillSchema,
  skillGraphSchema,
  skillWorkflowSchema,
  toolsDataSchema,
} from '@/components/views/SkillsView'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

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

  it('toolsDataSchema round-trips the full /api/enhanced/tools payload, with an unclassified skill inside `skills` (no fourth bucket)', () => {
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
        {
          id: 'b',
          name: 'b',
          enabled: true,
          tags: [],
          domain: 'never-ingested',
          type: 'Mystery',
          runnable: false,
          resource_type: null,
          kg_classified: false,
        },
      ],
      skill_graphs: [],
      skill_workflows: [],
      skill_classification: {
        source: 'sql_catalog',
        kg_reachable: true,
        filesystem_skill_md_count: 2,
        kg_agent_skill_count: 2,
        kg_workflow_definition_count: 0,
        runnable_count: 1,
        describe_only_count: 0,
        unclassified_count: 1,
      },
    }
    const parsed = toolsDataSchema.parse(raw)
    expect(parsed.skills[0]?.domain).toBe('ops')
    expect(parsed.skills[1]?.kg_classified).toBe(false)
    expect(parsed.skill_classification.unclassified_count).toBe(1)
    expect('skill_unclassified' in parsed).toBe(false)
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
    {
      id: 'mystery-skill',
      name: 'mystery-skill',
      description: 'A skill whose classification is not yet recognized.',
      enabled: true,
      tags: [],
      domain: 'ops',
      type: 'Mystery',
      runnable: false,
      resource_type: null,
      kg_classified: false,
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
  skill_classification: {
    source: 'sql_catalog',
    kg_reachable: true,
    filesystem_skill_md_count: 4,
    kg_agent_skill_count: 3,
    kg_workflow_definition_count: 1,
    runnable_count: 2,
    describe_only_count: 1,
    unclassified_count: 1,
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

describe('SkillsView — unclassified skills flagged in place, not a fourth group', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function openCognitiveTab() {
    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Cognitive Skills')).toBeInTheDocument()
    })
    screen.getByText('Cognitive Skills').closest('button')?.click()
    await waitFor(() => {
      expect(screen.getByText('mystery-skill')).toBeInTheDocument()
    })
  }

  it('renders exactly three cognitive boxes -- Agent Skills, Skill Graphs, Skill Workflows -- and no fourth "Unclassified" box', async () => {
    vi.stubGlobal('fetch', mockFetch(GROUPED_PAYLOAD))
    await openCognitiveTab()

    expect(screen.getByText('Agent Skills')).toBeInTheDocument()
    expect(screen.getByText('Skill Graphs')).toBeInTheDocument()
    expect(screen.getByText('Skill Workflows')).toBeInTheDocument()
    // "Unclassified" appears only as the per-item badge text on mystery-skill,
    // never as a box title (there is no h3 with this text).
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).not.toContain('Unclassified')
  })

  it('flags the unclassified skill inside the Agent Skills group', async () => {
    vi.stubGlobal('fetch', mockFetch(GROUPED_PAYLOAD))
    await openCognitiveTab()

    // The unclassified skill sits among the other agent skills...
    expect(screen.getByText('mystery-skill')).toBeInTheDocument()
    expect(screen.getByText('finance-skill')).toBeInTheDocument()
    // ...and carries the "Unclassified" flag a classified skill does not.
    expect(screen.getByText('Unclassified')).toBeInTheDocument()
    // It also exposes the classify control (an already-classified skill does not).
    expect(screen.getByLabelText('Classify mystery-skill')).toBeInTheDocument()
    expect(screen.queryByLabelText('Classify finance-skill')).not.toBeInTheDocument()
  })

  it('classifying a skill persists it and refreshes from the real (confirmed) backend state', async () => {
    const reclassifiedPayload = {
      ...GROUPED_PAYLOAD,
      skills: GROUPED_PAYLOAD.skills.map((s) =>
        s.id === 'mystery-skill'
          ? { ...s, type: 'Atomic Skill', runnable: true, resource_type: 'AGENT_SKILL', kg_classified: true }
          : s,
      ),
      skill_classification: { ...GROUPED_PAYLOAD.skill_classification, unclassified_count: 0 },
    }
    // First GET returns the unclassified state; the refetch AFTER a
    // confirmed persist returns the now-classified state -- proving the
    // badge change comes from the backend, never an optimistic patch. Order-
    // sensitive, so this is a sequenced mock rather than `routedFetch`
    // (which cannot distinguish "before" from "after" the POST).
    let toolsGetCount = 0
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/api/skill/classify') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'success',
              result: {
                persisted: true,
                reason: null,
                skill_type: 'skill',
                classification: 'Atomic Skill',
                persisted_to_source_file: true,
                persisted_as_durable_override: false,
                catalog_refreshed: true,
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (url.includes('/api/enhanced/tools')) {
        toolsGetCount += 1
        const body = toolsGetCount === 1 ? GROUPED_PAYLOAD : reclassifiedPayload
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await openCognitiveTab()

    fireEvent.change(screen.getByLabelText('Classify mystery-skill'), { target: { value: 'skill' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => c[0].includes('/api/skill/classify') && c[1]?.method === 'POST',
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(String((postCall?.[1] as RequestInit).body))
      expect(body).toEqual({ skill_id: 'mystery-skill', skill_type: 'skill' })
    })
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled()
    })
    expect(toast.error).not.toHaveBeenCalled()
    // The refetch happened, and the UI now reflects the backend's confirmed
    // state -- the flag is gone because the backend says so, not the click.
    await waitFor(() => {
      expect(screen.queryByLabelText('Classify mystery-skill')).not.toBeInTheDocument()
    })
  })

  it('a refused classification surfaces as a failure, never a silent success', async () => {
    const fetchMock = routedFetch([
      {
        match: (u, i) => u.includes('/api/skill/classify') && i?.method === 'POST',
        body: {
          status: 'success',
          result: {
            persisted: false,
            reason: 'the skills source tree is not writable from this process',
            skill_type: 'skill',
            classification: 'Atomic Skill',
            persisted_to_source_file: false,
            persisted_as_durable_override: false,
            catalog_refreshed: false,
          },
        },
      },
      { match: (u) => u.includes('/api/enhanced/tools'), body: GROUPED_PAYLOAD },
    ])
    vi.stubGlobal('fetch', fetchMock)
    await openCognitiveTab()

    fireEvent.change(screen.getByLabelText('Classify mystery-skill'), { target: { value: 'skill' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('the skills source tree is not writable from this process')
    })
    expect(toast.success).not.toHaveBeenCalled()
    // A failed persist must not be re-fetched as if it changed anything --
    // the flag stays exactly where it was.
    expect(screen.getByLabelText('Classify mystery-skill')).toBeInTheDocument()
    expect(screen.getByText('Unclassified')).toBeInTheDocument()
  })
})

const MCP_SERVER_SCHEMA = {
  properties: {
    command: { type: 'string', title: 'Command' },
    url: { type: 'string', title: 'Url' },
    args: { type: 'array', items: { type: 'string' }, title: 'Args', default: [] },
    env: { type: 'object', title: 'Env', default: {} },
    transport: { type: 'string', enum: ['', 'streamable-http', 'sse'], title: 'Transport', default: '' },
    headers: { type: 'object', title: 'Headers', default: {} },
    disabled: { type: 'boolean', title: 'Disabled', default: false },
    timeout: { type: 'number', title: 'Timeout', default: 300.0 },
    allowed_private_hosts: { type: 'array', items: { type: 'string' }, title: 'Allowed private hosts', default: [] },
  },
}

const EMPTY_TOOLS_PAYLOAD = {
  ...GROUPED_PAYLOAD,
  skills: [],
  skill_workflows: [],
}

/** Routes a fetch mock by URL/method so the Add-server flow (GET /tools ->
 * GET /mcp/server-schema -> POST /mcp/servers) can be exercised end to end. */
function routedFetch(routes: { match: (url: string, init?: RequestInit) => boolean; body: unknown }[]) {
  return vi.fn((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match(url, init))
    return Promise.resolve(new Response(JSON.stringify(route ? route.body : {}), { status: route ? 200 : 404 }))
  })
}

describe('SkillsView — Add MCP Server (schema-derived form)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the live schema and POSTs the submitted server to /api/enhanced/mcp/servers', async () => {
    const fetchMock = routedFetch([
      { match: (u) => u.includes('/api/enhanced/tools'), body: EMPTY_TOOLS_PAYLOAD },
      { match: (u) => u.includes('/api/enhanced/mcp/server-schema'), body: MCP_SERVER_SCHEMA },
      {
        match: (u, i) => u.includes('/api/enhanced/mcp/servers') && i?.method === 'POST',
        body: { status: 'success' },
      },
    ])
    vi.stubGlobal('fetch', fetchMock)

    render(<SkillsView />)
    await waitFor(() => {
      expect(screen.getByText('Add MCP Server')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add MCP Server'))

    await waitFor(() => {
      expect(screen.getByLabelText(/^Name/)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'ansible-tower-mcp' } })
    fireEvent.change(screen.getByLabelText(/Url/), {
      target: { value: 'https://ansible-tower-mcp.example/mcp' },
    })
    fireEvent.click(screen.getByText('Review preflight'))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => c[0].includes('/api/enhanced/mcp/servers') && c[1]?.method === 'POST',
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(String((postCall?.[1] as RequestInit).body))
      expect(body.name).toBe('ansible-tower-mcp')
      expect(body.config.url).toBe('https://ansible-tower-mcp.example/mcp')
    })
  })
})

/**
 * Regression coverage for the "Manage MCP Tools" expand/collapse control
 * (the tools view's own box/panel toggle, `expandedMcp` in SkillsView).
 * Guards against the exact bug shape reported against this page -- an
 * expand handler that only ever sets state to `true`, or a stale/unkeyed
 * read that makes a second click a no-op -- by asserting a full
 * expand -> collapse -> expand -> collapse round trip, and that two
 * independent server panels don't share state. Also verified against a
 * real Chromium render (Playwright, StrictMode) during investigation; both
 * confirm the toggle is already symmetric on this code path.
 */
describe('SkillsView — Manage MCP Tools panel toggles both ways (fix/tools-collapse)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const TWO_SERVER_PAYLOAD = {
    ...GROUPED_PAYLOAD,
    skills: [],
    skill_workflows: [],
    mcp_tools: [
      { name: 'server-a', type: 'mcp', status: 'ok', enabled: true, tool_count: 1 },
      { name: 'server-b', type: 'mcp', status: 'ok', enabled: true, tool_count: 1 },
    ],
  }

  function routeTwoServerFetch() {
    return vi.fn((url: string) => {
      if (url.includes('/api/enhanced/mcp/servers/server-a/tools')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: 'ta1', description: 'x', input_schema: {}, enabled: true }]), {
            status: 200,
          }),
        )
      }
      if (url.includes('/api/enhanced/mcp/servers/server-b/tools')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: 'tb1', description: 'x', input_schema: {}, enabled: true }]), {
            status: 200,
          }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify(TWO_SERVER_PAYLOAD), { status: 200 }))
    })
  }

  it('a single server panel survives expand -> collapse -> expand -> collapse', async () => {
    vi.stubGlobal('fetch', routeTwoServerFetch())
    render(<SkillsView />)
    await waitFor(() => expect(screen.getByText('server-a')).toBeInTheDocument())

    const buttons = screen.getAllByText('Manage MCP Tools')
    const btn = buttons[0]

    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByText('ta1')).toBeInTheDocument())

    fireEvent.click(btn)
    await waitFor(() => expect(screen.queryByText('ta1')).not.toBeInTheDocument())

    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByText('ta1')).toBeInTheDocument())

    fireEvent.click(btn)
    await waitFor(() => expect(screen.queryByText('ta1')).not.toBeInTheDocument())
  })

  it('collapsing one server panel does not affect an independently expanded sibling panel', async () => {
    vi.stubGlobal('fetch', routeTwoServerFetch())
    render(<SkillsView />)
    await waitFor(() => expect(screen.getByText('server-a')).toBeInTheDocument())
    expect(screen.getByText('server-b')).toBeInTheDocument()

    const [btnA, btnB] = screen.getAllByText('Manage MCP Tools')

    fireEvent.click(btnA)
    await waitFor(() => expect(screen.getByText('ta1')).toBeInTheDocument())
    fireEvent.click(btnB)
    await waitFor(() => expect(screen.getByText('tb1')).toBeInTheDocument())

    fireEvent.click(btnA)
    await waitFor(() => expect(screen.queryByText('ta1')).not.toBeInTheDocument())
    expect(screen.getByText('tb1')).toBeInTheDocument()

    fireEvent.click(btnB)
    await waitFor(() => expect(screen.queryByText('tb1')).not.toBeInTheDocument())
  })
})
