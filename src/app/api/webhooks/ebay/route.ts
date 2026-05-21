import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function verifyEbaySignature(rawBody: Buffer, signature: string, clientSecret: string): boolean {
  if (!signature || !clientSecret) return false;
  const expected = createHmac('sha256', clientSecret).update(rawBody).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// eBay notification type shapes (minimal)
interface EbayWebhookBody {
  challenge?: string;
  notificationId?: string;
  metadata?: {
    topic?: string;
    schemaVersion?: string;
    deprecated?: boolean;
  };
  data?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Signature verification ---
  // eBay signs webhook payloads with HMAC-SHA256 using the client secret.
  // We verify before processing to prevent spoofed notifications.
  const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET ?? '';
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-ebay-signature') ?? '';

  if (!verifyEbaySignature(rawBody, signature, EBAY_CLIENT_SECRET)) {
    if (!EBAY_CLIENT_SECRET) {
      // TODO: set EBAY_CLIENT_SECRET in env to enable signature verification
      console.warn('eBay webhook: EBAY_CLIENT_SECRET not set — skipping signature verification');
    } else {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let body: EbayWebhookBody;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as EbayWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // eBay endpoint verification challenge — must respond with challengeResponse
  if (body.challenge) {
    return NextResponse.json({ challengeResponse: body.challenge });
  }

  const notifType = body.metadata?.topic ?? body.notificationId ?? 'other';

  try {
    const supabase = await createClient();

    // Map eBay topic to our notification type
    const typeMap: Record<string, string> = {
      'MARKETPLACE_ACCOUNT_DELETION': 'other',
      'ITEM_SOLD': 'order',
      'FIXED_PRICE_TRANSACTION': 'order',
      'FEEDBACK_LEFT': 'other',
      'BEST_OFFER': 'offer',
      'CHECKOUT_BUYER_REQUESTS_TOTAL': 'order',
      'MESSAGE_CREATED': 'message',
      'SHIPPING_FULFILLMENT': 'shipped',
    };

    const mappedType = typeMap[notifType.toUpperCase()] ?? 'other';

    // Insert into notifications table — userId resolution requires matching the
    // seller's eBay account to a user record (handled in a follow-up).
    await supabase.from('notifications').insert({
      platform: 'ebay',
      notification_id: body.notificationId ?? `ebay-${Date.now()}`,
      type: mappedType,
      title: notifType,
      preview: JSON.stringify(body.data ?? {}).slice(0, 200),
      read: false,
      metadata: body as Record<string, unknown>,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Log but don't fail — eBay requires a 200 response or it will retry
    console.error('eBay webhook insert error:', err);
  }

  return NextResponse.json({ received: true });
}
