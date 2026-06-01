import { createClient } from '@supabase/supabase-js';
import { uploadFile } from '@/lib/storage';
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
import { AuthExpiredError, CooldownError, PlatformError, UnsupportedOperationError } from '../errors';
import { getMechmarketCreds } from '../credentials';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48 hours

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(0);
}

function buildPostTitle(usState: string, itemNames: string[]): string {
  return `[US-${usState}][H] ${itemNames.join(', ')} [W] PayPal`;
}

interface PostItem {
  listing_id: string;
  title: string;
  price: number; // cents
  condition: string;
  description: string;
  timestamp_photo_url: string | null;
  sort_order: number;
  status: string;
}

function buildPostBody(items: PostItem[], albumUrl?: string): string {
  const header = albumUrl
    ? `Timestamp album: ${albumUrl}`
    : `Timestamp album: See individual timestamps below`;

  const activeSections = items
    .filter((item) => item.status !== 'removed')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => {
      const soldTag = item.status === 'sold' ? ' **[SOLD]**' : '';
      return [
        `**${item.title}**${soldTag}`,
        `Price: $${formatPrice(item.price)} shipped`,
        `Condition: ${item.condition}`,
        ...(item.timestamp_photo_url ? [`Timestamp: ${item.timestamp_photo_url}`] : []),
        '',
        item.description || '',
      ].join('\n');
    });

  return [
    header,
    '',
    '**Prices shipped CONUS. PayPal G&S only.**',
    '',
    '---',
    '',
    activeSections.join('\n\n---\n\n'),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Types for DB rows
// ---------------------------------------------------------------------------

interface MechmarketPostRow {
  id: string;
  user_id: string;
  reddit_post_id: string;
  reddit_post_url: string;
  last_promoted_at: string | null;
  next_eligible_post_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MechmarketPostItemRow {
  post_id: string;
  listing_id: string;
  timestamp_photo_url: string | null;
  timestamp_imgur_album_url: string | null;
  status: string;
  sort_order: number;
}

interface ListingRow {
  id: string;
  title: string;
  price: number;
  condition: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Reddit API helpers
// ---------------------------------------------------------------------------

const REDDIT_BASE = 'https://www.reddit.com';
const REDDIT_UA = 'ai-listings/1.0 (by /u/ai-listings-bot)';

interface RedditAuth {
  cookie: string;
  modhash: string;
}

interface RedditMeResponse {
  data: { modhash: string };
}

interface RedditSubmitResponse {
  json: { data: { id: string; url: string }; errors: unknown[] };
}

interface RedditSearchChild {
  data: { title: string; selftext: string };
}

interface RedditSearchResponse {
  data: { children: RedditSearchChild[] };
}

interface RedditMessageData {
  name: string;
  subject: string;
  body: string;
  author: string | null;
  created_utc: number;
  new: boolean;
  first_message_name: string;
  replies: { data?: { children?: Array<{ data: RedditMessageData }> } } | string;
}

interface RedditInboxResponse {
  data: { children: Array<{ data: RedditMessageData }> };
}

// ---------------------------------------------------------------------------
// MechmarketAdapter
// ---------------------------------------------------------------------------

export class MechmarketAdapter implements PlatformSDK {
  platform = 'mechmarket' as const;

  constructor(private readonly userId: string) {}

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async getRedditAuth(): Promise<RedditAuth> {
    const creds = await getMechmarketCreds(this.userId);
    if (!creds) throw new AuthExpiredError('mechmarket');
    const cookie = `token_v2=${creds.redditToken}`;
    const res = await fetch(`${REDDIT_BASE}/api/me.json`, {
      headers: { Cookie: cookie, 'User-Agent': REDDIT_UA },
    });
    if (!res.ok) throw new AuthExpiredError('mechmarket');
    const data = (await res.json()) as RedditMeResponse;
    const modhash = data?.data?.modhash;
    if (!modhash) throw new AuthExpiredError('mechmarket');
    return { cookie, modhash };
  }

  /** Fetch all items for a post and rebuild the Reddit post body. */
  private async rebuildPostBody(redditPostId: string): Promise<string> {
    const supabase = getSupabaseAdmin();

    const { data: postRow } = await supabase
      .from('mechmarket_posts')
      .select('id')
      .eq('reddit_post_id', redditPostId)
      .single<Pick<MechmarketPostRow, 'id'>>();

    if (!postRow) throw new Error(`mechmarket post not found: ${redditPostId}`);

    const { data: items } = await supabase
      .from('mechmarket_post_items')
      .select('listing_id, timestamp_photo_url, timestamp_imgur_album_url, status, sort_order')
      .eq('post_id', postRow.id)
      .neq('status', 'removed')
      .returns<MechmarketPostItemRow[]>();

    if (!items || items.length === 0) return buildPostBody([]);

    const listingIds = items.map((i) => i.listing_id);
    const { data: listings } = await supabase
      .from('listings')
      .select('id, title, price, condition, description')
      .in('id', listingIds)
      .returns<ListingRow[]>();

    const listingMap = new Map<string, ListingRow>(
      (listings ?? []).map((l) => [l.id, l]),
    );

    const albumUrl = items[0]?.timestamp_imgur_album_url ?? undefined;

    const postItems: PostItem[] = items.map((item) => {
      const listing = listingMap.get(item.listing_id);
      return {
        listing_id: item.listing_id,
        title: listing?.title ?? '(unknown)',
        price: listing?.price ?? 0,
        condition: listing?.condition ?? '',
        description: listing?.description ?? '',
        timestamp_photo_url: item.timestamp_photo_url,
        sort_order: item.sort_order,
        status: item.status,
      };
    });

    return buildPostBody(postItems, albumUrl);
  }

  private redditHeaders(auth: RedditAuth): Record<string, string> {
    return { Cookie: auth.cookie, 'X-Modhash': auth.modhash, 'User-Agent': REDDIT_UA };
  }

  private async redditPost(auth: RedditAuth, path: string, body: Record<string, string>): Promise<Response> {
    return fetch(`${REDDIT_BASE}${path}`, {
      method: 'POST',
      headers: { ...this.redditHeaders(auth), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  }

  // --------------------------------------------------------------------------
  // PlatformSDK — Comps
  // --------------------------------------------------------------------------

  async searchSoldComps(query: string): Promise<PlatformComp[]> {
    if (!process.env.ANTHROPIC_API_KEY) return [];

    try {
      const params = new URLSearchParams({
        q: `[H] ${query}`,
        sort: 'new',
        limit: '25',
        restrict_sr: '1',
        type: 'link',
      });
      const res = await fetch(`${REDDIT_BASE}/r/mechmarket/search.json?${params.toString()}`, {
        headers: { 'User-Agent': REDDIT_UA },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as RedditSearchResponse;
      const postsRaw = (data?.data?.children ?? []).map((c) => c.data);

      const top15 = postsRaw.slice(0, 15);
      const postsText = top15
        .map((p, i) => `Post ${i + 1}:\nTitle: ${p.title}\nBody: ${(p.selftext ?? '').slice(0, 500)}`)
        .join('\n\n');

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: `Extract selling prices for "${query}" from these mechmarket posts. For each post that appears to be an actual sale listing with a price, return JSON array of {title, price_cents, sold_at_approx (ISO date string or null)}. Posts:\n\n${postsText}`,
            },
          ],
        }),
      });

      if (!anthropicRes.ok) return [];

      const anthropicData = (await anthropicRes.json()) as {
        content: { type: string; text: string }[];
      };
      const text = anthropicData.content?.find((c) => c.type === 'text')?.text ?? '';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return [];

      const parsed = JSON.parse(match[0]) as Array<{
        title: string;
        price_cents: number;
        sold_at_approx: string | null;
      }>;

      return parsed.map((item) => ({
        platform: 'reddit',
        title: item.title,
        soldPrice: item.price_cents,
        condition: '',
        url: 'https://www.reddit.com/r/mechmarket',
        soldAt: item.sold_at_approx ? new Date(item.sold_at_approx) : null,
      }));
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // PlatformSDK — Listings
  // --------------------------------------------------------------------------

  async createListing(
    listing: UnifiedListing,
  ): Promise<{ platformId: string; url: string }> {
    const supabase = getSupabaseAdmin();
    const creds = await getMechmarketCreds(this.userId);
    if (!creds) throw new AuthExpiredError('mechmarket');

    // Check cooldown
    const { data: recentPost } = await supabase
      .from('mechmarket_posts')
      .select('next_eligible_post_at')
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single<Pick<MechmarketPostRow, 'next_eligible_post_at'>>();

    if (recentPost?.next_eligible_post_at) {
      const nextEligible = new Date(recentPost.next_eligible_post_at);
      if (nextEligible > new Date()) {
        const msLeft = nextEligible.getTime() - Date.now();
        const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000));
        const minsLeft = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
        throw new CooldownError(
          'mechmarket',
          `Can post again in ${hoursLeft}h ${minsLeft}m`,
        );
      }
    }

    const auth = await this.getRedditAuth();
    const title = buildPostTitle(creds.usState, [listing.title]);
    const body = buildPostBody([
      {
        listing_id: listing.internalId,
        title: listing.title,
        price: listing.price,
        condition: listing.condition,
        description: listing.description,
        timestamp_photo_url: null,
        sort_order: 0,
        status: 'active',
      },
    ]);

    const submitRes = await this.redditPost(auth, '/api/submit', {
      api_type: 'json',
      sr: 'mechmarket',
      kind: 'self',
      title,
      text: body,
      sendreplies: 'true',
    });
    if (!submitRes.ok) throw new PlatformError('mechmarket', `Reddit submit failed: ${submitRes.status}`);
    const submitData = (await submitRes.json()) as RedditSubmitResponse;
    if (submitData.json.errors?.length) {
      throw new PlatformError('mechmarket', `Reddit submit error: ${JSON.stringify(submitData.json.errors)}`);
    }
    const post = submitData.json.data;

    const now = new Date();
    const nextEligible = new Date(now.getTime() + COOLDOWN_MS);

    const { data: postRow, error: postError } = await supabase
      .from('mechmarket_posts')
      .upsert(
        {
          user_id: this.userId,
          reddit_post_id: post.id,
          reddit_post_url: post.url,
          last_promoted_at: now.toISOString(),
          next_eligible_post_at: nextEligible.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: 'reddit_post_id' },
      )
      .select('id')
      .single<Pick<MechmarketPostRow, 'id'>>();

    if (postError || !postRow) {
      throw new Error(`Failed to upsert mechmarket_posts: ${postError?.message}`);
    }

    const { error: itemError } = await supabase
      .from('mechmarket_post_items')
      .insert({
        post_id: postRow.id,
        listing_id: listing.internalId,
        status: 'active',
        sort_order: 0,
      });

    if (itemError) {
      throw new Error(`Failed to insert mechmarket_post_items: ${itemError.message}`);
    }

    return { platformId: post.id, url: post.url };
  }

  async updateListing(
    platformId: string,
    _updates: Partial<UnifiedListing>,
  ): Promise<void> {
    const auth = await this.getRedditAuth();
    const newBody = await this.rebuildPostBody(platformId);
    await this.redditPost(auth, '/api/editusertext', {
      api_type: 'json',
      thing_id: `t3_${platformId}`,
      text: newBody,
    });
  }

  async deleteListing(platformId: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    const { data: postRow } = await supabase
      .from('mechmarket_posts')
      .select('id')
      .eq('reddit_post_id', platformId)
      .single<Pick<MechmarketPostRow, 'id'>>();

    if (!postRow) return;

    const { error: updateError } = await supabase
      .from('mechmarket_post_items')
      .update({ status: 'removed' })
      .eq('post_id', postRow.id);

    if (updateError) throw new PlatformError('mechmarket', `DB update failed: ${updateError.message}`);

    try {
      const auth = await this.getRedditAuth();
      const newBody = await this.rebuildPostBody(platformId);
      await this.redditPost(auth, '/api/editusertext', {
        api_type: 'json',
        thing_id: `t3_${platformId}`,
        text: newBody,
      });
    } catch {
      // Non-fatal — Reddit edit failure should not block the DB state change
    }
  }

  async getListing(platformId: string): Promise<PlatformListing> {
    const supabase = getSupabaseAdmin();

    const { data: postRow } = await supabase
      .from('mechmarket_posts')
      .select('*')
      .eq('reddit_post_id', platformId)
      .eq('user_id', this.userId)
      .single<MechmarketPostRow>();

    if (!postRow) {
      throw new Error(`mechmarket post not found: ${platformId}`);
    }

    const { data: items } = await supabase
      .from('mechmarket_post_items')
      .select('listing_id, status')
      .eq('post_id', postRow.id)
      .returns<Pick<MechmarketPostItemRow, 'listing_id' | 'status'>[]>();

    const activeItems = (items ?? []).filter((i) => i.status === 'active');
    const allSold = activeItems.length === 0 && (items ?? []).length > 0;

    return {
      platform: 'mechmarket',
      platformId,
      url: postRow.reddit_post_url,
      title: `mechmarket post ${platformId}`,
      price: 0,
      status: allSold ? 'sold' : 'active',
      createdAt: new Date(postRow.created_at),
      updatedAt: new Date(postRow.updated_at),
      raw: postRow as unknown as Record<string, unknown>,
    };
  }

  async getMyListings(filters?: { status?: string }): Promise<PlatformListing[]> {
    const supabase = getSupabaseAdmin();

    // Step 1: get this user's posts (enforces user isolation via explicit user_id filter)
    const { data: posts } = await supabase
      .from('mechmarket_posts')
      .select('id, reddit_post_id, reddit_post_url, created_at, updated_at')
      .eq('user_id', this.userId) as unknown as { data: Pick<MechmarketPostRow, 'id' | 'reddit_post_id' | 'reddit_post_url' | 'created_at' | 'updated_at'>[] | null };

    if (!posts || posts.length === 0) return [];

    const postIds = posts.map((p) => p.id);
    const postById = new Map(posts.map((p) => [p.id, p]));

    // Step 2: get items for those posts only
    let itemQuery = supabase
      .from('mechmarket_post_items')
      .select('post_id, listing_id, status')
      .in('post_id', postIds);

    if (filters?.status) itemQuery = itemQuery.eq('status', filters.status);

    const { data: items } = await itemQuery.returns<
      Pick<MechmarketPostItemRow, 'post_id' | 'listing_id' | 'status'>[]
    >();

    if (!items) return [];

    return items.map((item) => {
      const post = postById.get(item.post_id)!;
      return {
        platform: 'mechmarket',
        platformId: post.reddit_post_id,
        url: post.reddit_post_url,
        title: `listing ${item.listing_id}`,
        price: 0,
        status: item.status as PlatformListing['status'],
        createdAt: new Date(post.created_at),
        updatedAt: new Date(post.updated_at),
        raw: item as unknown as Record<string, unknown>,
      };
    });
  }

  // --------------------------------------------------------------------------
  // PlatformSDK — Orders
  // --------------------------------------------------------------------------

  async getOrders(_since?: Date): Promise<PlatformOrder[]> {
    return [];
  }

  async getOrder(_orderId: string): Promise<PlatformOrder> {
    throw new UnsupportedOperationError('mechmarket', 'getOrder');
  }

  async markShipped(_orderId: string, _tracking: TrackingInfo): Promise<void> {
    throw new UnsupportedOperationError('mechmarket', 'markShipped');
  }

  // --------------------------------------------------------------------------
  // PlatformSDK — Notifications
  // --------------------------------------------------------------------------

  async getNotifications(since?: Date): Promise<PlatformNotification[]> {
    const auth = await this.getRedditAuth();
    const res = await fetch(`${REDDIT_BASE}/message/unread.json`, {
      headers: this.redditHeaders(auth),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as RedditInboxResponse;
    const messages = (data?.data?.children ?? []).map((c) => c.data);

    return messages
      .filter((m) => !since || new Date(m.created_utc * 1000) > since)
      .map((m) => ({
        platform: 'mechmarket' as const,
        notificationId: m.name,
        type: 'message' as const,
        title: m.subject,
        preview: m.body?.slice(0, 200) ?? '',
        url: undefined,
        read: !m.new,
        createdAt: new Date(m.created_utc * 1000),
        metadata: { from: m.author ?? '' } as Record<string, unknown>,
      }));
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const auth = await this.getRedditAuth();
    await this.redditPost(auth, '/api/read_message', { id: notificationId });
  }

  // --------------------------------------------------------------------------
  // PlatformSDK — Messaging
  // --------------------------------------------------------------------------

  async getThreads(): Promise<PlatformThread[]> {
    const auth = await this.getRedditAuth();
    const res = await fetch(`${REDDIT_BASE}/message/messages.json`, {
      headers: this.redditHeaders(auth),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as RedditInboxResponse;
    const inboxRaw = (data?.data?.children ?? []).map((c) => c.data);

    // Group by thread root (first_message_name falls back to own name for root messages)
    const threadMap = new Map<string, RedditMessageData[]>();
    for (const msg of inboxRaw) {
      const threadId = msg.first_message_name || msg.name;
      if (!threadMap.has(threadId)) threadMap.set(threadId, []);
      threadMap.get(threadId)!.push(msg);
    }

    const threads: PlatformThread[] = [];
    for (const [threadId, msgs] of threadMap) {
      const sorted = msgs.sort((a, b) => b.created_utc - a.created_utc);
      const latest = sorted[0];
      const unread = msgs.filter((m) => m.new).length;

      const lastMsg: PlatformMessage = {
        platform: 'mechmarket',
        threadId,
        messageId: latest.name,
        from: latest.author ?? '',
        body: latest.body ?? '',
        sentAt: new Date(latest.created_utc * 1000),
        read: !latest.new,
      };

      threads.push({
        platform: 'mechmarket',
        threadId,
        withUser: latest.author ?? '',
        lastMessage: lastMsg,
        unreadCount: unread,
      });
    }

    return threads;
  }

  async getThread(threadId: string): Promise<PlatformMessage[]> {
    const auth = await this.getRedditAuth();
    const res = await fetch(`${REDDIT_BASE}/message/messages/${threadId}.json`, {
      headers: this.redditHeaders(auth),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as RedditInboxResponse;
    const msgs = (data?.data?.children ?? []).map((c) => c.data);

    return msgs.map((m) => ({
      platform: 'mechmarket' as const,
      threadId,
      messageId: m.name,
      from: m.author ?? '',
      body: m.body ?? '',
      sentAt: new Date(m.created_utc * 1000),
      read: !m.new,
    }));
  }

  async sendMessage(threadId: string, body: string): Promise<void> {
    const auth = await this.getRedditAuth();
    await this.redditPost(auth, '/api/comment', {
      api_type: 'json',
      parent: threadId,
      text: body,
    });
  }

  // --------------------------------------------------------------------------
  // Extra public methods
  // --------------------------------------------------------------------------

  /**
   * Upload a timestamp photo to Supabase Storage.
   * Returns the public URL.
   */
  async uploadTimestampPhoto(
    imageBuffer: Buffer,
    mimeType: string,
    listingId: string,
  ): Promise<string> {
    const ext = mimeType.split('/')[1] ?? 'jpg';
    const path = `${this.userId}/${listingId}/timestamp-${Date.now()}.${ext}`;
    return uploadFile(path, imageBuffer, mimeType);
  }

  /**
   * Add an item to an existing mechmarket post and update the post body.
   */
  async addItemToPost(
    redditPostId: string,
    listing: UnifiedListing,
    timestampPhotoUrl: string,
  ): Promise<void> {
    const supabase = getSupabaseAdmin();

    const { data: postRow } = await supabase
      .from('mechmarket_posts')
      .select('id')
      .eq('reddit_post_id', redditPostId)
      .single<Pick<MechmarketPostRow, 'id'>>();

    if (!postRow) throw new Error(`mechmarket post not found: ${redditPostId}`);

    const { data: existingItems } = await supabase
      .from('mechmarket_post_items')
      .select('sort_order')
      .eq('post_id', postRow.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .returns<Pick<MechmarketPostItemRow, 'sort_order'>[]>();

    const maxOrder = existingItems?.[0]?.sort_order ?? -1;

    await supabase.from('mechmarket_post_items').insert({
      post_id: postRow.id,
      listing_id: listing.internalId,
      timestamp_photo_url: timestampPhotoUrl,
      status: 'active',
      sort_order: maxOrder + 1,
    });

    const auth = await this.getRedditAuth();
    const newBody = await this.rebuildPostBody(redditPostId);
    await this.redditPost(auth, '/api/editusertext', {
      api_type: 'json',
      thing_id: `t3_${redditPostId}`,
      text: newBody,
    });
  }

  /**
   * Mark an item as sold in mechmarket_post_items and update the post body.
   */
  async markItemSold(redditPostId: string, listingId: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    const { data: postRow } = await supabase
      .from('mechmarket_posts')
      .select('id')
      .eq('reddit_post_id', redditPostId)
      .single<Pick<MechmarketPostRow, 'id'>>();

    if (!postRow) throw new Error(`mechmarket post not found: ${redditPostId}`);

    await supabase
      .from('mechmarket_post_items')
      .update({ status: 'sold' })
      .eq('post_id', postRow.id)
      .eq('listing_id', listingId);

    const auth = await this.getRedditAuth();
    const newBody = await this.rebuildPostBody(redditPostId);
    await this.redditPost(auth, '/api/editusertext', {
      api_type: 'json',
      thing_id: `t3_${redditPostId}`,
      text: newBody,
    });
  }
}
