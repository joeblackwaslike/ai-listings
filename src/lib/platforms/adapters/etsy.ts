import type {
  PlatformSDK,
  PlatformComp,
  PlatformListing,
  PlatformOrder,
  PlatformNotification,
  PlatformMessage,
  PlatformThread,
  UnifiedListing,
  TrackingInfo,
} from '../types';
import { AuthExpiredError, PlatformError, UnsupportedOperationError } from '../errors';
import { getEtsyCreds } from '@/lib/platforms/credentials';
import { setSetting } from '@/lib/user-settings';

const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';

interface EtsyListing {
  listing_id: number;
  title: string;
  price: { amount: number; divisor: number };
  state: string;
  creation_timestamp: number;
  last_modified_timestamp: number;
}

interface EtsyReceipt {
  receipt_id: number;
  buyer_user_id: number;
  grandtotal: { amount: number; divisor: number };
  is_shipped: boolean;
  create_timestamp: number;
  transactions: Array<{ listing_id: number }>;
}

interface EtsyTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function mapEtsyState(state: string): PlatformListing['status'] {
  switch (state) {
    case 'active':   return 'active';
    case 'sold_out': return 'sold';
    case 'removed':  return 'removed';
    case 'draft':    return 'draft';
    default:         return 'active';
  }
}

export class EtsyAdapter implements PlatformSDK {
  platform = 'etsy' as const;

  private _accessToken: string | null = null;
  private _tokenExpiresAt = 0;
  private _shopId: string | null = null;
  private _clientId: string | null = null;

  constructor(private readonly userId: string) {}

