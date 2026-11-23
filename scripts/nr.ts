import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parseEnvFile, resolveCredentials } from '@/lib/newrelic/env'
import { auditDiff, logsQuery } from '@/lib/newrelic/nrql'
import { classifyMissing, expectedFromK8s, kubectlDuration, seenFromFacets } from '@/lib/newrelic/workloads'

const ENDPOINT = 'https://api.newrelic.com/graphql'
const GRAPHQL = 'query($a:Int!,$q:Nrql!){actor{account(id:$a){nrql(query:$q){results}}}}'
const USAGE = `usage:
  bun scripts/nr.ts query "<NRQL>"
  bun scripts/nr.ts logs [--errors] [--ns <namespace>] [--since "<n> hours"] [--grep <text>] [--limit <n>]
  bun scripts/nr.ts audit [--since "<n> hours"]`

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function envFileCandidates(): string[] {
  const worktreeRoot = git(['rev-parse', '--show-toplevel'])
  const mainRoot = join(git(['rev-parse', '--path-format=absolute', '--git-common-dir']), '..')
  return [join(worktreeRoot, '.env.production.local'), join(mainRoot, '.env.production.local')]
}

function loadEnvFile(): Record<string, string> {
  const path = envFileCandidates().find(existsSync)
  return path ? parseEnvFile(readFileSync(path, 'utf8')) : {}
}

async function nrql(query: string): Promise<unknown[]> {
  const { apiKey, accountId } = resolveCredentials(process.env, loadEnvFile())
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-Key': apiKey },
    body: JSON.stringify({ query: GRAPHQL, variables: { a: accountId, q: query } }),
  })
  if (!response.ok) throw new Error(`NerdGraph HTTP ${response.status}`)
  const body = (await response.json()) as {
    errors?: { message: string }[]
    data?: { actor: { account: { nrql: { results: unknown[] } } } }
  }
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '))
  if (!body.data) throw new Error('NerdGraph returned no data')
  return body.data.actor.account.nrql.results
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function runLogs(argv: string[]): Promise<unknown[]> {
  const { values } = parseArgs({
    args: argv,
    options: {
      errors: { type: 'boolean' },
      ns: { type: 'string' },
      since: { type: 'string' },
      grep: { type: 'string' },
      limit: { type: 'string' },
    },
  })
  const query = logsQuery({
    namespace: values.ns,
    since: values.since,
    grep: values.grep,
    errorsOnly: values.errors,
    limit: values.limit === undefined ? undefined : Number(values.limit),
  })
  return nrql(query)
}

function kubectl(args: string[]): string {
  return execFileSync('kubectl', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function countContainerLines(
  namespace: string,
  name: string,
  duration: string,
  podsByNamespace: Map<string, { metadata: { name: string }; spec: { containers: { name: string }[] } }[]>,
): { namespace: string; name: string; lines?: number; error?: string } {
  try {
    if (!podsByNamespace.has(namespace)) {
      podsByNamespace.set(namespace, JSON.parse(kubectl(['get', 'pods', '-n', namespace, '-o', 'json'])).items)
    }
    const pods = (podsByNamespace.get(namespace) ?? []).filter((pod) =>
      pod.spec.containers.some((container) => container.name === name),
    )
    let lines = 0
    for (const pod of pods) {
      const output = kubectl(['logs', '-n', namespace, pod.metadata.name, '-c', name, `--since=${duration}`])
      lines += output === '' ? 0 : output.trimEnd().split('\n').length
    }
    return { namespace, name, lines }
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr
    const reason = (stderr || (error instanceof Error ? error.message : String(error))).trim()
    return { namespace, name, error: reason.split('\n')[0] }
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
  const { missing } = auditDiff(expected, seenFromFacets(rows))
  const podsByNamespace = new Map()
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
