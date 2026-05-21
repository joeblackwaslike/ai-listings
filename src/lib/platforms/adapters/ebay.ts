import type {
  PlatformSDK,
  PlatformComp,
  PlatformListing,
  PlatformOrder,
  PlatformNotification,
  PlatformThread,
  PlatformMessage,
  TrackingInfo,
  UnifiedListing,
} from '../types';
import { AuthExpiredError, PlatformError, UnsupportedOperationError } from '../errors';
import eBayApi from '@hendt/ebay-api';

// ---- Internal eBay API shape types ----------------------------------------

interface EbayError {
  errorId?: number;
  message?: string;
  errors?: Array<{ message: string }>;
}

interface EbayInventoryItem {
  sku: string;
  product?: {
    title?: string;
    imageUrls?: string[];
  };
  condition?: string;
  availability?: {
    shipToLocationAvailability?: { quantity?: number };
  };
}

interface EbayOffer {
  offerId: string;
  sku: string;
  pricingSummary?: { price?: { value?: string } };
  listingId?: string;
  status?: string;
}

interface EbayOrder {
  orderId: string;
  lineItems?: Array<{ legacyItemId?: string }>;
  buyer?: { username?: string };
  pricingSummary?: { total?: { value?: string } };
  orderFulfillmentStatus?: string;
  creationDate?: string;
  fulfillmentStartInstructions?: Array<{
    shippingStep?: { shipTo?: { contactAddress?: { addressLine1?: string; city?: string; stateOrProvince?: string; postalCode?: string; countryCode?: string } } };
  }>;
  lineItemsFulfillmentSummary?: Array<{ shipmentTrackingNumber?: string }>;
}

// ---- Condition helpers -----------------------------------------------------

function mapConditionToEbay(condition: string): string {
  const map: Record<string, string> = {
    new_with_tags: 'NEW',
    new_without_tags: 'NEW',
    like_new: 'LIKE_NEW',
    very_good: 'EXCELLENT',
    good: 'GOOD',
    fair: 'ACCEPTABLE',
    poor: 'FOR_PARTS_OR_NOT_WORKING',
  };
  return map[condition] ?? 'GOOD';
}

function mapConditionIdToEbay(condition: string): number {
  const map: Record<string, number> = {
    new_with_tags: 1000,
    new_without_tags: 1000,
    like_new: 1500,
    very_good: 2000,
    good: 2500,
    fair: 3000,
    poor: 7000,
  };
  return map[condition] ?? 2500;
}

function mapEbayStatusToInternal(
  status: string | undefined,
): PlatformOrder['status'] {
  switch ((status ?? '').toUpperCase()) {
    case 'FULFILLED':
      return 'shipped';
    case 'IN_PROGRESS':
      return 'pending';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'pending';
  }
}

// ---- Order mapper -----------------------------------------------------------

function mapEbayOrder(o: EbayOrder): PlatformOrder {
  const priceStr = o.pricingSummary?.total?.value ?? '0';
  const addressParts = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo?.contactAddress;
  const shippingAddress = addressParts
    ? [
        addressParts.addressLine1,
        addressParts.city,
        addressParts.stateOrProvince,
        addressParts.postalCode,
        addressParts.countryCode,
      ]
        .filter(Boolean)
        .join(', ')
    : undefined;
  const tracking = o.lineItemsFulfillmentSummary?.[0]?.shipmentTrackingNumber;

  return {
    platform: 'ebay',
    orderId: o.orderId,
    listingId: o.lineItems?.[0]?.legacyItemId ?? '',
    buyerUsername: o.buyer?.username ?? '',
    salePrice: Math.round(parseFloat(priceStr) * 100),
    status: mapEbayStatusToInternal(o.orderFulfillmentStatus),
    createdAt: new Date(o.creationDate ?? Date.now()),
    shippingAddress,
    trackingNumber: tracking,
  };
}

// ---- EbayAdapter -----------------------------------------------------------

