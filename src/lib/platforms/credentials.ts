import { getSetting } from '@/lib/user-settings';

export type PlatformCreds = {
  ebay: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    // Business Policies + listing config — empty string when not yet configured by the user.
    // `post-to-ebay` validates these are non-empty before attempting to create a listing, since
    // eBay requires them once a seller has opted into Business Policies (a manual one-time
    // step in Seller Hub, tracked separately in ai-listings-cri).
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
    merchantLocationKey: string;
    sandbox: boolean;
  };
  poshmark: { sessionCookies: string };
  mercari: { accessToken: string };
  etsy: { clientId: string; accessToken: string; refreshToken: string; shopId: string };
  mechmarket: {
    redditToken: string;
    usState: string;
  };
};

export async function getEbayCreds(userId: string): Promise<PlatformCreds['ebay'] | null> {
  const [
    clientId,
    clientSecret,
    refreshToken,
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    merchantLocationKey,
    sandboxMode,
  ] = await Promise.all([
    getSetting(userId, 'ebay_client_id'),
    getSetting(userId, 'ebay_client_secret'),
    getSetting(userId, 'ebay_refresh_token'),
    getSetting(userId, 'ebay_fulfillment_policy_id'),
    getSetting(userId, 'ebay_payment_policy_id'),
    getSetting(userId, 'ebay_return_policy_id'),
    getSetting(userId, 'ebay_merchant_location_key'),
    getSetting(userId, 'ebay_sandbox_mode'),
  ]);
  // Only the OAuth core (clientId/clientSecret/refreshToken) is required to return non-null —
  // the Business Policies fields are validated separately by callers (e.g. post-to-ebay) so
  // they can distinguish "eBay not connected" from "missing business policy settings".
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    fulfillmentPolicyId: fulfillmentPolicyId ?? '',
    paymentPolicyId: paymentPolicyId ?? '',
    returnPolicyId: returnPolicyId ?? '',
    merchantLocationKey: merchantLocationKey ?? '',
    // Stored as the string 'true'/'false' (no dedicated boolean setting type exists in
    // user_settings yet) — defaults to production (false) when unset.
    sandbox: sandboxMode === 'true',
  };
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
  const [redditToken, usState] = await Promise.all([
    getSetting(userId, 'reddit_token_v2'),
    getSetting(userId, 'us_state'),
  ]);
  if (!redditToken || !usState) return null;
  return { redditToken, usState };
}
