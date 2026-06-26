import type { ApiKeys } from '@/lib/user-api-keys'
import type { BgRemovalProvider } from './types'
import { createWithoutBgProvider } from './providers/withoutbg'
import { createBiRefNetProvider } from './providers/birefnet'

export type { BgRemovalProvider } from './types'

export type BgRemovalProviderId = 'withoutbg' | 'birefnet'

export function getBgRemovalProvider(apiKeys: ApiKeys): BgRemovalProvider {
  const id = (process.env.BG_REMOVAL_PROVIDER ?? 'withoutbg') as BgRemovalProviderId

  switch (id) {
    case 'withoutbg':
      return createWithoutBgProvider(apiKeys.withoutbg)
    case 'birefnet': {
      const baseUrl = process.env.BIREFNET_BASE_URL?.trim()
      if (!baseUrl) {
        throw new Error('BG_REMOVAL_PROVIDER=birefnet requires BIREFNET_BASE_URL to be set')
      }
      return createBiRefNetProvider(baseUrl)
    }
    default:
      throw new Error(`Unknown BG_REMOVAL_PROVIDER: ${id}`)
  }
}