  private async getAccessToken(): Promise<string> {
    if (this._accessToken && Date.now() < this._tokenExpiresAt - 60_000) {
      return this._accessToken;
    }

    const creds = await getEtsyCreds(this.userId);
    if (!creds) throw new AuthExpiredError('etsy');

    this._shopId = creds.shopId;
    this._clientId = creds.clientId;

    const res = await fetch(ETSY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: creds.clientId,
        refresh_token: creds.refreshToken,
      }).toString(),
    });

    if (res.status === 401 || res.status === 403) throw new AuthExpiredError('etsy');
    if (!res.ok) throw new PlatformError('etsy', `Token refresh failed: HTTP ${res.status}`);

    const token = (await res.json()) as EtsyTokenResponse;
    this._accessToken = token.access_token;
    this._tokenExpiresAt = Date.now() + token.expires_in * 1000;

    await Promise.all([
      setSetting(this.userId, 'etsy_access_token', token.access_token, 'credential'),
      setSetting(this.userId, 'etsy_refresh_token', token.refresh_token, 'credential'),
    ]);

    return this._accessToken;
  }

  private async getShopId(): Promise<string> {
    if (this._shopId) return this._shopId;
    await this.getAccessToken();
    if (!this._shopId) throw new PlatformError('etsy', 'shopId not configured');
    return this._shopId;
  }

  private async etsyFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const clientId = this._clientId ?? process.env.ETSY_CLIENT_ID ?? '';
    const isFormData = options.body instanceof FormData;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'x-api-key': clientId,
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers as Record<string, string> | undefined),
    };

    const url = path.startsWith('http') ? path : `${ETSY_API_BASE}${path}`;
    const res = await fetch(url, { ...options, headers });

    if (res.status === 401 || res.status === 403) throw new AuthExpiredError('etsy');
    if (res.status === 204) return {} as T;

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; error_description?: string };
        message = body.error_description ?? body.error ?? message;
      } catch { /* ignore parse errors */ }
      throw new PlatformError('etsy', message);
    }

    return res.json() as Promise<T>;
  }

  async searchSoldComps(_query: string, _options?: { limit?: number }): Promise<PlatformComp[]> {
    throw new UnsupportedOperationError('etsy', 'searchSoldComps — handled via SerpAPI in step3 pipeline');
  }

  async createListing(listing: UnifiedListing): Promise<{ platformId: string; url: string }> {
    const shopId = await this.getShopId();
    const etsyFields = ((listing.platformFields as Record<string, unknown>).etsy ?? {}) as Record<string, unknown>;

    const created = await this.etsyFetch<EtsyListing>(`/shops/${shopId}/listings`, {
      method: 'POST',
      body: JSON.stringify({
        quantity: 1,
        title: listing.title.slice(0, 140),
        description: listing.description,
        price: listing.price / 100,
        who_made: 'someone_else',
        when_made: (etsyFields.when_made as string) ?? '2010_2019',
        taxonomy_id: (etsyFields.taxonomy_id as number) ?? 68887682,
        type: 'physical',
        shipping_profile_id: (etsyFields.shipping_profile_id as number) ?? 0,
        tags: (etsyFields.tags as string[]) ?? [],
        state: 'draft',
      }),
    });

    const listingId = created.listing_id;

    // Activate — non-fatal if activation fails (listing stays as draft)
    try {
      await this.etsyFetch(`/shops/${shopId}/listings/${listingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'active' }),
      });
    } catch { /* leave as draft */ }

    // Upload images — skip any that fail individually
    for (const imageUrl of listing.imageUrls) {
      try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) continue;
        const blob = await imgRes.blob();
        const form = new FormData();
        form.append('image', blob, 'image.jpg');
        await this.etsyFetch(`/shops/${shopId}/listings/${listingId}/images`, {
          method: 'POST',
          body: form,
        });
      } catch { /* skip failed images */ }
    }

    return {
      platformId: String(listingId),
      url: `https://www.etsy.com/listing/${listingId}`,
    };
  }

  async updateListing(platformId: string, updates: Partial<UnifiedListing>): Promise<void> {
    const shopId = await this.getShopId();
    const body: Record<string, unknown> = {};

    if (updates.title !== undefined) body.title = updates.title.slice(0, 140);
    if (updates.description !== undefined) body.description = updates.description;
    if (updates.price !== undefined) body.price = updates.price / 100;

    const etsyFields = ((updates.platformFields as Record<string, unknown> | undefined)?.etsy ?? {}) as Record<string, unknown>;
    if (etsyFields.tags !== undefined) body.tags = etsyFields.tags;

    if (Object.keys(body).length === 0) return;

    await this.etsyFetch(`/shops/${shopId}/listings/${platformId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async deleteListing(platformId: string): Promise<void> {
    const shopId = await this.getShopId();
    await this.etsyFetch(`/shops/${shopId}/listings/${platformId}`, { method: 'DELETE' });
  }

  async getListing(platformId: string): Promise<PlatformListing> {
    const listing = await this.etsyFetch<EtsyListing>(`/listings/${platformId}`);
    return this.mapListing(listing);
  }

  async getMyListings(filters?: { status?: string }): Promise<PlatformListing[]> {
    const shopId = await this.getShopId();
    const state = filters?.status ?? 'active';
    const res = await this.etsyFetch<{ results: EtsyListing[] }>(
      `/shops/${shopId}/listings?state=${state}`,
    );
    return (res.results ?? []).map((l) => this.mapListing(l));
  }

  private mapListing(l: EtsyListing): PlatformListing {
    return {
      platform: 'etsy',
      platformId: String(l.listing_id),
      url: `https://www.etsy.com/listing/${l.listing_id}`,
      title: l.title,
      price: Math.round((l.price.amount / l.price.divisor) * 100),
      status: mapEtsyState(l.state),
      createdAt: new Date(l.creation_timestamp * 1000),
      updatedAt: new Date(l.last_modified_timestamp * 1000),
      raw: l as unknown as Record<string, unknown>,
    };
  }

  async getOrders(since?: Date): Promise<PlatformOrder[]> {
    const shopId = await this.getShopId();
    const params = new URLSearchParams({ was_paid: 'true', was_shipped: 'false' });
    if (since) params.set('min_created', String(Math.floor(since.getTime() / 1000)));
    const res = await this.etsyFetch<{ results: EtsyReceipt[] }>(
      `/shops/${shopId}/receipts?${params.toString()}`,
    );
    return (res.results ?? []).map((r) => this.mapReceipt(r));
  }

  async getOrder(orderId: string): Promise<PlatformOrder> {
    const shopId = await this.getShopId();
    const receipt = await this.etsyFetch<EtsyReceipt>(`/shops/${shopId}/receipts/${orderId}`);
    return this.mapReceipt(receipt);
  }

  private mapReceipt(r: EtsyReceipt): PlatformOrder {
    return {
      platform: 'etsy',
      orderId: String(r.receipt_id),
      listingId: String(r.transactions[0]?.listing_id ?? ''),
      buyerUsername: String(r.buyer_user_id),
      salePrice: Math.round((r.grandtotal.amount * 100) / r.grandtotal.divisor),
      status: r.is_shipped ? 'shipped' : 'pending',
      createdAt: new Date(r.create_timestamp * 1000),
    };
  }

  async markShipped(orderId: string, tracking: TrackingInfo): Promise<void> {
    const shopId = await this.getShopId();
    await this.etsyFetch(`/shops/${shopId}/receipts/${orderId}/tracking`, {
      method: 'POST',
      body: JSON.stringify({
        tracking_code: tracking.trackingNumber,
        carrier_name: tracking.carrier.toLowerCase(),
      }),
    });
  }

  // Etsy is webhook-based — no polling endpoint for notifications.
  async getNotifications(_since?: Date): Promise<PlatformNotification[]> {
    return [];
  }

  async markNotificationRead(_notificationId: string): Promise<void> {}

  async getThreads(): Promise<PlatformThread[]> {
    throw new UnsupportedOperationError('etsy', 'getThreads — Etsy messaging not available via API');
  }

  async getThread(_threadId: string): Promise<PlatformMessage[]> {
    throw new UnsupportedOperationError('etsy', 'getThread — Etsy messaging not available via API');
  }

  async sendMessage(_threadId: string, _body: string): Promise<void> {
    throw new UnsupportedOperationError('etsy', 'sendMessage — Etsy messaging not available via API');
  }
}
