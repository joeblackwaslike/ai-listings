import { randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

// Matches the TTL the old oauth_state_${platform}/etsy_code_verifier cookies used
// (maxAge: 600). Kept short since this is a single-use, in-flight OAuth handshake value.
const STATE_TTL_MS = 10 * 60 * 1000

export async function createOauthState(
  userId: string,
  platform: string,
  codeVerifier?: string
): Promise<string> {
  const state = randomBytes(16).toString('hex')
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('oauth_states')
    .insert({ state, user_id: userId, platform, code_verifier: codeVerifier ?? null })

  if (error) throw new Error(`Failed to create oauth state: ${error.message}`)
  return state
}

// Peek without consuming — used by the "prepare" hop to look up which user/codeVerifier a
// state belongs to before handing off to the provider. Does NOT authorize completion by
// itself; only consumeOauthState (paired with the anchor-cookie check) does that.
export async function peekOauthState(
  state: string,
  platform: string
): Promise<{ userId: string; codeVerifier: string | null } | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('oauth_states')
    .select('user_id, code_verifier, created_at')
    .eq('state', state)
    .eq('platform', platform)
    .single()

  if (error || !data) return null

  const ageMs = Date.now() - new Date(data.created_at as string).getTime()
  if (ageMs > STATE_TTL_MS) return null

  return { userId: data.user_id as string, codeVerifier: data.code_verifier as string | null }
}

export async function consumeOauthState(
  state: string,
  platform: string
): Promise<{ userId: string; codeVerifier: string | null } | null> {
  const supabase = getSupabaseAdmin()
  // delete().select() atomically consumes the row — single-use, no replay.
  const { data, error } = await supabase
    .from('oauth_states')
    .delete()
    .eq('state', state)
    .eq('platform', platform)
    .select('user_id, code_verifier, created_at')
    .single()

  if (error || !data) return null

  const ageMs = Date.now() - new Date(data.created_at as string).getTime()
  if (ageMs > STATE_TTL_MS) return null

  return { userId: data.user_id as string, codeVerifier: data.code_verifier as string | null }
}
