import { z } from 'zod'
import { ALLOWED_NOTIFICATION_EMAIL } from './alerts'
import type { DashboardFile } from './dashboard'

const HISTORY_SHAPE = /^SELECT earliest\(timestamp\) FROM /i
const FORBIDDEN_NRQL = /\b(FACET|SINCE|TIMESERIES)\b/i

function withoutLiterals(nrql: string): string {
  return nrql.replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

function eventType(nrql: string): string | undefined {
  return /\bFROM\s+`?(\w+)/i.exec(withoutLiterals(nrql))?.[1]?.toLowerCase()
}

export function historyTargetsMatch(conditionNrql: string, historyQuery: string): boolean {
  const type = eventType(conditionNrql)
  if (!type || type !== eventType(historyQuery)) return false
  if (type !== 'metric') return true
  const metric = /\bmetricName\s*=\s*'([^']+)'/i.exec(historyQuery)?.[1]
  if (metric === undefined) return false
  return withoutLiterals(conditionNrql).includes(metric)
}

const positiveInt = z.number().int().positive()

const condition = z
  .strictObject({
    name: z.string().min(1),
    description: z.string(),
    enabled: z.boolean(),
    nrql: z.string().min(1),
    historyQuery: z.string().min(1),
    operator: z.enum(['ABOVE', 'BELOW']),
    threshold: z.number(),
    thresholdDuration: positiveInt,
    aggregationWindow: positiveInt,
    aggregationMethod: z.enum(['EVENT_FLOW', 'EVENT_TIMER', 'CADENCE']),
    aggregationDelay: z.number().int().nonnegative(),
    fillOption: z.enum(['NONE', 'STATIC'], { error: 'must be NONE or STATIC (LAST_VALUE is not supported)' }),
    fillValue: z.number().optional(),
    expirationDuration: positiveInt,
    openViolationOnExpiration: z.boolean().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.thresholdDuration % c.aggregationWindow !== 0) {
      ctx.addIssue({ code: 'custom', path: ['thresholdDuration'], message: 'must be a multiple of aggregationWindow' })
    }
    if (c.fillOption === 'STATIC' && c.fillValue === undefined) {
      ctx.addIssue({ code: 'custom', path: ['fillValue'], message: 'is required when fillOption is STATIC' })
    }
    if (c.openViolationOnExpiration && c.fillOption !== 'NONE') {
      ctx.addIssue({
        code: 'custom',
        path: ['openViolationOnExpiration'],
        message: 'requires fillOption NONE (gap filling stops a lost signal from being detected)',
      })
    }
    if (FORBIDDEN_NRQL.test(withoutLiterals(c.nrql))) {
      ctx.addIssue({ code: 'custom', path: ['nrql'], message: 'must not contain FACET, SINCE or TIMESERIES' })
    }
    if (!HISTORY_SHAPE.test(c.historyQuery)) {
      ctx.addIssue({ code: 'custom', path: ['historyQuery'], message: 'must start with SELECT earliest(timestamp) FROM' })
    } else if (!historyTargetsMatch(c.nrql, c.historyQuery)) {
      ctx.addIssue({ code: 'custom', path: ['historyQuery'], message: 'must read the same event type or metric as nrql' })
    }
  })

const alertsFile = z.strictObject({
  policy: z.strictObject({ name: z.string().min(1), incidentPreference: z.string().min(1) }),
  notifications: z.strictObject({
    email: z.literal(ALLOWED_NOTIFICATION_EMAIL, { error: `must be ${ALLOWED_NOTIFICATION_EMAIL}` }),
    destinationName: z.string().min(1),
    channelName: z.string().min(1),
    channelSubject: z.string().min(1),
    workflowName: z.string().min(1),
  }),
  conditions: z
    .array(condition)
    .min(1)
    .superRefine((conditions, ctx) => {
      const seen = new Set<string>()
      conditions.forEach((c, index) => {
        if (seen.has(c.name)) {
          ctx.addIssue({ code: 'custom', path: [index, 'name'], message: `duplicate condition name "${c.name}"` })
        }
        seen.add(c.name)
      })
    }),
})

export type AlertsFile = z.infer<typeof alertsFile>
export type ConditionFile = AlertsFile['conditions'][number]

const layout = z.strictObject({
  column: z.number().int(),
  row: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

const dashboardFile = z.strictObject({
  name: z.string().min(1),
  pages: z.array(
    z.strictObject({
      name: z.string().min(1),
      widgets: z.array(
        z.strictObject({
          title: z.string().min(1),
          visualization: z.string().min(1),
          layout,
          nrql: z.string().min(1),
        }),
      ),
    }),
  ),
})

function parse<T>(schema: z.ZodType<T>, file: string, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  const [issue] = result.error.issues
  throw new Error(`${file}: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
}

export function parseAlertsFile(raw: unknown): AlertsFile {
  return parse(alertsFile, 'alerts.json', raw)
}

export function parseDashboardFile(raw: unknown): DashboardFile {
  return parse(dashboardFile, 'dashboard.json', raw)
}
