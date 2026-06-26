import type { BgRemovalProvider } from '../types'

// Self-hosted birefnet-bgremove service on the tailnet (no auth).
const DEFAULT_BASE_URL = 'http://joes-macbook-pro.napoleon-catfish.ts.net:8088'

// BiRefNet inference (CPU fallback / large images) can be slow; mirror the SDK's 3-min cap.
const REQUEST_TIMEOUT_MS = 180_000

export function createBiRefNetProvider(baseUrl?: string): BgRemovalProvider {
  const url = (baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')

  return {
    id: 'birefnet',
    async removeBackground(input: Buffer): Promise<Buffer> {
      const formData = new FormData()
      formData.append('file', new Blob([new Uint8Array(input)], { type: 'image/jpeg' }), 'photo.jpg')

      let response: Response
      try {
        response = await fetch(`${url}/v1/remove`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new Error(`BiRefNet request timed out after ${REQUEST_TIMEOUT_MS}ms`)
        }
        throw error
      }

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`BiRefNet returned HTTP ${response.status} — ${errText}`)
      }

      return Buffer.from(await response.arrayBuffer())
    },
  }
}
