import { z } from 'zod'
import { canonicalJson, digestBoundedArguments, utf8ByteLength } from './canonical'
import { WEBMCP_CONTROL_PROTOCOL, type WebMcpCapabilityDescriptor } from './catalog'
import { ActiveWebMcpRegistry } from './registry'
import { WEBMCP_OUTPUT_BYTE_BUDGET } from './validation'

const boundedId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const boundedReason = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const jsonArguments = z.record(z.string(), z.json())
const MAX_TERMINAL_CONFIRMATIONS = 256

const ConfirmationRequestSchema = z
  .object({
    protocol: z.literal(WEBMCP_CONTROL_PROTOCOL),
    type: z.literal('control.confirmation_request'),
    call_id: boundedId,
    lease_id: boundedId,
    tool_id: boundedId,
    arguments: jsonArguments,
    confirmation_digest: sha256Digest,
  })
  .strict()

const ControlCallSchema = z
  .object({
    protocol: z.literal(WEBMCP_CONTROL_PROTOCOL),
    type: z.literal('control.call'),
    call_id: boundedId,
    lease_id: boundedId,
    tool_id: boundedId,
    arguments: jsonArguments,
    confirmation_digest: sha256Digest.optional(),
    authorization: z.enum(['read', 'confirmed_mutation']),
  })
  .strict()

const ControlCancelSchema = z
  .object({
    protocol: z.literal(WEBMCP_CONTROL_PROTOCOL),
    type: z.literal('control.cancel'),
    call_id: boundedId,
    reason: boundedReason,
  })
  .strict()

export type WebMcpCancellationEffect = 'none' | 'browser_reported_committed' | 'unknown'

export interface WebMcpPendingConfirmation {
  readonly callId: string
  readonly leaseId: string
  readonly toolId: string
  readonly toolTitle: string
  readonly toolVersion: string
  readonly schemaDigest: string
  readonly argumentDigest: string
  readonly confirmationDigest: string
}

export type WebMcpBrowserMessage =
  | {
      readonly protocol: typeof WEBMCP_CONTROL_PROTOCOL
      readonly type: 'control.confirm'
      readonly call_id: string
      readonly confirmation_digest: string
    }
  | {
      readonly protocol: typeof WEBMCP_CONTROL_PROTOCOL
      readonly type: 'control.result'
      readonly call_id: string
      readonly status: 'succeeded' | 'failed'
      readonly result?: unknown
      readonly error_code?: string
    }
  | {
      readonly protocol: typeof WEBMCP_CONTROL_PROTOCOL
      readonly type: 'control.cancelled'
      readonly call_id: string
      readonly effect: WebMcpCancellationEffect
    }

export type WebMcpServerMessage =
  z.infer<typeof ConfirmationRequestSchema> | z.infer<typeof ControlCallSchema> | z.infer<typeof ControlCancelSchema>

interface RunningCall {
  readonly controller: AbortController
  mutating: boolean
  started: boolean
  cancellationReported: boolean
}

type ApprovedConfirmation = WebMcpPendingConfirmation
type ControlCall = z.infer<typeof ControlCallSchema>

function confirmationFailure(): never {
  throw new Error('WebMCP mutation is missing exact-request confirmation')
}

function assertReadAuthorization(message: ControlCall): void {
  if (message.authorization !== 'read') throw new Error('WebMCP read authorization does not match the tool')
  if (message.confirmation_digest !== undefined) throw new Error('WebMCP read authorization does not match the tool')
}

function assertMutationAuthorization(message: ControlCall): void {
  if (message.authorization !== 'confirmed_mutation') confirmationFailure()
  if (!message.confirmation_digest) confirmationFailure()
}

