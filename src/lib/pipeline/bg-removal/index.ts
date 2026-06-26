import type { ApiKeys } from '@/lib/user-api-keys'
import type { BgRemovalProvider } from './types'
import { createWithoutBgProvider } from './providers/withoutbg'

export type { BgRemovalProvider } from './types'

export type BgRemovalProviderId = 'withoutbg' // | 'birefnet' added in step 2

export function getBgRemovalProvider(apiKeys: ApiKeys): BgRemovalProvider {
  const id = (process.env.BG_REMOVAL_PROVIDER ?? 'withoutbg') as BgRemovalProviderId

  switch (id) {
    case 'withoutbg':
      return createWithoutBgProvider(apiKeys.withoutbg)
    default:
      throw new Error(`Unknown BG_REMOVAL_PROVIDER: ${id}`)
  }
}
