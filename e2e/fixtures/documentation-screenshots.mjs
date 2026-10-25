// Synthetic, read-only documentation data. Never connect these captures to an account.
export const fixture = 'workspace-docs-v2'
export const fixedTime = '2026-01-15T12:00:00.000Z'
export const theme = 'light'
export const baseURL = 'http://127.0.0.1:5206'
export const viewports = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'narrow', width: 320, height: 740 },
]
export const scenes = [
  { name: 'work', path: '/workspace/work', ready: 'Chat & tasks' },
  { name: 'explore', path: '/workspace/explore?q=project&entity=doc%3Aresearch', ready: '2 matching records' },
  { name: 'operate', path: '/workspace/operate?server=catalog&item=search', ready: 'Backend readiness: ready' },
]
export const captures = scenes.flatMap((scene) =>
  viewports.map((viewport) => ({ ...scene, viewport, file: `${scene.name}-${viewport.name}.png` })),
)
const operation = (value) => ({
  ok: true,
  result: { value },
  meta: { registry_digest: 'synthetic', api_version: '1' },
})
export const responses = {
  '/auth/session': {
    authenticated: true,
    subject: 'documentation-demo',
    tenant: 'synthetic',
    webui_role: 'maintainer',
    roles: ['kg:read'],
    // The public fixture identifier satisfies the browser adapter, not a real session.
    csrf_token: fixture,
  },
  '/api/configure': { models: [], builtinTools: [] },
  '/api/enhanced/models': { models: [], default_id: '' },
  '/api/chats': [],
  '/api/chats/': { messages: [] },
  '/api/enhanced/mcp/servers/arbora/tools': { tools: [], total: 0, offset: 0, limit: 200, has_more: false },
  '/api/enhanced/sessions': [{ id: 'synthetic-research', status: { state: 'completed' } }],
  '/api/graph/traces': { result: [{ id: 'synthetic-trace', name: 'Synthetic project task', status: 'completed' }] },
  '/api/enhanced/ontology/object-set/search': {
    count: 2,
    rows: [
      { id: 'doc:research', type: 'Document', title: 'Project documentation' },
      { id: 'doc:sources', type: 'Collection', title: 'Setup notes' },
    ],
  },
  '/api/enhanced/ontology/object/doc%3Aresearch': {
    id: 'doc:research',
    object_type: 'Document',
    properties: {
      title: 'Project documentation',
      summary: 'Synthetic project documentation for this browser preview.',
      status: 'Reviewed',
    },
    links: {},
    history: [],
  },
  '/api/dashboard/readiness': {
    schema_version: 'arbora.readiness.v1',
    snapshot_id: 'synthetic-snapshot',
    observed_at: fixedTime,
    overall: 'ready',
    checks: { gateway: { state: 'ready' }, catalog: { state: 'ready' } },
    required_failures: [],
    degraded_reasons: [],
  },
  '/api/enhanced/tools': {
    source: 'epistemic_graph',
    servers: [{ server_id: 'srv:catalog', name: 'catalog', status: 'available', tool_count: 1 }],
    components: [
      {
        id: 'tool:search',
        name: 'Search',
        kind: 'tool',
        server_name: 'catalog',
        description: 'Synthetic search definition',
        status: 'active',
        authority: 'agent_component',
        revision: 1,
      },
    ],
  },
  '/api/v1/ops/fleet.status': operation({
    children: { catalog: { state: 'up', mounted_tools: 1 }, documents: { state: 'idle', mounted_tools: 0 } },
  }),
  '/api/v1/ops/fleet.catalog.list': operation({
    items: [
      {
        id: 'search',
        server: 'catalog',
        name: 'Search',
        kind: 'tool',
        description: 'Search synthetic project records.',
      },
    ],
    next_cursor: null,
  }),
}
