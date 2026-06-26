import type { BgRemovalProvider } from '../types'

// Cap the request so a slow/hung provider can't pin a background worker indefinitely.
const REQUEST_TIMEOUT_MS = 60_000

export function createWithoutBgProvider(apiKey: string): BgRemovalProvider {
  return {
    id: 'withoutbg',
    async removeBackground(input: Buffer): Promise<Buffer> {
      const formData = new FormData()
      formData.append('file', new Blob([new Uint8Array(input)], { type: 'image/jpeg' }), 'photo.jpg')

      let response: Response
      try {
        response = await fetch('https://api.withoutbg.com/v1.0/image-without-background', {
          method: 'POST',
          headers: { 'X-API-Key': apiKey },
          body: formData,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new Error(`withoutBG request timed out after ${REQUEST_TIMEOUT_MS}ms`)
        }
        throw error
      }

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`withoutBG returned HTTP ${response.status} — ${errText}`)
      }

      return Buffer.from(await response.arrayBuffer())
    },
  }
}
