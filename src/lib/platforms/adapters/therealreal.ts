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
import { getTheRealRealCreds } from '@/lib/platforms/credentials';

const APIFY_ACTOR = 'lexis-solutions~therealreal-com-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60_000;

interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
}

interface TRRItem {
  title?: string;
  price?: string;
  condition?: string;
  url?: string;
  status?: string;
}

async function pollApifyRun(runId: string, apiKey: string): Promise<TRRItem[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const statusRes = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR}/runs/${runId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statusRes.ok) break;

    const { data: run } = (await statusRes.json()) as { data: ApifyRun };

    if (run.status === 'SUCCEEDED') {
      const dataRes = await fetch(
        `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?format=json`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!dataRes.ok) break;
      return (await dataRes.json()) as TRRItem[];
    }

    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) break;
  }

  return [];
}

export class TheRealRealAdapter implements PlatformSDK {
  platform = 'therealreal' as const;

  constructor(private readonly userId: string) {}

  async searchSoldComps(query: string, options?: { limit?: number }): Promise<PlatformComp[]> {
    const creds = await getTheRealRealCreds(this.userId);
    if (!creds) return [];

    const limit = options?.limit ?? 20;
    const searchUrl = `https://www.therealreal.com/collections/women/jewelry-watches?keywords=${encodeURIComponent(query)}&sort=sold`;

    try {
      const startRes = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR}/runs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apifyApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ startUrls: [{ url: searchUrl }], maxItems: limit }),
      });

      if (!startRes.ok) return [];

      const { data: run } = (await startRes.json()) as { data: ApifyRun };
      const items = await pollApifyRun(run.id, creds.apifyApiKey);

      return items
        .filter((item) => item.status === 'Sold')
        .map((item) => ({
          platform: 'therealreal',
          title: item.title ?? '',
          soldPrice: Math.round(parseFloat((item.price ?? '0').replace(/[^0-9.]/g, '')) * 100),
          condition: item.condition ?? '',
          url: item.url ?? '',
          soldAt: null,
        }));
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
    throw new UnsupportedOperationError('therealreal', 'getThread — TRR has no messaging API');
  }

  async sendMessage(_threadId: string, _body: string): Promise<void> {
    throw new UnsupportedOperationError('therealreal', 'sendMessage — TRR has no messaging API');
  }
}
