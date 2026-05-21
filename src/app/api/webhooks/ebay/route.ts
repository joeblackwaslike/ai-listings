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

  const topic = body.metadata?.topic ?? '';
  const mappedType = TYPE_MAP[topic.toUpperCase()] ?? 'other';

  // Insert with user_id=null: webhook events arrive without session context.
  // A follow-up reconciliation job can match notificationId to a seller account.
  try {
    const supabase = getAdminClient();
    await supabase.from('notifications').insert({
      user_id: null,
      platform: 'ebay',
      type: mappedType,
      title: topic || 'eBay notification',
      preview: JSON.stringify(body.data ?? {}).slice(0, 200),
      metadata: { ...body, platformNotificationId: body.notificationId ?? `ebay-${Date.now()}` },
    });
  } catch (err) {
    // Log but return 200 — eBay retries on non-2xx which would cause duplicates
    console.error('eBay webhook insert error:', err);
  }

  return NextResponse.json({ received: true });
}
