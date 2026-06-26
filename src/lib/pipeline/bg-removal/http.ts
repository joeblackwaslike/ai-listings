interface PostImageOptions {
  /** Provider name used in error messages, e.g. "withoutBG" / "BiRefNet". */
  label: string
  headers?: Record<string, string>
  timeoutMs: number
}

/**
 * POST a JPEG as multipart `file` and return the provider's cutout bytes.
 *
 * Shared by every background-removal provider: builds the form, applies an
 * abort timeout so a hung provider can't pin a background worker, and
 * normalizes timeout/abort errors across runtimes.
 */
export async function postImageForRemoval(
  url: string,
  image: Buffer,
  { label, headers, timeoutMs }: PostImageOptions
): Promise<Buffer> {
  const formData = new FormData()
  // Buffer isn't accepted as a BlobPart under the DOM lib types; wrap in a Uint8Array view.
  formData.append('file', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'photo.jpg')

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // AbortSignal.timeout surfaces as TimeoutError; some runtimes report AbortError.
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`${label} request timed out after ${timeoutMs}ms`)
    }
    throw error
  }

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`${label} returned HTTP ${response.status} — ${errText}`)
  }

  return Buffer.from(await response.arrayBuffer())
}
