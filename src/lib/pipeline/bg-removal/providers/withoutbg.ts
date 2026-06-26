import type { BgRemovalProvider } from '../types'
import { postImageForRemoval } from '../http'

// Cap the request so a slow/hung provider can't pin a background worker indefinitely.
const REQUEST_TIMEOUT_MS = 60_000

export function createWithoutBgProvider(apiKey: string): BgRemovalProvider {
  return {
    id: 'withoutbg',
    removeBackground: (input) =>
      postImageForRemoval('https://api.withoutbg.com/v1.0/image-without-background', input, {
        label: 'withoutBG',
        headers: { 'X-API-Key': apiKey },
        timeoutMs: REQUEST_TIMEOUT_MS,
      }),
  }
}
