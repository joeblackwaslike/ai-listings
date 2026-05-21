import { GraphQLClient } from 'graphql-request';
import type {
  PlatformSDK,
  PlatformListing,
  PlatformComp,
  PlatformOrder,
  PlatformNotification,
  PlatformMessage,
  PlatformThread,
  UnifiedListing,
  TrackingInfo,
} from '../types';
import { UnsupportedOperationError, AuthExpiredError, PlatformError } from '../errors';

const SHOPS_API = 'https://api.mercari-shops.com/v1/graphql';
// US marketplace — mercari.jp returns JPY which would be misinterpreted as USD cents
const CONSUMER_API = 'https://api.mercari.com/v2/entities:search';

export class MercariAdapter implements PlatformSDK {
  platform = 'mercari' as const;
  private gql: GraphQLClient;
  private accessToken: string;

  constructor(creds: { accessToken: string }) {
    this.accessToken = creds.accessToken;
    this.gql = new GraphQLClient(SHOPS_API, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
  }

  async searchSoldComps(query: string): Promise<PlatformComp[]> {
    try {
      const body = {
        pageToken: '',
        searchSessionId: crypto.randomUUID(),
        indexRouting: 'INDEX_ROUTING_UNSPECIFIED',
        searchCondition: {
          keyword: query,
          status: ['STATUS_SOLD_OUT'],
          categoryId: [],
          brandId: [],
        },
        defaultDatasets: ['DATASET_TYPE_MERCARI'],
        serviceFrom: 'suruga',
      };

      const res = await fetch(CONSUMER_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        if (res.status === 401) throw new AuthExpiredError(this.platform);
        return []; // Don't throw on search failure — comps are best-effort
      }

      const data = (await res.json()) as { items?: MercariItem[] };
      return (data.items ?? []).map(item => ({
        platform: 'mercari',
        title: item.name ?? '',
        soldPrice: Math.round((item.price ?? 0) * 100),
        condition: mapMercariCondition(item.itemConditionId),
        url: `https://www.mercari.com/us/item/${item.id}`,
        soldAt: item.updated ? new Date(item.updated * 1000) : null,
      }));
    } catch (err) {
      if (err instanceof AuthExpiredError) throw err;
      return []; // Best-effort
    }
  }

  async createListing(listing: UnifiedListing): Promise<{ platformId: string; url: string }> {
    const mutation = `
      mutation CreateItem($input: CreateItemInput!) {
        createItem(input: $input) {
          item { id name price status }
        }
      }
    `;

    const mercariFields = listing.platformFields as Record<string, unknown>;
    const variables = {
      input: {
        name: listing.title.slice(0, 40), // Mercari max 40 chars
        description: listing.description,
        price: Math.round(listing.price / 100), // Mercari uses integer dollars (US)
        condition: mapConditionToMercari(listing.condition),
        categoryId: String(mercariFields.category_id ?? '7027'), // default: keyboards
        imageUrls: listing.imageUrls,
      },
    };

    try {
      const data = await this.gql.request<{ createItem: { item: { id: string } } }>(
        mutation,
        variables,
      );
      const itemId = data.createItem.item.id;
      return { platformId: itemId, url: `https://jp.mercari.com/item/${itemId}` };
    } catch (err) {
      throw mapMercariError(err, this.platform);
    }
  }

  async updateListing(platformId: string, updates: Partial<UnifiedListing>): Promise<void> {
    const mutation = `
      mutation UpdateItem($input: UpdateItemInput!) {
        updateItem(input: $input) { item { id name price status } }
      }
    `;
    try {
      await this.gql.request(mutation, {
        input: {
          id: platformId,
          ...(updates.title ? { name: updates.title.slice(0, 40) } : {}),
          ...(updates.description ? { description: updates.description } : {}),
          ...(updates.price !== undefined ? { price: Math.round(updates.price / 100) } : {}),
        },
      });
    } catch (err) {
      throw mapMercariError(err, this.platform);
    }
  }

  async deleteListing(platformId: string): Promise<void> {
    const mutation = `
      mutation DeleteItem($id: ID!) { deleteItem(id: $id) { success } }
    `;
    try {
      await this.gql.request(mutation, { id: platformId });
    } catch (err) {
      throw mapMercariError(err, this.platform);
    }
  }

  async getListing(platformId: string): Promise<PlatformListing> {
    const query = `
      query GetItem($id: ID!) {
        item(id: $id) { id name price status createdAt updatedAt }
      }
    `;
    try {
      const data = await this.gql.request<{ item: MercariShopsItem }>(query, { id: platformId });
      return mapShopsItem(data.item, this.platform);
    } catch (err) {
      throw mapMercariError(err, this.platform);
    }
  }

  async getMyListings(filters?: { status?: string }): Promise<PlatformListing[]> {
    const query = `
      query ListItems($status: ItemStatus) {
        items(status: $status) {
          nodes { id name price status createdAt updatedAt }
        }
      }
    `;
    try {
      const data = await this.gql.request<{ items: { nodes: MercariShopsItem[] } }>(query, {
        status: filters?.status?.toUpperCase(),
      });
      return (data.items.nodes ?? []).map(item => mapShopsItem(item, this.platform));
    } catch (err) {
      throw mapMercariError(err, this.platform);
    }
  }

  async getOrders(since?: Date): Promise<PlatformOrder[]> {
    const query = `
      query ListOrders {
        orders(status: PENDING) {
          nodes {
            id status createdAt
            item { id name price }
            buyer { id name }
            shippingInfo { trackingNumber carrier }
          }
        }
      }
    `;
    try {
      const data = await this.gql.request<{ orders: { nodes: MercariShopsOrder[] } }>(query);
      const orders = (data.orders.nodes ?? []).map(mapShopsOrder);
      return since ? orders.filter((o) => o.createdAt >= since) : orders;
    } catch (err) {
      throw mapMercariError(err, this.platform);
    }
  }

  async getOrder(orderId: string): Promise<PlatformOrder> {
    const query = `
      query GetOrder($id: ID!) {
        order(id: $id) {
          id status createdAt
          item { id name price }
          buyer { id name }
          shippingInfo { trackingNumber carrier }
        }
      }
    `;
    try {
      const data = await this.gql.request<{ order: MercariShopsOrder }>(query, { id: orderId });
      return mapShopsOrder(data.order);
    } catch (err) {
      throw mapMercariError(err, this.platform);
    }
  }

  async markShipped(orderId: string, tracking: TrackingInfo): Promise<void> {
    const mutation = `
      mutation ShipOrder($orderId: ID!, $trackingNumber: String!, $carrier: String!) {
        shipOrder(orderId: $orderId, trackingNumber: $trackingNumber, carrier: $carrier) {
          order { id status }
        }
      }
    `;
    try {
      await this.gql.request(mutation, {
        orderId,
        trackingNumber: tracking.trackingNumber,
        carrier: tracking.carrier,
      });
    } catch (err) {
      throw mapMercariError(err, this.platform);
    }
  }

  async getNotifications(): Promise<PlatformNotification[]> {
    return []; // Webhook-based if available, or polling added in Inngest job
  }

  async markNotificationRead(_id: string): Promise<void> {}

  async getThreads(): Promise<PlatformThread[]> {
    throw new UnsupportedOperationError(
      this.platform,
      'getThreads — Mercari messaging consumer API not yet implemented',
    );
  }

  async getThread(_threadId: string): Promise<PlatformMessage[]> {
    throw new UnsupportedOperationError(this.platform, 'getThread');
  }

  async sendMessage(_threadId: string, _body: string): Promise<void> {
    throw new UnsupportedOperationError(this.platform, 'sendMessage');
  }
}

// ── Internal types ──────────────────────────────────────────────────────────

interface MercariItem {
  id: string;
  name?: string;
  price?: number;
  itemConditionId?: number;
  updated?: number;
}

interface MercariShopsItem {
  id: string;
  name: string;
  price: number;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

interface MercariShopsOrder {
  id: string;
  status: string;
  createdAt: string;
  item: { id: string; name: string; price: number };
  buyer: { id: string; name: string };
  shippingInfo?: { trackingNumber?: string; carrier?: string };
}

// ── Mapper helpers ──────────────────────────────────────────────────────────

function mapShopsItem(item: MercariShopsItem, platform: string): PlatformListing {
  return {
    platform,
    platformId: item.id,
    url: `https://jp.mercari.com/item/${item.id}`,
    title: item.name,
    price: Math.round(item.price * 100),
    status: item.status.toLowerCase() === 'sold_out' ? 'sold' : 'active',
    createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
    updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
    raw: item as unknown as Record<string, unknown>,
  };
}

function mapShopsOrder(order: MercariShopsOrder): PlatformOrder {
  return {
    platform: 'mercari',
    orderId: order.id,
    listingId: order.item.id,
    buyerUsername: order.buyer.name,
    salePrice: Math.round(order.item.price * 100),
    status: 'pending',
    createdAt: new Date(order.createdAt),
    trackingNumber: order.shippingInfo?.trackingNumber,
  };
}

function mapConditionToMercari(condition: string): string {
  const map: Record<string, string> = {
    new_with_tags: 'LIKE_NEW',
    new_without_tags: 'LIKE_NEW',
    like_new: 'LIKE_NEW',
    very_good: 'GOOD',
    good: 'GOOD',
    fair: 'FAIR',
    poor: 'POOR',
  };
  return map[condition] ?? 'GOOD';
}

function mapMercariCondition(conditionId: number | undefined): string {
  const map: Record<number, string> = { 1: 'Like New', 2: 'Good', 3: 'Fair', 4: 'Poor' };
  return conditionId != null ? (map[conditionId] ?? 'Good') : 'Good';
}

function mapMercariError(err: unknown, platform: string): Error {
  if (
    err instanceof Error &&
    (err.message.includes('401') || err.message.includes('UNAUTHENTICATED'))
  ) {
    return new AuthExpiredError(platform);
  }
  if (err instanceof Error) {
    return new PlatformError(platform, err.message);
  }
  return new PlatformError(platform, String(err));
}
