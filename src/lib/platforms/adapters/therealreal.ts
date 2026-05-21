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
import { UnsupportedOperationError } from '../errors';

interface SerpApiOrganicResult {
  title?: string;
  snippet?: string;
  link?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
}

function extractPrice(snippet: string): number | null {
  const match = snippet.match(/\$([\d,]+(?:\.\d{2})?)/);
  if (!match) return null;
  const dollars = parseFloat(match[1].replace(/,/g, ''));
  return isNaN(dollars) ? null : Math.round(dollars * 100);
}

export class TheRealRealAdapter implements PlatformSDK {
  platform = 'therealreal' as const;

  constructor(private readonly userId: string) {}

  async searchSoldComps(query: string, options?: { limit?: number }): Promise<PlatformComp[]> {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) return [];

    const limit = options?.limit ?? 20;
    const searchUrl = new URL('https://serpapi.com/search');
    searchUrl.searchParams.set('engine', 'google');
    searchUrl.searchParams.set('q', `site:therealreal.com ${query}`);
    searchUrl.searchParams.set('num', String(Math.min(limit, 20)));
    searchUrl.searchParams.set('api_key', apiKey);

    try {
      const res = await fetch(searchUrl.toString());
      if (!res.ok) return [];

      const data = (await res.json()) as SerpApiResponse;
      const results = data.organic_results ?? [];

      return results
        .map((r): PlatformComp | null => {
          const price = r.snippet ? extractPrice(r.snippet) : null;
          if (!price) return null;
          return {
            platform: 'therealreal',
            title: r.title ?? '',
            soldPrice: price,
            condition: '',
            url: r.link ?? '',
            soldAt: null,
          };
        })
        .filter((c): c is PlatformComp => c !== null);
    } catch {
      return [];
    }
  }

  async createListing(_listing: UnifiedListing): Promise<{ platformId: string; url: string }> {
    throw new UnsupportedOperationError('therealreal', 'createListing — TRR is read-only');
  }

  async updateListing(_platformId: string, _updates: Partial<UnifiedListing>): Promise<void> {
    throw new UnsupportedOperationError('therealreal', 'updateListing — TRR is read-only');
  }

  async deleteListing(_platformId: string): Promise<void> {
    throw new UnsupportedOperationError('therealreal', 'deleteListing — TRR is read-only');
  }

  async getListing(_platformId: string): Promise<PlatformListing> {
    throw new UnsupportedOperationError('therealreal', 'getListing — TRR is read-only');
  }

  async getMyListings(_filters?: { status?: string }): Promise<PlatformListing[]> {
    throw new UnsupportedOperationError('therealreal', 'getMyListings — TRR is read-only');
  }

  async getOrders(_since?: Date): Promise<PlatformOrder[]> {
    throw new UnsupportedOperationError('therealreal', 'getOrders — TRR manages fulfillment');
  }

  async getOrder(_orderId: string): Promise<PlatformOrder> {
    throw new UnsupportedOperationError('therealreal', 'getOrder — TRR manages fulfillment');
  }

  async markShipped(_orderId: string, _tracking: TrackingInfo): Promise<void> {
    throw new UnsupportedOperationError('therealreal', 'markShipped — TRR manages fulfillment');
  }

  async getNotifications(_since?: Date): Promise<PlatformNotification[]> {
    return [];
  }

  async markNotificationRead(_notificationId: string): Promise<void> {}

  async getThreads(): Promise<PlatformThread[]> {
    throw new UnsupportedOperationError('therealreal', 'getThreads — TRR has no messaging API');
  }

  async getThread(_threadId: string): Promise<PlatformMessage[]> {
    throw new UnsupportedOperationError('therealreal', 'getThread');
  }

  async sendMessage(_threadId: string, _body: string): Promise<void> {
    throw new UnsupportedOperationError('therealreal', 'sendMessage');
  }
}
