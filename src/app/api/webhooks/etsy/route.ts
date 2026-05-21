import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

function verifyEtsySignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expectedBuf = createHmac('sha256', secret).update(payload).digest();
  const sigBuf = Buffer.from(signature, 'base64');
  if (expectedBuf.length !== sigBuf.length) return false;
  try {
    return timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}

interface EtsyWebhookBody {
  event_type?: string;
  receipt_id?: number | string;
  [key: string]: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ETSY_WEBHOOK_SECRET = process.env.ETSY_WEBHOOK_SECRET ?? '';
  const rawBody = await req.text();
  const signature = req.headers.get('x-etsy-signature') ?? '';

  if (!ETSY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  if (!verifyEtsySignature(rawBody, signature, ETSY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: EtsyWebhookBody;
  try {
    body = JSON.parse(rawBody) as EtsyWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  switch (body.event_type) {
    case 'RECEIPT_CREATED':
      console.log('new Etsy order: ' + body.receipt_id);
      break;
    default:
      break;
  }

  return NextResponse.json({ ok: true });
}
