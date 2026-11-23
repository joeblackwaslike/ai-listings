export const MIN_HISTORY_SECONDS = 7 * 86400
export const ALLOWED_NOTIFICATION_EMAIL = 'joeblackwaslike@gmail.com'

export interface ConditionFile {
  name: string
  description: string
  enabled: boolean
  nrql: string
  historyQuery: string
  operator: 'ABOVE' | 'BELOW'
  threshold: number
  thresholdDuration: number
  aggregationWindow: number
  aggregationMethod: 'EVENT_FLOW' | 'EVENT_TIMER' | 'CADENCE'
  aggregationDelay: number
  fillOption: 'NONE' | 'STATIC' | 'LAST_VALUE'
  fillValue?: number
  expirationDuration: number
}

export interface AlertsFile {
  policy: { name: string; incidentPreference: string }
  notifications: {
    email: string
    destinationName: string
    channelName: string
    channelSubject: string
    workflowName: string
  }
  conditions: ConditionFile[]
}

export function conditionInput(c: ConditionFile) {
  const signal: Record<string, unknown> = {
    aggregationWindow: c.aggregationWindow,
    aggregationMethod: c.aggregationMethod,
    aggregationDelay: c.aggregationDelay,
    fillOption: c.fillOption,
  }
  if (c.fillValue !== undefined) signal.fillValue = c.fillValue
  return {
    name: c.name,
    description: c.description,
    enabled: c.enabled,
    nrql: { query: c.nrql },
    signal: signal as {
      aggregationWindow: number
      aggregationMethod: string
      aggregationDelay: number
      fillOption: string
      fillValue?: number
    },
    terms: [
      {
        priority: 'CRITICAL',
        operator: c.operator,
        threshold: c.threshold,
        thresholdDuration: c.thresholdDuration,
        thresholdOccurrences: 'ALL',
      },
    ],
    expiration: {
      expirationDuration: c.expirationDuration,
      openViolationOnExpiration: false,
      closeViolationsOnExpiration: true,
    },
    valueFunction: 'SINGLE_VALUE',
  }
}

type ConditionLike = ReturnType<typeof conditionInput>

export function conditionSpec(node: Omit<ConditionLike, 'signal'> & { signal: Partial<ConditionLike['signal']> }) {
  const { signal, expiration } = node
  return {
    name: node.name,
    description: node.description ?? '',
    enabled: node.enabled,
    query: node.nrql.query,
    aggregationWindow: signal.aggregationWindow,
    aggregationMethod: signal.aggregationMethod,
    aggregationDelay: signal.aggregationDelay,
    fillOption: signal.fillOption,
    fillValue: signal.fillOption === 'STATIC' ? signal.fillValue : null,
    terms: node.terms.map((t) => ({
      priority: t.priority,
      operator: t.operator,
      threshold: t.threshold,
      thresholdDuration: t.thresholdDuration,
      thresholdOccurrences: t.thresholdOccurrences,
    })),
    expirationDuration: expiration?.expirationDuration,
    openViolationOnExpiration: expiration?.openViolationOnExpiration,
    closeViolationsOnExpiration: expiration?.closeViolationsOnExpiration,
    valueFunction: node.valueFunction,
  }
}

export function assertEnableAllowed(c: ConditionFile, historySeconds: number | null): void {
  if (c.enabled && (historySeconds === null || historySeconds < MIN_HISTORY_SECONDS)) {
    throw new Error(`cannot enable "${c.name}": insufficient history (needs 7 days of data)`)
  }
}

export function destinationInput(name: string, email: string) {
  return { name, type: 'EMAIL', properties: [{ key: 'email', value: email }] }
}

export function destinationEmail(properties: { key: string; value: string }[]): string | undefined {
  return ['email', 'link_sent_email'].map((key) => properties.find((p) => p.key === key)?.value).find(Boolean)
}

export function channelInput(name: string, destinationId: string, subject: string) {
  return {
    name,
    type: 'EMAIL',
    destinationId,
    product: 'IINT',
    properties: [{ key: 'subject', value: subject }],
  }
}

export function channelSpec(channel: {
  type: string
  destinationId?: string | null
  properties?: { key: string; value: string }[]
}) {
  return {
    type: channel.type,
    destinationId: channel.destinationId ?? null,
    subject: channel.properties?.find((p) => p.key === 'subject')?.value ?? null,
  }
}

export function channelUpdateInput(name: string, subject: string) {
  return { name, properties: [{ key: 'subject', value: subject }] }
}

export function workflowInput(name: string, policyId: string, channelId: string) {
  return {
    name,
    workflowEnabled: true,
    destinationsEnabled: true,
    mutingRulesHandling: 'DONT_NOTIFY_FULLY_MUTED_ISSUES',
    issuesFilter: {
      name: 'policy',
      type: 'FILTER',
      predicates: [{ attribute: 'labels.policyIds', operator: 'EXACTLY_MATCHES', values: [policyId] }],
    },
    destinationConfigurations: [{ channelId, notificationTriggers: ['ACTIVATED'] }],
  }
}

interface WorkflowLike {
  workflowEnabled?: boolean
  destinationsEnabled?: boolean
  mutingRulesHandling?: string
  issuesFilter?: { predicates?: { attribute: string; operator: string; values: string[] }[] } | null
  destinationConfigurations?: { channelId: string; notificationTriggers?: string[] }[]
}

export function workflowSpec(node: WorkflowLike) {
  return {
    enabled: node.workflowEnabled,
    destinationsEnabled: node.destinationsEnabled,
    mutingRulesHandling: node.mutingRulesHandling,
    predicates: (node.issuesFilter?.predicates ?? []).map((p) => ({
      attribute: p.attribute,
      operator: p.operator,
      values: [...p.values].sort(),
    })),
    destinations: (node.destinationConfigurations ?? []).map((d) => ({
      channelId: d.channelId,
      triggers: [...(d.notificationTriggers ?? [])].sort(),
    })),
  }
}

export function workflowUpdateInput(id: string, filterId: string, input: ReturnType<typeof workflowInput>) {
  return {
    id,
    workflowEnabled: input.workflowEnabled,
    destinationsEnabled: input.destinationsEnabled,
    mutingRulesHandling: input.mutingRulesHandling,
    issuesFilter: { id: filterId, filterInput: input.issuesFilter },
    destinationConfigurations: input.destinationConfigurations,
  }
}