function assertConfirmationBinding(
  approved: ApprovedConfirmation,
  message: ControlCall,
  descriptor: WebMcpCapabilityDescriptor,
): void {
  const exact = [
    approved.callId === message.call_id,
    approved.leaseId === message.lease_id,
    approved.toolId === message.tool_id,
    approved.toolVersion === descriptor.version,
    approved.schemaDigest === descriptor.schemaDigest,
    approved.confirmationDigest === message.confirmation_digest,
  ].every(Boolean)
  if (!exact) confirmationFailure()
}

export interface RemoteWebMcpDispatcherOptions {
  readonly registry: ActiveWebMcpRegistry
  readonly registrationGeneration: number
  readonly send: (message: WebMcpBrowserMessage) => void
  readonly onConfirmationChange?: (confirmation: WebMcpPendingConfirmation | null) => void
}

function parseServerMessage(raw: unknown): WebMcpServerMessage {
  const discriminant = z.looseObject({ type: z.string() }).parse(raw).type
  if (discriminant === 'control.confirmation_request') return ConfirmationRequestSchema.parse(raw)
  if (discriminant === 'control.call') return ControlCallSchema.parse(raw)
  if (discriminant === 'control.cancel') return ControlCancelSchema.parse(raw)
  throw new Error('Unsupported WebMCP control message')
}

function descriptorFor(
  descriptors: readonly WebMcpCapabilityDescriptor[],
  toolId: string,
): WebMcpCapabilityDescriptor {
  const descriptor = descriptors.find((candidate) => candidate.toolId === toolId)
  if (!descriptor) throw new Error('WebMCP tool is not active in this generation')
  return descriptor
}

function assertConfirmableDescriptor(descriptor: WebMcpCapabilityDescriptor): void {
  if (descriptor.mutationClass !== 'local-ui-mutation' || descriptor.confirmation !== 'exact-request') {
    throw new Error('WebMCP confirmation was requested for an ineligible tool')
  }
}

function cancellationEffect(call: RunningCall, browserReportedCommitted = false): WebMcpCancellationEffect {
  if (!call.started || !call.mutating) return 'none'
  return browserReportedCommitted ? 'browser_reported_committed' : 'unknown'
}

function assertBoundedResult(result: unknown): void {
  if (
    result === undefined ||
    typeof result === 'function' ||
    typeof result === 'symbol' ||
    typeof result === 'bigint'
  ) {
    throw new Error('WebMCP result is not JSON compatible')
  }
  const serialized = canonicalJson(result)
  if (utf8ByteLength(serialized) > WEBMCP_OUTPUT_BYTE_BUDGET) {
    throw new Error('WebMCP result exceeded the channel result bound')
  }
}

/**
 * Executes commands only through the exact definitions retained by the native
 * WebMCP registry. Graph OS remains the lease, replay, authorization, and call
 * authority; this class holds only in-flight browser work and attended UI state.
 */
export class RemoteWebMcpDispatcher {
  private readonly registry: ActiveWebMcpRegistry
  private readonly generation: number
  private readonly sendMessage: (message: WebMcpBrowserMessage) => void
  private readonly notifyConfirmation: (confirmation: WebMcpPendingConfirmation | null) => void
  private readonly running = new Map<string, RunningCall>()
  private readonly preparingConfirmations = new Map<string, string>()
  private readonly terminalConfirmations = new Map<string, string>()
  private pending: WebMcpPendingConfirmation | null = null
  private approved: ApprovedConfirmation | null = null
  private closed = false

  constructor(options: RemoteWebMcpDispatcherOptions) {
    this.registry = options.registry
    this.generation = options.registrationGeneration
    this.sendMessage = options.send
    this.notifyConfirmation = options.onConfirmationChange ?? (() => undefined)
  }

  async accept(raw: unknown): Promise<void> {
    if (this.closed) throw new Error('WebMCP dispatcher is closed')
    const message = parseServerMessage(raw)
    if (message.type === 'control.confirmation_request') {
      await this.requestConfirmation(message)
      return
    }
    if (message.type === 'control.cancel') {
      this.cancel(message.call_id)
      return
    }
    await this.execute(message)
  }

