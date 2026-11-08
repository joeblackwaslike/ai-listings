import { EbayAdapter } from '@/lib/platforms/adapters/ebay'
import { PoshmarkAdapter } from '@/lib/platforms/adapters/poshmark'
import { getEbayCreds, getPoshmarkCreds } from '@/lib/platforms/credentials'
import { PlatformError } from '@/lib/platforms/errors'
import type { ListingUrls, PlatformFields } from '@/types/listings'

export type Delister = (platformFields: PlatformFields) => Promise<void>

export function isPoshmarkAlreadyGone(err: unknown): boolean {
  return err instanceof PlatformError && err.message.includes('HTTP 404')
}

/**
 * Delists a sold listing from every other platform it is published on. Each platform is
 * attempted independently and `saveUrls` runs after each success, so one failure neither skips
 * the rest nor loses an earlier delist; failures are thrown together at the end.
 * @returns the platforms that were delisted
 */
export async function delistFromOtherPlatforms(
  listing: { listing_urls: ListingUrls | null; platform_fields: PlatformFields },
  soldOn: string,
  delisters: Record<string, Delister>,
  saveUrls: (urls: ListingUrls) => Promise<void>,
): Promise<string[]> {
  const urls: ListingUrls = { ...(listing.listing_urls ?? {}) }
  const delisted: string[] = []
  const failures: string[] = []

  for (const platform of Object.keys(urls)) {
    const delist = delisters[platform]
    if (platform === soldOn || !urls[platform] || !delist) continue
    try {
      await delist(listing.platform_fields)
      delete urls[platform]
      await saveUrls(urls)
      delisted.push(platform)
    } catch (err) {
      failures.push(`${platform}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (failures.length) throw new Error(failures.join('; '))
  return delisted
}

export function createDelisters(userId: string): Record<string, Delister> {
  return {
    ebay: async (pf) => {
      const offerId = pf?.ebay?.ebay_offer_id
      if (!offerId) throw new Error('no ebay_offer_id')
      const creds = await getEbayCreds(userId)
      if (!creds) throw new Error('missing eBay credentials')
      await new EbayAdapter(creds).withdrawOffer(offerId)
    },
    poshmark: async (pf) => {
      const id = pf?.poshmark?.listing_id
      if (!id) throw new Error('no poshmark listing_id')
      const creds = await getPoshmarkCreds(userId)
      if (!creds) throw new Error('missing Poshmark credentials')
      try {
        await new PoshmarkAdapter(creds).deleteListing(id)
      } catch (err) {
        if (!isPoshmarkAlreadyGone(err)) throw err
      }
    },
  }
}