export class EbayAdapter implements PlatformSDK {
  platform = 'ebay' as const;
  private creds: { clientId: string; clientSecret: string; refreshToken: string };
  private _client: InstanceType<typeof eBayApi> | null = null;

  constructor(creds: { clientId: string; clientSecret: string; refreshToken: string }) {
    this.creds = creds;
  }

  // Lazy-init the eBay client and return a valid access token.
  private async getAccessToken(): Promise<string> {
    if (!this._client) {
      this._client = new eBayApi({
        appId: this.creds.clientId,
        certId: this.creds.clientSecret,
        sandbox: false,
        autoRefreshToken: false,
      });
      // Seed the OAuth2 layer with the stored refresh token so it can exchange
      // it for a fresh access token.
      this._client.oAuth2.setCredentials({
        refresh_token: this.creds.refreshToken,
        access_token: '',
        expires_in: 0,
        token_type: 'User Access Token',
        refresh_token_expires_in: 0,
      });
    }

    try {
      const token = await this._client.oAuth2.refreshToken();
      return token.access_token as string;
    } catch (err) {
      throw new AuthExpiredError(this.platform);
    }
  }

  // Shared fetch helper — throws typed errors on non-2xx responses.
  private async ebayFetch<T = unknown>(
    url: string,
    options: RequestInit,
    token: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers as Record<string, string> | undefined),
    };

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      throw new AuthExpiredError(this.platform);
    }

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as EbayError;
        message = errBody.errors?.[0]?.message ?? errBody.message ?? message;
      } catch {
        // ignore parse errors
      }
      throw new PlatformError(this.platform, message);
    }

    // 204 No Content — return empty object
    if (res.status === 204) return {} as T;

    return res.json() as Promise<T>;
  }

  // ---- Comps ----------------------------------------------------------------

  // SerpAPI in step3-pricing-research.ts handles eBay sold comps.
  async searchSoldComps(_query: string): Promise<PlatformComp[]> {
    return [];
  }

  // ---- Listings -------------------------------------------------------------

  async createListing(
    listing: UnifiedListing,
  ): Promise<{ platformId: string; url: string }> {
    const token = await this.getAccessToken();
    const sku = listing.internalId;
    const ebayFields = listing.platformFields as Record<string, unknown>;

    // Step 1: Create/update inventory item
    await this.ebayFetch(
      `https://api.ebay.com/sell/inventory/v1/inventory_item/${sku}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          product: {
            title: listing.title,
            description: listing.description,
            imageUrls: listing.imageUrls,
            aspects: (ebayFields.aspects as Record<string, string[]>) ?? {},
          },
          condition: mapConditionToEbay(listing.condition),
          conditionId: mapConditionIdToEbay(listing.condition),
          availability: { shipToLocationAvailability: { quantity: 1 } },
        }),
      },
      token,
    );

    // Step 2: Create offer
    const offer = await this.ebayFetch<{ offerId: string }>(
      'https://api.ebay.com/sell/inventory/v1/offer',
      {
        method: 'POST',
        body: JSON.stringify({
          sku,
          marketplaceId: 'EBAY_US',
          format: 'FIXED_PRICE',
          listingDescription: listing.description,
          pricingSummary: {
            price: { value: (listing.price / 100).toFixed(2), currency: 'USD' },
          },
          categoryId: String((ebayFields.category_id as number) ?? 9355),
          merchantLocationKey: 'default',
        }),
      },
      token,
    );

    // Step 3: Publish offer
    const published = await this.ebayFetch<{ listingId: string }>(
      `https://api.ebay.com/sell/inventory/v1/offer/${offer.offerId}/publish`,
      { method: 'POST' },
      token,
    );

    return {
      platformId: published.listingId,
      url: `https://www.ebay.com/itm/${published.listingId}`,
    };
  }

  async updateListing(
    platformId: string,
    updates: Partial<UnifiedListing>,
  ): Promise<void> {
    const token = await this.getAccessToken();

    // Retrieve current offers for this listing to find the offerId
    const offersRes = await this.ebayFetch<{ offers?: EbayOffer[] }>(
      `https://api.ebay.com/sell/inventory/v1/offer?listing_id=${platformId}`,
      { method: 'GET' },
      token,
    );
    const offer = offersRes.offers?.[0];
    if (!offer) throw new PlatformError(this.platform, `No offer found for listing ${platformId}`);

    const body: Record<string, unknown> = {};
    if (updates.price !== undefined) {
      body.pricingSummary = {
        price: { value: (updates.price / 100).toFixed(2), currency: 'USD' },
      };
    }
    if (updates.description !== undefined) {
      body.listingDescription = updates.description;
    }

    await this.ebayFetch(
      `https://api.ebay.com/sell/inventory/v1/offer/${offer.offerId}`,
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    );

    // If title/images/condition changed — update inventory item too
    if (updates.title || updates.imageUrls || updates.condition || updates.description) {
      const itemBody: Record<string, unknown> = {};
      if (updates.title || updates.imageUrls || updates.description) {
        itemBody.product = {
          ...(updates.title ? { title: updates.title } : {}),
          ...(updates.description ? { description: updates.description } : {}),
          ...(updates.imageUrls ? { imageUrls: updates.imageUrls } : {}),
        };
      }
      if (updates.condition) {
        itemBody.condition = mapConditionToEbay(updates.condition);
        itemBody.conditionId = mapConditionIdToEbay(updates.condition);
      }
      // Use the SKU from the offer to update the inventory item
      await this.ebayFetch(
        `https://api.ebay.com/sell/inventory/v1/inventory_item/${offer.sku}`,
        { method: 'PUT', body: JSON.stringify(itemBody) },
        token,
      );
    }
  }

  async deleteListing(platformId: string): Promise<void> {
    const token = await this.getAccessToken();

    // Find offer by listing id, then withdraw it
    const offersRes = await this.ebayFetch<{ offers?: EbayOffer[] }>(
      `https://api.ebay.com/sell/inventory/v1/offer?listing_id=${platformId}`,
      { method: 'GET' },
      token,
    );
    const offer = offersRes.offers?.[0];
    if (!offer) throw new PlatformError(this.platform, `No offer found for listing ${platformId}`);

    await this.ebayFetch(
      `https://api.ebay.com/sell/inventory/v1/offer/${offer.offerId}/withdraw`,
      { method: 'POST' },
      token,
    );
  }

  async getListing(platformId: string): Promise<PlatformListing> {
    const token = await this.getAccessToken();

    const offersRes = await this.ebayFetch<{ offers?: EbayOffer[] }>(
      `https://api.ebay.com/sell/inventory/v1/offer?listing_id=${platformId}`,
      { method: 'GET' },
      token,
    );
    const offer = offersRes.offers?.[0];
    if (!offer) throw new PlatformError(this.platform, `Listing ${platformId} not found`);

    // Fetch inventory item for title/images
    const item = await this.ebayFetch<EbayInventoryItem>(
      `https://api.ebay.com/sell/inventory/v1/inventory_item/${offer.sku}`,
      { method: 'GET' },
      token,
    );

    const priceStr = offer.pricingSummary?.price?.value ?? '0';
    const statusMap: Record<string, PlatformListing['status']> = {
      PUBLISHED: 'active',
      ENDED: 'sold',
      UNPUBLISHED: 'draft',
    };

    return {
      platform: 'ebay',
      platformId,
      url: `https://www.ebay.com/itm/${platformId}`,
      title: item.product?.title ?? '',
      price: Math.round(parseFloat(priceStr) * 100),
      status: statusMap[offer.status ?? ''] ?? 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      raw: { offer, item } as Record<string, unknown>,
    };
  }

  async getMyListings(filters?: { status?: string }): Promise<PlatformListing[]> {
    const token = await this.getAccessToken();
    const statusParam = filters?.status ? `&status=${filters.status.toUpperCase()}` : '';
    const res = await this.ebayFetch<{ offers?: EbayOffer[] }>(
      `https://api.ebay.com/sell/inventory/v1/offer?marketplace_id=EBAY_US&limit=200${statusParam}`,
      { method: 'GET' },
      token,
    );

    const offers = res.offers ?? [];
    return offers.map((offer) => {
      const priceStr = offer.pricingSummary?.price?.value ?? '0';
      const statusMap: Record<string, PlatformListing['status']> = {
        PUBLISHED: 'active',
        ENDED: 'sold',
        UNPUBLISHED: 'draft',
      };
      return {
        platform: 'ebay',
        platformId: offer.listingId ?? offer.offerId,
        url: offer.listingId ? `https://www.ebay.com/itm/${offer.listingId}` : '',
        title: offer.sku,
        price: Math.round(parseFloat(priceStr) * 100),
        status: statusMap[offer.status ?? ''] ?? 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        raw: offer as unknown as Record<string, unknown>,
      };
    });
  }

  // ---- Orders ---------------------------------------------------------------

  async getOrders(since?: Date): Promise<PlatformOrder[]> {
    const token = await this.getAccessToken();
    const filter = since
      ? `creationdate:[${since.toISOString()}...]`
      : '';
    const params = new URLSearchParams({ limit: '50' });
    if (filter) params.set('filter', filter);

    const res = await this.ebayFetch<{ orders?: EbayOrder[] }>(
      `https://api.ebay.com/sell/fulfillment/v1/order?${params.toString()}`,
      { method: 'GET' },
      token,
    );
    return (res.orders ?? []).map(mapEbayOrder);
  }

  async getOrder(orderId: string): Promise<PlatformOrder> {
    const token = await this.getAccessToken();
    const order = await this.ebayFetch<EbayOrder>(
      `https://api.ebay.com/sell/fulfillment/v1/order/${orderId}`,
      { method: 'GET' },
      token,
    );
    return mapEbayOrder(order);
  }

  async markShipped(orderId: string, tracking: TrackingInfo): Promise<void> {
    const token = await this.getAccessToken();

    // Fetch order to get lineItemIds
    const order = await this.ebayFetch<EbayOrder>(
      `https://api.ebay.com/sell/fulfillment/v1/order/${orderId}`,
      { method: 'GET' },
      token,
    );

    await this.ebayFetch(
      `https://api.ebay.com/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`,
      {
        method: 'POST',
        body: JSON.stringify({
          lineItems: (order.lineItems ?? []).map((li) => ({
            lineItemId: li.legacyItemId ?? orderId,
          })),
          shippedDate: new Date().toISOString(),
          shippingCarrierCode: tracking.carrier,
          trackingNumber: tracking.trackingNumber,
        }),
      },
      token,
    );
  }

  // ---- Notifications --------------------------------------------------------

  // eBay uses webhooks (not polling) for real-time notifications.
  // The webhook route at /api/webhooks/ebay handles incoming events.
  async getNotifications(_since?: Date): Promise<PlatformNotification[]> {
    return [];
  }

  async markNotificationRead(_notificationId: string): Promise<void> {
    // Notification state is managed in our own notifications table.
  }

  // ---- Messaging (Trading API — not yet implemented) -------------------------

  async getThreads(): Promise<PlatformThread[]> {
    throw new UnsupportedOperationError(
      this.platform,
      'getThreads — eBay Trading API messaging not yet implemented',
    );
  }

  async getThread(_threadId: string): Promise<PlatformMessage[]> {
    throw new UnsupportedOperationError(
      this.platform,
      'getThread — eBay Trading API messaging not yet implemented',
    );
  }

  async sendMessage(_threadId: string, _body: string): Promise<void> {
    throw new UnsupportedOperationError(
      this.platform,
      'sendMessage — eBay Trading API messaging not yet implemented',
    );
  }
}
