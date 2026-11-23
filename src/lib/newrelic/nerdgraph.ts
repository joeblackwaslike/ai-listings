interface GraphqlBody {
  errors?: { message?: string }[]
  data?: Record<string, unknown>
}

function checkResponse(status: number, parsed: GraphqlBody): void {
  const firstMessage = parsed.errors?.[0]?.message
  if (status < 200 || status > 299) {
    throw new Error(`NerdGraph HTTP ${status}${firstMessage ? `: ${firstMessage}` : ''}`)
  }
  if (parsed.errors?.length) {
    throw new Error(
      parsed.errors.map((e) => e.message).filter(Boolean).join('; ') ||
        'NerdGraph returned an error without a message',
    )
  }
}

export function parseGraphqlData(status: number, body: unknown): Record<string, unknown> {
  const parsed = (body ?? {}) as GraphqlBody
  checkResponse(status, parsed)
  if (!parsed.data) throw new Error('NerdGraph returned no data')
  return parsed.data
}

interface NrqlData {
  actor?: { account?: { nrql?: { results?: unknown[] } | null } | null }
}

export function parseNerdGraphResponse(status: number, body: unknown): unknown[] {
  const parsed = (body ?? {}) as GraphqlBody & { data?: NrqlData }
  checkResponse(status, parsed)
  const results = parsed.data?.actor?.account?.nrql?.results
  if (!results) throw new Error('NerdGraph returned no nrql results (check the account id)')
  return results
}

export function parseMutationResult(
  status: number,
  body: unknown,
  field: string,
): Record<string, unknown> {
  const payload = parseGraphqlData(status, body)[field] as
    | { errors?: { description?: string; type?: string }[] }
    | null
    | undefined
  if (!payload) throw new Error(`${field} returned nothing`)
  if (payload.errors?.length) {
    const details = payload.errors
      .map((e) => `${e.description ?? 'unknown error'}${e.type ? ` (${e.type})` : ''}`)
      .join('; ')
    throw new Error(`${field}: ${details}`)
  }
  return payload as Record<string, unknown>
}
