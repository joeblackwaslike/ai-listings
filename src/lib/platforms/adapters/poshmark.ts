import { PoshmarkClient } from '@local/poshmark-seller-sdk';
import * as cheerio from 'cheerio';
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

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function parsePoshmarkPrice(price: string | undefined): number {
  if (!price) return 0;
  const match = price.match(/[\d.]+/);
  return match ? Math.round(parseFloat(match[0]) * 100) : 0;
}

function parsePriceText(text: string): number {
  const match = text.match(/[\d.]+/);
  return match ? Math.round(parseFloat(match[0]) * 100) : 0;
}

function mapPoshmarkStatus(status: string | undefined): PlatformListing['status'] {
  if (!status) return 'active';
  const s = status.toLowerCase();
  if (s.includes('sold')) return 'sold';
  if (s.includes('removed') || s.includes('deleted')) return 'removed';
  return 'active';
}

function mapOrderStatus(statusText: string): PlatformOrder['status'] {
  const s = statusText.toLowerCase();
  if (s.includes('delivered')) return 'delivered';
  if (s.includes('shipped')) return 'shipped';
  if (s.includes('cancel')) return 'cancelled';
  return 'pending';
}

function mapPoshmarkError(err: unknown): Error {
  if (err instanceof Error && err.message.includes('401')) {
    return new AuthExpiredError('poshmark');
  }
  if (err instanceof Error) {
    return new PlatformError('poshmark', err.message);
  }
  return new PlatformError('poshmark', String(err));
}

