import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function verifyEbaySignature(rawBody: Buffer, signature: string, clientSecret: string): boolean {
  if (!signature || !clientSecret) return false;
  const expectedBuf = createHmac('sha256', clientSecret).update(rawBody).digest();
  const sigBuf = Buffer.from(signature, 'base64');
  if (expectedBuf.length !== sigBuf.length) return false;
  try {
    return timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}

/** Find the user_id of the eBay-connected seller by looking up user_settings. */
async function resolveEbayUserId(): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('key', 'ebay_refresh_token')
    .not('value', 'is', null)
    .neq('value', '')
    .limit(1)
    .single();
  return data?.user_id ?? null;
}

interface EbayWebhookBody {
  challenge?: string;
  notificationId?: string;
  metadata?: { topic?: string };
  data?: Record<string, unknown>;
}

const TYPE_MAP: Record<string, string> = {
  'ITEM_SOLD': 'item_sold',
  'FIXED_PRICE_TRANSACTION': 'order_placed',
  'BEST_OFFER': 'offer_received',
  'MESSAGE_CREATED': 'listing_question',
  'AUTHENTICITY_GUARANTEE_STATUS_CHANGED': 'authenticity_update',
  'ITEM_FLAGGED_AS_INAUTHENTIC': 'authenticity_alert',
};

// eBay endpoint verification: GET with ?challenge_code=<token>
// Response must be sha256(challengeCode + verificationToken + endpoint)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const challengeCode = req.nextUrl.searchParams.get('challenge_code');
  if (!challengeCode) return NextResponse.json({ error: 'Missing challenge_code' }, { status: 400 });

  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN ?? '';
  const endpoint = process.env.EBAY_WEBHOOK_ENDPOINT ?? req.url.split('?')[0];
  if (!verificationToken) {
    return NextResponse.json({ error: 'Webhook verification token not configured' }, { status: 500 });
  }

  const challengeResponse = createHash('sha256')
    .update(challengeCode + verificationToken + endpoint)
    .digest('hex');

  return NextResponse.json({ challengeResponse });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET ?? '';

  if (!EBAY_CLIENT_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-ebay-signature') ?? '';

  if (!verifyEbaySignature(rawBody, signature, EBAY_CLIENT_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: EbayWebhookBody;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as EbayWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.challenge) {
    return NextResponse.json({ challengeResponse: body.challenge });
  }

  const topic = (body.metadata?.topic ?? '').toUpperCase();
  const mappedType = TYPE_MAP[topic] ?? 'other';
  const data = body.data ?? {};

  // Resolve the seller user_id — without it the notification is invisible.
  const userId = await resolveEbayUserId();
  if (!userId) {
    console.warn('[ebay webhook] no eBay-connected user found — discarding event', topic);
    return NextResponse.json({ received: true });
  }

  // Build topic-specific fields.
  let title = topic || 'eBay notification';
  let preview = JSON.stringify(data).slice(0, 200);
  let offerFields: Record<string, unknown> = {};

  if (topic === 'BEST_OFFER') {
    const buyer = (data.buyerUsername as string | undefined) ?? 'buyer';
    const amount = parseFloat((data.price as { value?: string } | undefined)?.value ?? '0');
    const offerId = (data.bestOfferId as string | undefined) ?? '';
    const expiresAt = (data.expirationDate as string | undefined)
      ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    title = `Offer from ${buyer}`;
    preview = `$${amount.toFixed(2)} · expires ${new Date(expiresAt).toLocaleString()}`;
    offerFields = {
      offer_id: offerId,
      offer_amount: amount,
      offer_expires_at: expiresAt,
      buyer_username: buyer,
    };
  } else if (topic === 'MESSAGE_CREATED') {
    const sender = (data.sender as { username?: string } | undefined)?.username ?? 'buyer';
    const msgPreview = (data.body as string | undefined)?.slice(0, 100) ?? '';
    title = `Message from ${sender}`;
    preview = msgPreview;
  } else if (topic === 'AUTHENTICITY_GUARANTEE_STATUS_CHANGED') {
    const status = (data.status as string | undefined) ?? 'UNKNOWN';
    title = `Authenticity check: ${status}`;
    preview = `Item ${data.itemId as string | undefined ?? ''} — ${status}`;
  } else if (topic === 'ITEM_FLAGGED_AS_INAUTHENTIC') {
    title = 'Item flagged as inauthentic';
    preview = `Item ${data.itemId as string | undefined ?? ''} reported inauthentic`;
  }

  try {
    const supabase = getAdminClient();
    await supabase.from('notifications').insert({
      user_id: userId,
      platform: 'ebay',
      type: mappedType,
      title,
      preview,
      metadata: { ...data, platformNotificationId: body.notificationId ?? `ebay-${Date.now()}` },
      ...offerFields,
    });
  } catch (err) {
    // Log but return 200 — eBay retries on non-2xx which would cause duplicates
    console.error('eBay webhook insert error:', err);
  }

  return NextResponse.json({ received: true });
}
