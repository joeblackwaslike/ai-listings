import type { AgentBlockedKind } from '@/types/listings'

export function pipelineEndUpdate(totalSteps: number) {
  return {
    status: 'in_loop' as const,
    condition_confirmed: false,
    pipeline_total: totalSteps,
    ...unblockedUpdate(),
  }
}

export function blockedUpdate(kind: AgentBlockedKind, reason: string) {
  return { agent_blocked: true, agent_blocked_reason: reason, agent_blocked_kind: kind }
}

export function unblockedUpdate() {
  return { agent_blocked: false, agent_blocked_reason: null, agent_blocked_kind: null }
}