function parseSalesPageHtml(html: string): PlatformOrder[] {
  const $ = cheerio.load(html);
  const orders: PlatformOrder[] = [];

  // Poshmark sales page has order cards — try common selectors
  $('[data-order-id], .order-item, .sales-order').each((_i, el) => {
    const orderId =
      $(el).attr('data-order-id') ??
      $(el).find('a[href*="/order/"]').attr('href')?.split('/').pop();
    if (!orderId) return;

    const priceText = $(el)
      .find('.price, .order-price, [class*="price"]')
      .first()
      .text()
      .trim();
    const buyer = $(el)
      .find('.username, .buyer-name, [class*="username"]')
      .first()
      .text()
      .trim();
    const statusText = $(el)
      .find('.status, .order-status, [class*="status"]')
      .first()
      .text()
      .trim();

    orders.push({
      platform: 'poshmark',
      orderId,
      listingId: '',
      buyerUsername: buyer || 'unknown',
      salePrice: parsePriceText(priceText),
      status: mapOrderStatus(statusText),
      createdAt: new Date(),
    });
  });

  // Fallback: scrape order links directly when no card containers match
  if (orders.length === 0) {
    $('a[href*="/order/sales/"]').each((_i, el) => {
      const href = $(el).attr('href') ?? '';
      const orderId = href.split('/order/sales/')[1]?.split(/[/?#]/)[0];
      if (!orderId) return;

      const container = $(el).closest('li, div, tr, section, article');
      const priceText = container.find('[class*="price"]').first().text().trim();
      const buyer = container.find('[class*="username"], [class*="user"]').first().text().trim();
      const statusText = container.find('[class*="status"]').first().text().trim();

      orders.push({
        platform: 'poshmark',
        orderId,
        listingId: '',
        buyerUsername: buyer || 'unknown',
        salePrice: parsePriceText(priceText),
        status: mapOrderStatus(statusText),
        createdAt: new Date(),
      });
    });
  }

  return orders;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PoshmarkAdapter implements PlatformSDK {
  platform = 'poshmark' as const;
  private client: PoshmarkClient;

  constructor(creds: { sessionCookies: string }) {
    this.client = new PoshmarkClient({
      cookie: creds.sessionCookies,
      requestDelayMs: 500,
    });
  }

  // SerpAPI in step3 handles Poshmark comps — nothing to do here
  async searchSoldComps(_query: string): Promise<PlatformComp[]> {
    return [];
  }

  async getMyListings(): Promise<PlatformListing[]> {
    try {
      const result = await this.client.getClosetListings();
      return result.items.map((item) => ({
        platform: 'poshmark',
        platformId: item.id,
        url: `https://poshmark.com/listing/${item.id}`,
        title: item.title,
        price: parsePoshmarkPrice(item.price),
        status: mapPoshmarkStatus(item.status),
        createdAt: new Date(),
        updatedAt: new Date(),
        raw: item.raw as Record<string, unknown>,
      }));
    } catch (err) {
      throw mapPoshmarkError(err);
    }
  }

  async getListing(platformId: string): Promise<PlatformListing> {
    try {
      const item = await this.client.getListing(platformId);
      return {
        platform: 'poshmark',
        platformId: item.id,
        url: `https://poshmark.com/listing/${item.id}`,
        title: item.title,
        price: parsePoshmarkPrice(item.price),
        status: mapPoshmarkStatus(item.status),
        createdAt: new Date(),
        updatedAt: new Date(),
        raw: item.raw as Record<string, unknown>,
      };
    } catch (err) {
      throw mapPoshmarkError(err);
    }
  }

  async updateListing(platformId: string, updates: Partial<UnifiedListing>): Promise<void> {
    try {
      const fields: {
        title?: string;
        description?: string;
        price?: string;
        brand?: string;
      } = {};
      if (updates.title !== undefined) fields.title = updates.title;
      if (updates.description !== undefined) fields.description = updates.description;
      if (updates.price !== undefined) {
        // Convert cents to dollar string e.g. "25.00 USD"
        fields.price = `${(updates.price / 100).toFixed(2)} USD`;
      }
      if (updates.brand !== undefined) fields.brand = updates.brand;
      await this.client.updateListing(platformId, fields);
    } catch (err) {
      throw mapPoshmarkError(err);
    }
  }

  // Poshmark create requires CSRF from the /create-listing page — not yet
  // reverse-engineered to the point where it can be automated reliably.
  async createListing(_listing: UnifiedListing): Promise<{ platformId: string; url: string }> {
    throw new UnsupportedOperationError(
      this.platform,
      'createListing — requires CSRF from /create-listing page (reverse-engineered endpoint, not yet implemented)',
    );
  }

  async deleteListing(_platformId: string): Promise<void> {
    throw new UnsupportedOperationError(
      this.platform,
      'deleteListing — reverse-engineered endpoint not yet confirmed',
    );
  }

  async getOrders(): Promise<PlatformOrder[]> {
    try {
      const { html } = await this.client.getSalesPage();
      return parseSalesPageHtml(html);
    } catch (err) {
      throw mapPoshmarkError(err);
    }
  }

  async getOrder(orderId: string): Promise<PlatformOrder> {
    try {
      const html = await this.client.getOrderDetailHtml(orderId);
      const $ = cheerio.load(html);

      const priceText = $('[class*="price"]').first().text().trim();
      const buyer = $('[class*="username"], [class*="buyer"]').first().text().trim();
      const statusText = $('[class*="status"]').first().text().trim();

      return {
        platform: 'poshmark',
        orderId,
        listingId: '',
        buyerUsername: buyer || 'unknown',
        salePrice: parsePriceText(priceText),
        status: mapOrderStatus(statusText),
        createdAt: new Date(),
      };
    } catch (err) {
      throw mapPoshmarkError(err);
    }
  }

  async markShipped(_orderId: string, _tracking: TrackingInfo): Promise<void> {
    throw new UnsupportedOperationError(
      this.platform,
      'markShipped — Poshmark generates shipping labels; direct tracking upload not supported',
    );
  }

  async getNotifications(_since?: Date): Promise<PlatformNotification[]> {
    throw new UnsupportedOperationError(
      this.platform,
      'getNotifications — Poshmark notification endpoint not yet reverse-engineered',
    );
  }

  async markNotificationRead(_id: string): Promise<void> {
    // No-op — we don't have the Poshmark notification API yet
  }

  async getThreads(): Promise<PlatformThread[]> {
    throw new UnsupportedOperationError(
      this.platform,
      'getThreads — requires reverse-engineered messaging endpoint',
    );
  }

  async getThread(_threadId: string): Promise<PlatformMessage[]> {
    throw new UnsupportedOperationError(
      this.platform,
      'getThread — requires reverse-engineered messaging endpoint',
    );
  }

  async sendMessage(_threadId: string, _body: string): Promise<void> {
    throw new UnsupportedOperationError(
      this.platform,
      'sendMessage — requires reverse-engineered messaging endpoint',
    );
  }

  async replyToOffer(
    _offerId: string,
    _action: 'accept' | 'decline' | 'counter',
    _counterPrice?: number,
  ): Promise<void> {
    throw new UnsupportedOperationError(
      this.platform,
      'replyToOffer — requires reverse-engineered offer endpoint',
    );
  }
}
