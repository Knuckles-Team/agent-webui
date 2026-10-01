import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChatPanel from '../../../src/components/ChatPanel'
import { FilterBar } from '../../../src/components/atlas/FilterBar'
import { SchemaActionForm } from '../../../src/components/capabilities/SchemaActionForm'
import { PageContextProvider, usePageContextEnvelope } from '../../../src/lib/page-context'
import type { AdapterCapabilities, FilterSet } from '../../../src/lib/atlas/types'
import './style.css'

const capabilities: AdapterCapabilities = {
  introspect: true,
  filters: ['eq'],
  freeTextSearch: false,
  sort: false,
  rawQuery: false,
  graphProjection: false,
  pivots: false,
  live: false,
}

function FixtureContent() {
  const context = usePageContextEnvelope()
  const [filters, setFilters] = useState<FilterSet>({
    search: '',
    combinator: 'and',
    sort: null,
    limit: 500,
    clauses: [
      { id: 'first', field: 'name', op: 'eq', value: 'Ada' },
      { id: 'second', field: 'name', op: 'eq', value: 'Grace' },
    ],
  })
  return (
    <main className="p-4 space-y-4">
      <h1>Workspace accessibility fixture</h1>
      <FilterBar
        filters={filters}
        fields={[{ id: 'name', label: 'Name', kind: 'field', dataType: 'string' }]}
        capabilities={capabilities}
        onChange={setFilters}
      />
      <SchemaActionForm
        schema={{
          type: 'object',
          properties: {
            target: { type: 'string', title: 'Target', description: 'Select a target.' },
            use_cache: { type: 'boolean', title: 'Use cache', description: 'Reuse previous results.' },
          },
          required: ['target'],
        }}
        context={context}
        onSubmit={() => undefined}
      />
    </main>
  )
}

function Fixture() {
  const [primary, setPrimary] = useState(false)
  return (
    <PageContextProvider route={primary ? '/chat' : '/atlas'} view={primary ? 'chat' : 'atlas'}>
      <button onClick={() => setPrimary((value) => !value)}>Switch view</button>
      <FixtureContent />
      <ChatPanel currentView={primary ? 'chat' : 'atlas'} isPrimary={primary} />
    </PageContextProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
