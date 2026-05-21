import { getSetting } from '@/lib/user-settings';

export type PlatformCreds = {
  ebay: { clientId: string; clientSecret: string; refreshToken: string };
  poshmark: { sessionCookies: string };
  mercari: { accessToken: string };
  etsy: { clientId: string; accessToken: string; refreshToken: string; shopId: string };
  mechmarket: {
    redditClientId: string;
    redditClientSecret: string;
    redditPassword: string;
    redditUsername: string;
    usState: string;
  };
};

export async function getEbayCreds(userId: string): Promise<PlatformCreds['ebay'] | null> {
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    getSetting(userId, 'ebay_client_id'),
    getSetting(userId, 'ebay_client_secret'),
    getSetting(userId, 'ebay_refresh_token'),
  ]);
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function getPoshmarkCreds(userId: string): Promise<PlatformCreds['poshmark'] | null> {
  const cookies = await getSetting(userId, 'poshmark_cookies');
  if (!cookies) return null;
  return { sessionCookies: cookies };
}

export async function getMercariCreds(userId: string): Promise<PlatformCreds['mercari'] | null> {
  const token = await getSetting(userId, 'mercari_api_token');
  if (!token) return null;
  return { accessToken: token };
}

export async function getEtsyCreds(userId: string): Promise<PlatformCreds['etsy'] | null> {
  const [clientId, accessToken, refreshToken, shopId] = await Promise.all([
    getSetting(userId, 'etsy_client_id'),
    getSetting(userId, 'etsy_access_token'),
    getSetting(userId, 'etsy_refresh_token'),
    getSetting(userId, 'etsy_shop_id'),
  ]);
  if (!clientId || !accessToken || !refreshToken || !shopId) return null;
  return { clientId, accessToken, refreshToken, shopId };
}

export async function getMechmarketCreds(userId: string): Promise<PlatformCreds['mechmarket'] | null> {
  const [redditClientId, redditClientSecret, redditPassword, redditUsername, usState] = await Promise.all([
    getSetting(userId, 'reddit_client_id'),
    getSetting(userId, 'reddit_client_secret'),
    getSetting(userId, 'reddit_password'),
    getSetting(userId, 'reddit_username'),
    getSetting(userId, 'us_state'),
  ]);
  if (!redditClientId || !redditClientSecret || !redditPassword || !redditUsername || !usState) return null;
  return { redditClientId, redditClientSecret, redditPassword, redditUsername, usState };
}
