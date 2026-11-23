import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { envFileNeeded, parseEnvFile, resolveCredentials } from '@/lib/newrelic/env'
import { parseNerdGraphResponse } from '@/lib/newrelic/nerdgraph'
import { auditDiff, logsQuery, truncateMessages } from '@/lib/newrelic/nrql'
import { classifyMissing, expectedFromK8s, kubectlDuration, seenFromFacets } from '@/lib/newrelic/workloads'

const ENDPOINT = 'https://api.newrelic.com/graphql'
const GRAPHQL = 'query($a:Int!,$q:Nrql!){actor{account(id:$a){nrql(query:$q){results}}}}'
const MESSAGE_MAX = 300
const FACET_ROW_CAP = 5000
const USAGE = `usage:
  bun scripts/nr.ts query "<NRQL>"
  bun scripts/nr.ts logs [--errors] [--ns <namespace>] [--since "<n> hours"] [--grep <text>] [--limit <n>] [--full]
  bun scripts/nr.ts audit [--since "<n> hours"]`

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function envFileCandidates(): string[] {
  try {
    const worktreeRoot = git(['rev-parse', '--show-toplevel'])
    const mainRoot = join(git(['rev-parse', '--path-format=absolute', '--git-common-dir']), '..')
    return [join(worktreeRoot, '.env.production.local'), join(mainRoot, '.env.production.local')]
  } catch {
    return []
  }
}

function loadEnvFile(): Record<string, string> {
  if (!envFileNeeded(process.env)) return {}
  const path = envFileCandidates().find(existsSync)
  return path ? parseEnvFile(readFileSync(path, 'utf8')) : {}
}

async function nrql(query: string): Promise<unknown[]> {
  const { apiKey, accountId } = resolveCredentials(process.env, loadEnvFile())
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-Key': apiKey },
    body: JSON.stringify({ query: GRAPHQL, variables: { a: accountId, q: query } }),
    signal: AbortSignal.timeout(30_000),
  })
  const body: unknown = await response.json().catch(() => null)
  return parseNerdGraphResponse(response.status, body)
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function runLogs(argv: string[]): Promise<unknown[]> {
  const { values } = parseArgs({
    args: argv,
    options: {
      errors: { type: 'boolean' },
      ns: { type: 'string' },
      since: { type: 'string' },
      grep: { type: 'string' },
      limit: { type: 'string' },
      full: { type: 'boolean' },
    },
  })
  const query = logsQuery({
    namespace: values.ns,
    since: values.since,
    grep: values.grep,
    errorsOnly: values.errors,
    limit: values.limit === undefined ? undefined : Number(values.limit),
  })
  const rows = (await nrql(query)) as object[]
  return values.full ? rows : truncateMessages(rows, MESSAGE_MAX)
}

function kubectl(args: string[]): string {
  return execFileSync('kubectl', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

interface Pod {
  metadata: { name: string }
  spec: { containers: { name: string }[] }
  status?: { phase?: string }
}

interface ContainerLineCount {
  namespace: string
  name: string
  lines?: number
  pods?: number
  error?: string
}

function firstLine(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr
  const reason = (stderr || (error instanceof Error ? error.message : String(error))).trim()
  return reason.split('\n')[0]
}

function countContainerLines(
  namespace: string,
  name: string,
  duration: string,
  podsByNamespace: Map<string, Pod[]>,
): ContainerLineCount {
  try {
    if (!podsByNamespace.has(namespace)) {
      const list = JSON.parse(kubectl(['get', 'pods', '-n', namespace, '-o', 'json'])) as { items: Pod[] }
      podsByNamespace.set(namespace, list.items)
    }
    const pods = (podsByNamespace.get(namespace) ?? []).filter(
      (pod) => pod.status?.phase === 'Running' && pod.spec.containers.some((c) => c.name === name),
    )
    let lines = 0
    let succeeded = 0
    let lastError = ''
    for (const pod of pods) {
      try {
        const output = kubectl(['logs', '-n', namespace, pod.metadata.name, '-c', name, `--since=${duration}`])
        lines += output === '' ? 0 : output.trimEnd().split('\n').length
        succeeded += 1
      } catch (error) {
        lastError = firstLine(error)
      }
    }
    if (pods.length > 0 && succeeded === 0) return { namespace, name, error: lastError }
    return { namespace, name, lines, pods: pods.length }
  } catch (error) {
    return { namespace, name, error: firstLine(error) }
  }
}

async function runAudit(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { since: { type: 'string' } } })
  const window = values.since ?? '6 hours'
  const duration = kubectlDuration(window)
  const kube = kubectl(['get', 'deploy,statefulset', '-A', '-o', 'json'])
  const expected = expectedFromK8s(JSON.parse(kube))
  const rows = (await nrql(
    `SELECT count(*) FROM Log SINCE ${window} ago FACET namespace_name, container_name LIMIT MAX`,
  )) as { facet: (string | null)[] }[]
  if (rows.length >= FACET_ROW_CAP) {
    console.error(`warning: facet query returned ${rows.length} rows; coverage may be truncated`)
  }
  const { missing } = auditDiff(expected, seenFromFacets(rows))
  const podsByNamespace = new Map<string, Pod[]>()
  const counts = missing.map(({ namespace, name }) =>
    countContainerLines(namespace, name, duration, podsByNamespace),
  )
  return { window, missing, ...classifyMissing(missing, counts) }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'query' && rest.length === 1) return print(await nrql(rest[0]))
  if (command === 'logs') return print(await runLogs(rest))
  if (command === 'audit') return print(await runAudit(rest))
  console.error(USAGE)
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  if ((error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) console.error(USAGE)
  process.exit(1)
})
