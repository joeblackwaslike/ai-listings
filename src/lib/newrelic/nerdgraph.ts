interface NerdGraphBody {
  errors?: { message?: string }[]
  data?: { actor?: { account?: { nrql?: { results?: unknown[] } | null } | null } }
}

export function parseNerdGraphResponse(status: number, body: unknown): unknown[] {
  const parsed = (body ?? {}) as NerdGraphBody
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
  const results = parsed.data?.actor?.account?.nrql?.results
  if (!results) throw new Error('NerdGraph returned no nrql results (check the account id)')
  return results
}
