export const SINCE_PATTERN = /^[1-9]\d{0,3} (minute|minutes|hour|hours|day|days)$/
const ERROR_PATTERN = "message RLIKE '(?i).*(error|exception|fail|fatal).*'"
const AUTH_DIAGNOSTIC_EXCLUSIONS = ['proxy_check', 'proxy_redirect_to_login'].map(
  (event) => `message NOT LIKE '%"event":"${event}"%'`,
)

interface LogsQueryOptions {
  namespace?: string
  since?: string
  grep?: string
  errorsOnly?: boolean
  limit?: number
}

interface Workload {
  namespace: string
  name: string
}

interface SeenContainer {
  namespace: string
  container: string
}

function escapeNrql(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

export function logsQuery({
  namespace,
  since = '1 hour',
  grep,
  errorsOnly,
  limit = 50,
}: LogsQueryOptions): string {
  if (!SINCE_PATTERN.test(since)) {
    throw new Error(`invalid since "${since}": expected "<n> minutes|hours|days"`)
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) {
    throw new Error(`invalid limit ${limit}: expected an integer from 1 to 2000`)
  }

  const conditions: string[] = []
  if (namespace) conditions.push(`namespace_name = '${escapeNrql(namespace)}'`)
  if (grep) conditions.push(`message LIKE '%${escapeNrql(grep)}%'`)
  if (errorsOnly) conditions.push(ERROR_PATTERN, ...AUTH_DIAGNOSTIC_EXCLUSIONS)

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
  return `SELECT timestamp, namespace_name, container_name, pod_name, message FROM Log${where} SINCE ${since} ago LIMIT ${limit}`
}

export function auditDiff(
  expected: Workload[],
  seen: SeenContainer[],
): { missing: Workload[] } {
  const missing = expected.filter(
    (workload) =>
      !seen.some(
        (row) =>
          row.namespace === workload.namespace && row.container === workload.name,
      ),
  )
  return { missing }
}

export function truncateMessages<T extends object>(rows: T[], max: number): T[] {
  return rows.map((row) => {
    const message = (row as { message?: unknown }).message
    if (typeof message !== 'string' || message.length <= max) return row
    return { ...row, message: `${message.slice(0, max)}…` }
  })
}
