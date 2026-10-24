import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WebMcpControl, type WebMcpControlProps } from '../../../src/components/webmcp/WebMcpControl'
import type { WebMcpChannelView } from '../../../src/lib/webmcp/channel'
import { longArguments, tallArguments, requesterAgent, runReference } from './payload'
import './style.css'

function fixtureChannel(onResponse: (accepted: boolean) => void): WebMcpControlProps['channel'] {
  const listeners = new Set<() => void>()
  let view: WebMcpChannelView = {
    status: 'armed',
    toolIds: ['fixture.review'],
    pendingConfirmation: null,
    message: null,
    expiresAt: null,
    pendingProposal: {
      proposalId: 'proposal-fixture',
      proposalDigest: `sha256:${'a'.repeat(64)}`,
      toolId: 'fixture.review',
      toolTitle: 'Review synthetic arguments',
      argumentsJson: new URLSearchParams(location.search).get('payload') === 'tall' ? tallArguments : longArguments,
      requesterAgent,
      requesterRunRef: runReference,
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    },
  }
  function unexpectedAction(): never {
    throw new Error('Proposal review must not arm, confirm or execute')
  }
  return {
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    arm: async () => unexpectedAction(),
    confirm: unexpectedAction,
    deny: unexpectedAction,
    revoke: unexpectedAction,
    respondProposal(proposalId, accepted) {
      if (proposalId !== 'proposal-fixture') throw new Error('Unexpected proposal identity')
      onResponse(accepted)
      view = { ...view, pendingProposal: null }
      listeners.forEach((listener) => listener())
    },
  }
}

function Fixture() {
  const [response, setResponse] = useState('pending')
  const [channel] = useState(() => fixtureChannel((accepted) => setResponse(accepted ? 'accepted' : 'declined')))
  return (
    <main>
      <output data-testid="response">{response}</output>
      <WebMcpControl visible channel={channel} placement="workspace" collapsible />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
