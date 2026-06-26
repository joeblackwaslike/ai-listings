import type { BgRemovalProvider } from '../types'
import { postImageForRemoval } from '../http'

// BiRefNet inference (CPU fallback / large images) can be slow; mirror the SDK's 3-min cap.
const REQUEST_TIMEOUT_MS = 180_000

export function createBiRefNetProvider(baseUrl: string): BgRemovalProvider {
  const url = baseUrl.replace(/\/+$/, '')

  return {
    id: 'birefnet',
    removeBackground: (input) =>
      postImageForRemoval(`${url}/v1/remove`, input, {
        label: 'BiRefNet',
        timeoutMs: REQUEST_TIMEOUT_MS,
      }),
  }
}
