const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!
const BUCKET = process.env.R2_BUCKET_NAME!
const PUBLIC_URL = process.env.R2_PUBLIC_URL!

export async function uploadFile(path: string, body: Buffer, contentType: string): Promise<string> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${path}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': contentType,
    },
    body: new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`R2 upload failed (${res.status}): ${text}`)
  }
  return getPublicUrl(path)
}

export function getPublicUrl(path: string): string {
  return `${PUBLIC_URL}/${path}`
}
