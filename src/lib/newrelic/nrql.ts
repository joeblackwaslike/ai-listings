const SINCE_PATTERN = /^\d+ (minute|minutes|hour|hours|day|days)$/
const ERROR_PATTERN = "message RLIKE '(?i).*(error|exception|fail|fatal).*'"

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
  return value.replaceAll("'", "''")
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
  if (errorsOnly) conditions.push(ERROR_PATTERN)

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
          row.namespace === workload.namespace && row.container.startsWith(workload.name),
      ),
  )
  return { missing }
}
