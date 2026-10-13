export interface UploadStudioPhotosOptions {
  fetchImpl?: typeof fetch
  onProgress?: (done: number, total: number) => void
}

/** Uploads image files one at a time, in order, to /api/studio-upload; returns the stored photo URLs. */
export async function uploadStudioPhotos(
  listingId: string,
  files: File[],
  startOrder: number,
  opts: UploadStudioPhotosOptions = {},
): Promise<string[]> {
  const { fetchImpl = fetch, onProgress } = opts
  const images = files.filter((f) => f.type.startsWith('image/'))
  const urls: string[] = []
  for (let i = 0; i < images.length; i++) {
    const form = new FormData()
    form.append('photo', images[i])
    form.append('listingId', listingId)
    form.append('displayOrder', String(startOrder + i))
    const res = await fetchImpl('/api/studio-upload', { method: 'POST', body: form })
    if (!res.ok) {
      let msg = `Upload failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) msg = body.error
      } catch { /* non-JSON body (e.g. HTML redirect) — use status message */ }
      throw new Error(msg)
    }
    const data = (await res.json()) as { photoUrl: string }
    urls.push(data.photoUrl)
    onProgress?.(i + 1, images.length)
  }
  return urls
}
