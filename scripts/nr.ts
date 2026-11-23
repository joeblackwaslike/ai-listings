import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parseEnvFile, resolveCredentials } from '@/lib/newrelic/env'
import { auditDiff, logsQuery } from '@/lib/newrelic/nrql'
import { expectedFromK8s, seenFromFacets } from '@/lib/newrelic/workloads'

const ENDPOINT = 'https://api.newrelic.com/graphql'
const GRAPHQL = 'query($a:Int!,$q:Nrql!){actor{account(id:$a){nrql(query:$q){results}}}}'
const USAGE = `usage:
  bun scripts/nr.ts query "<NRQL>"
  bun scripts/nr.ts logs [--errors] [--ns <namespace>] [--since "<n> hours"] [--grep <text>] [--limit <n>]
  bun scripts/nr.ts audit`

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

async function runAudit(): Promise<{ missing: { namespace: string; name: string }[] }> {
  const kube = execFileSync('kubectl', ['get', 'deploy,statefulset', '-A', '-o', 'json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const expected = expectedFromK8s(JSON.parse(kube))
  const rows = (await nrql(
    'SELECT count(*) FROM Log SINCE 24 hours ago FACET namespace_name, container_name LIMIT MAX',
  )) as { facet: (string | null)[] }[]
  return auditDiff(expected, seenFromFacets(rows))
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'query' && rest.length === 1) return print(await nrql(rest[0]))
  if (command === 'logs') return print(await runLogs(rest))
  if (command === 'audit' && rest.length === 0) return print(await runAudit())
  console.error(USAGE)
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  if ((error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) console.error(USAGE)
  process.exit(1)
})
