import type { ApiKeys } from '@/lib/user-api-keys'
import { removeBackground } from './remove-background'

export async function runStep4bPhotoRoom(
  listingId: string,
  photoUrl: string,
  intakePhotoId: string,
  apiKeys: ApiKeys
): Promise<void> {
  const storagePath = `intake/${listingId}/processed.png`
  await removeBackground(intakePhotoId, photoUrl, storagePath, apiKeys)
}
