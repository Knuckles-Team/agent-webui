import { z } from 'zod'
import { canonicalJson, digestBoundedArguments } from './canonical'
import { WEBMCP_CONTROL_PROTOCOL } from './catalog'
import type { ActiveWebMcpRegistry } from './registry'
import { validateWebMcpArguments } from './validation'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const ProposalRequestSchema = z
  .object({
    protocol: z.literal(WEBMCP_CONTROL_PROTOCOL),
    type: z.literal('control.proposal_request'),
    proposal_id: id,
    proposal_digest: digest,
    registration_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    tool_id: id,
    schema_digest: digest,
    arguments: z.record(z.string(), z.json()),
    requester_agent: z.string().min(1).max(512),
    requester_run_ref: id,
    expires_at: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
export const ProposalWithdrawnSchema = z
  .object({
    protocol: z.literal(WEBMCP_CONTROL_PROTOCOL),
    type: z.literal('control.proposal_withdrawn'),
    proposal_id: id,
    reason: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  })
  .strict()

export interface WebMcpPendingProposal {
  readonly proposalId: string
  readonly proposalDigest: string
  readonly toolId: string
  readonly toolTitle: string
  readonly argumentsJson: string
  readonly requesterAgent: string
  readonly requesterRunRef: string
  readonly expiresAt: number
}
export interface WebMcpProposalResponse {
  readonly protocol: typeof WEBMCP_CONTROL_PROTOCOL
  readonly type: 'control.proposal_response'
  readonly proposal_id: string
  readonly proposal_digest: string
  readonly accepted: boolean
}
interface ProposalOptions {
  readonly registry: ActiveWebMcpRegistry
  readonly registrationGeneration: number
  readonly send: (message: WebMcpProposalResponse) => void
  readonly onProposalChange?: (proposal: WebMcpPendingProposal | null) => void
}

/** A proposal is a request for human attention, never permission to execute. */
export class AttendedWebMcpProposals {
  private readonly seen = new Set<string>()
  private pending: WebMcpPendingProposal | null = null
  private preparing: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private readonly unsubscribe: () => void

  private readonly options: ProposalOptions

  constructor(options: ProposalOptions) {
    this.options = options
    this.unsubscribe = options.registry.subscribe(() => {
      if (options.registry.currentGeneration() !== options.registrationGeneration) this.retire()
    })
  }

  async request(message: z.infer<typeof ProposalRequestSchema>): Promise<void> {
    this.reserve(message)
    try {
      const snapshot = await this.options.registry.snapshot(this.options.registrationGeneration)
      const descriptor = snapshot.catalog.tools.find((tool) => tool.toolId === message.tool_id)
      if (descriptor?.schemaDigest !== message.schema_digest) {
        throw new Error('WebMCP proposal schema is not active')
      }
      await digestBoundedArguments(message.arguments)
      const tool = await this.options.registry.resolveTool(snapshot.generation, message.tool_id)
      validateWebMcpArguments(tool.execute, message.arguments)
      if (this.closed || this.preparing !== message.proposal_id) return
      if (message.expires_at * 1_000 <= Date.now()) return
      this.pending = {
        proposalId: message.proposal_id,
        proposalDigest: message.proposal_digest,
        toolId: message.tool_id,
        toolTitle: descriptor.title,
        argumentsJson: canonicalJson(message.arguments),
        requesterAgent: message.requester_agent,
        requesterRunRef: message.requester_run_ref,
        expiresAt: message.expires_at,
      }
      this.timer = setTimeout(
        () => {
          this.withdraw(message.proposal_id)
        },
        message.expires_at * 1_000 - Date.now(),
      )
      this.options.onProposalChange?.(this.pending)
    } finally {
      if (this.preparing === message.proposal_id) this.preparing = null
    }
  }

  respond(proposalId: string, accepted: boolean): void {
    const pending = this.pending
    if (this.closed || pending?.proposalId !== proposalId) throw new Error('No matching proposal is pending')
    if (
      pending.expiresAt * 1_000 <= Date.now() ||
      this.options.registry.currentGeneration() !== this.options.registrationGeneration
    ) {
      this.withdraw(proposalId)
      throw new Error('WebMCP proposal has expired or retired')
    }
    this.withdraw(proposalId)
    this.options.send({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.proposal_response',
      proposal_id: proposalId,
      proposal_digest: pending.proposalDigest,
      accepted,
    })
  }

  withdraw(proposalId: string): void {
    if (!this.seen.has(proposalId)) {
      if (this.seen.size >= 256) throw new Error('WebMCP proposal bound was exceeded')
      this.seen.add(proposalId)
    }
    if (this.preparing === proposalId) this.preparing = null
    if (this.pending?.proposalId !== proposalId) return
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
    this.options.onProposalChange?.(null)
  }

  retire(): void {
    if (this.closed) return
    this.closed = true
    this.preparing = null
    if (this.pending) this.withdraw(this.pending.proposalId)
    this.unsubscribe()
  }

  private reserve(message: z.infer<typeof ProposalRequestSchema>): void {
    if (this.closed || message.registration_generation !== this.options.registrationGeneration) {
      throw new Error('WebMCP proposal generation is not active')
    }
    const remaining = message.expires_at * 1_000 - Date.now()
    if (remaining <= 0 || remaining > 2_147_483_647) throw new Error('WebMCP proposal expiry is invalid')
    if (this.pending || this.preparing || this.seen.has(message.proposal_id))
      throw new Error('WebMCP proposal is already pending or terminal')
    if (this.seen.size >= 256) throw new Error('WebMCP proposal bound was exceeded')
    this.seen.add(message.proposal_id)
    this.preparing = message.proposal_id
  }
}
