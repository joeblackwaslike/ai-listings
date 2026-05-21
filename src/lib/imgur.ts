const IMGUR_API_BASE = 'https://api.imgur.com/3';
const IMGUR_OAUTH_BASE = 'https://api.imgur.com/oauth2';

/**
 * Upload a single image buffer to Imgur.
 * Returns the direct image URL (e.g. https://i.imgur.com/xxxxx.jpg).
 */
export async function uploadImage(
  buffer: Buffer,
  mimeType: string,
  accessToken: string,
): Promise<string> {
  const base64 = buffer.toString('base64');

  const res = await fetch(`${IMGUR_API_BASE}/image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image: base64, type: 'base64' }),
  });

  if (res.status === 401) {
    throw new Error('Imgur auth expired');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Imgur upload failed: HTTP ${res.status} — ${text}`);
  }

  const data = (await res.json()) as { data: { link: string; id: string } };
  return data.data.link;
}

/**
 * Create an Imgur album from existing image IDs.
 * Returns the album URL (e.g. https://imgur.com/a/xxxxx).
 */
export async function createAlbum(
  title: string,
  imageIds: string[],
  accessToken: string,
): Promise<string> {
  const res = await fetch(`${IMGUR_API_BASE}/album`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, ids: imageIds }),
  });

  if (res.status === 401) {
    throw new Error('Imgur auth expired');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Imgur createAlbum failed: HTTP ${res.status} — ${text}`);
  }

  const data = (await res.json()) as { data: { id: string } };
  return `https://imgur.com/a/${data.data.id}`;
}

/**
 * Refresh an Imgur OAuth token.
 * Returns a new accessToken and refreshToken pair.
 */
export async function refreshImgurToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch(`${IMGUR_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Imgur token refresh failed: HTTP ${res.status} — ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}
