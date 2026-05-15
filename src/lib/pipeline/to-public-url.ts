export function toInternalUrl(url: string): string {
  const pub = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const internal = process.env.SUPABASE_INTERNAL_URL ?? pub
  return internal ? url.replace(pub, internal) : url
}

export async function toPublicUrl(url: string): Promise<string> {
  const pub = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const publicHost = process.env.SUPABASE_PUBLIC_URL ?? pub
  return publicHost ? url.replace(pub, publicHost) : url
}