  confirm(callId: string): void {
    const confirmation = this.pending
    if (confirmation?.callId !== callId) throw new Error('No matching WebMCP confirmation is pending')
    this.approved = confirmation
    this.pending = null
    this.notifyConfirmation(null)
    this.sendMessage({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.confirm',
      call_id: confirmation.callId,
      confirmation_digest: confirmation.confirmationDigest,
    })
  }

  deny(callId: string): void {
    if (this.pending?.callId !== callId) return
    this.recordTerminalConfirmation(callId, this.pending.confirmationDigest)
    this.pending = null
    this.notifyConfirmation(null)
    this.sendCancelled(callId, 'none')
  }

  close(reportCancellation = true): void {
    if (this.closed) return
    this.closed = true
    if (reportCancellation && this.pending?.callId) this.sendCancelled(this.pending.callId, 'none')
    this.pending = null
    this.approved = null
    this.notifyConfirmation(null)
    this.preparingConfirmations.forEach((_confirmationDigest, callId) => {
      if (reportCancellation) this.sendCancelled(callId, 'none')
    })
    this.running.forEach((call, callId) => {
      call.controller.abort()
      if (reportCancellation && !call.cancellationReported) this.sendCancelled(callId, cancellationEffect(call))
    })
    this.running.clear()
    this.preparingConfirmations.clear()
    this.terminalConfirmations.clear()
  }

  private async requestConfirmation(message: z.infer<typeof ConfirmationRequestSchema>): Promise<void> {
    this.reserveConfirmation(message.call_id, message.confirmation_digest)
    try {
      const snapshot = await this.registry.snapshot(this.generation)
      const descriptor = descriptorFor(snapshot.catalog.tools, message.tool_id)
      assertConfirmableDescriptor(descriptor)
      const confirmation = await this.buildConfirmation(message, descriptor)
      if (this.closed || this.terminalConfirmations.has(message.call_id)) return
      this.publishConfirmation(confirmation)
    } finally {
      this.preparingConfirmations.delete(message.call_id)
    }
  }

  private reserveConfirmation(callId: string, confirmationDigest: string): void {
    const terminalDigest = this.terminalConfirmations.get(callId)
    if (terminalDigest !== undefined) {
      const detail = terminalDigest === confirmationDigest ? 'is terminal' : 'changed its terminal digest'
      throw new Error(`WebMCP confirmation ${detail}`)
    }
    if (this.preparingConfirmations.has(callId) || this.running.has(callId)) {
      throw new Error('WebMCP call is already pending')
    }
    if (this.terminalConfirmations.size + this.preparingConfirmations.size >= MAX_TERMINAL_CONFIRMATIONS) {
      throw new Error('WebMCP terminal confirmation bound was exceeded')
    }
    this.preparingConfirmations.set(callId, confirmationDigest)
  }

  private async buildConfirmation(
    message: z.infer<typeof ConfirmationRequestSchema>,
    descriptor: WebMcpCapabilityDescriptor,
  ): Promise<WebMcpPendingConfirmation> {
    return {
      callId: message.call_id,
      leaseId: message.lease_id,
      toolId: message.tool_id,
      toolTitle: descriptor.title,
      toolVersion: descriptor.version,
      schemaDigest: descriptor.schemaDigest,
      argumentDigest: await digestBoundedArguments(message.arguments),
      confirmationDigest: message.confirmation_digest,
    }
  }

  private publishConfirmation(confirmation: WebMcpPendingConfirmation): void {
    if (this.pending && this.pending.callId !== confirmation.callId) {
      this.recordTerminalConfirmation(this.pending.callId, this.pending.confirmationDigest)
      this.sendCancelled(this.pending.callId, 'none')
    }
    this.pending = confirmation
    this.approved = null
    this.notifyConfirmation(confirmation)
  }

