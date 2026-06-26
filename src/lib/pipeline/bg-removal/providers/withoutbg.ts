import type { BgRemovalProvider } from '../types'

export function createWithoutBgProvider(apiKey: string): BgRemovalProvider {
  return {
    id: 'withoutbg',
    async removeBackground(input: Buffer): Promise<Buffer> {
      const formData = new FormData()
      formData.append('file', new Blob([new Uint8Array(input)], { type: 'image/jpeg' }), 'photo.jpg')

      const response = await fetch('https://api.withoutbg.com/v1.0/image-without-background', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey },
        body: formData,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`withoutBG returned HTTP ${response.status} — ${errText}`)
      }

      return Buffer.from(await response.arrayBuffer())
    },
  }
}
