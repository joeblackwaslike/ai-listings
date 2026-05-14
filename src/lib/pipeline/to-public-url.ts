export function toInternalUrl(url: string): string {
  const pub = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const internal = process.env.SUPABASE_INTERNAL_URL ?? pub
  return internal ? url.replace(pub, internal) : url
}

// Rewrites an internal Supabase storage URL to a publicly accessible URL.
// The Tailscale hostname (sup-ai-listings.napoleon-catfish.ts.net) is unreachable
// from external services (SerpAPI, Claude API). This fetches the bytes via the
// cluster-internal Kong service URL and re-hosts them on catbox.moe.
export async function toPublicUrl(internalUrl: string): Promise<string> {
  const imageResp = await fetch(toInternalUrl(internalUrl))
  if (!imageResp.ok) {
    throw new Error(`toPublicUrl: failed to fetch image — HTTP ${imageResp.status} from ${toInternalUrl(internalUrl)}`)
  }
  const imageBuffer = await imageResp.arrayBuffer()
  const contentType = imageResp.headers.get('content-type') ?? 'image/jpeg'
  const ext = contentType.includes('png') ? 'png' : 'jpg'
  const blob = new Blob([imageBuffer], { type: contentType })

  const catboxForm = new FormData()
  catboxForm.append('reqtype', 'fileupload')
  catboxForm.append('fileToUpload', blob, `photo.${ext}`)
  const catboxResp = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: catboxForm })
  if (catboxResp.ok) {
    return (await catboxResp.text()).trim()
  }

  const zeroForm = new FormData()
  zeroForm.append('file', blob, `photo.${ext}`)
  const zeroResp = await fetch('https://0x0.st', { method: 'POST', body: zeroForm })
  if (!zeroResp.ok) {
    throw new Error(`toPublicUrl: all temp hosts failed — catbox ${catboxResp.status}, 0x0.st ${zeroResp.status}`)
  }
  return (await zeroResp.text()).trim()
}