  private async execute(message: ControlCall): Promise<void> {
    if (this.running.has(message.call_id)) throw new Error('WebMCP call is already running')
    const controller = new AbortController()
    const runningCall: RunningCall = { controller, mutating: false, started: false, cancellationReported: false }
    this.running.set(message.call_id, runningCall)
    try {
      const snapshot = await this.registry.snapshot(this.generation)
      const descriptor = descriptorFor(snapshot.catalog.tools, message.tool_id)
      runningCall.mutating = descriptor.mutationClass === 'local-ui-mutation'
      await this.verifyAuthorization(message, descriptor)
      const tool = await this.registry.resolveTool(this.generation, message.tool_id)
      if (controller.signal.aborted) return
      runningCall.started = true
      try {
        const result = await tool.execute(message.arguments, { signal: controller.signal })
        this.reportExecutionSuccess(message.call_id, runningCall, result)
      } catch {
        this.reportExecutionFailure(message.call_id, runningCall)
      }
    } finally {
      this.running.delete(message.call_id)
      if (this.approved?.callId === message.call_id) this.approved = null
    }
  }

  private async verifyAuthorization(message: ControlCall, descriptor: WebMcpCapabilityDescriptor): Promise<void> {
    const argumentDigest = await digestBoundedArguments(message.arguments)
    if (descriptor.mutationClass === 'read') {
      assertReadAuthorization(message)
      return
    }
    assertMutationAuthorization(message)
    const approved = this.approved
    if (!approved) confirmationFailure()
    assertConfirmationBinding(approved, message, descriptor)
    if (approved.argumentDigest !== argumentDigest) confirmationFailure()
  }

  private reportExecutionSuccess(callId: string, running: RunningCall, result: unknown): void {
    if (!running.controller.signal.aborted) {
      assertBoundedResult(result)
      this.sendMessage({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.result',
        call_id: callId,
        status: 'succeeded',
        result,
      })
      return
    }
    if (!running.cancellationReported) {
      this.sendCancelled(callId, cancellationEffect(running, true))
    }
  }

  private reportExecutionFailure(callId: string, running: RunningCall): void {
    if (!running.controller.signal.aborted) {
      this.sendMessage({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.result',
        call_id: callId,
        status: 'failed',
        error_code: 'browser_execution_failed',
      })
      return
    }
    if (!running.cancellationReported) this.sendCancelled(callId, cancellationEffect(running))
  }

  private cancel(callId: string): void {
    const preparingDigest = this.preparingConfirmations.get(callId)
    if (preparingDigest) {
      if (this.recordTerminalConfirmation(callId, preparingDigest)) {
        this.sendCancelled(callId, 'none')
      }
      return
    }
    if (this.pending?.callId === callId) {
      this.recordTerminalConfirmation(callId, this.pending.confirmationDigest)
      this.pending = null
      this.notifyConfirmation(null)
      this.sendCancelled(callId, 'none')
      return
    }
    const running = this.running.get(callId)
    if (running) {
      running.controller.abort()
      if (!running.cancellationReported) {
        running.cancellationReported = true
        this.sendCancelled(callId, cancellationEffect(running))
      }
      return
    }
    if (this.approved?.callId === callId) {
      this.recordTerminalConfirmation(callId, this.approved.confirmationDigest)
      this.approved = null
      this.sendCancelled(callId, 'none')
    }
  }

  private sendCancelled(callId: string, effect: WebMcpCancellationEffect): void {
    this.sendMessage({ protocol: WEBMCP_CONTROL_PROTOCOL, type: 'control.cancelled', call_id: callId, effect })
  }

  private recordTerminalConfirmation(callId: string, confirmationDigest: string): boolean {
    if (this.terminalConfirmations.has(callId)) return false
    if (this.terminalConfirmations.size >= MAX_TERMINAL_CONFIRMATIONS) {
      throw new Error('WebMCP terminal confirmation bound was exceeded')
    }
    this.terminalConfirmations.set(callId, confirmationDigest)
    return true
  }
}
