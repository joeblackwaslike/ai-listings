import type { ApiKeys } from '@/lib/user-api-keys'
import { removeBackground } from './remove-background'
import { getSupabaseAdmin } from './supabase-push'

// Categories where background removal makes the item look worse (chains, delicate jewelry)
const SKIP_BG_REMOVAL = new Set(['jewelry'])

export async function runStep4bPhotoRoom(
  listingId: string,
  photoUrl: string,
  intakePhotoId: string,
  apiKeys: ApiKeys,
  category?: string
): Promise<void> {
  if (category && SKIP_BG_REMOVAL.has(category.toLowerCase())) return

  const supabase = getSupabaseAdmin()
  const { data: row } = await supabase
    .from('listings')
    .select('skip_background_removal')
    .eq('id', listingId)
    .single()
  if (row?.skip_background_removal) return

  const storagePath = `intake/${listingId}/processed.png`
  await removeBackground(intakePhotoId, photoUrl, storagePath, apiKeys)
}
