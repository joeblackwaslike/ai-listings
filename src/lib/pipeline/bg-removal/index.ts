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
    case 'birefnet':
      return createBiRefNetProvider(process.env.BIREFNET_BASE_URL)
    default:
      throw new Error(`Unknown BG_REMOVAL_PROVIDER: ${id}`)
  }
}
