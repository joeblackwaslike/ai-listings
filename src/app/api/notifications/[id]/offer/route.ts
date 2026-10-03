import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEbayCreds } from '@/lib/platforms/credentials';
import { EbayAdapter } from '@/lib/platforms/adapters/ebay';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body: { action: 'accept' | 'decline' | 'counter'; counterAmount?: number };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, counterAmount } = body;
  if (!['accept', 'decline', 'counter'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { data: notification, error: notifErr } = await supabase
    .from('notifications')
    .select('offer_id, platform')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (notifErr || !notification) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
  }

  if (notification.platform !== 'ebay') {
    return NextResponse.json({ error: 'Only eBay offers are supported' }, { status: 400 });
  }

  const offerId = notification.offer_id as string | null;
  if (!offerId) {
    return NextResponse.json({ error: 'No offer ID on this notification' }, { status: 400 });
  }

  const creds = await getEbayCreds(user.id);
  if (!creds) {
    return NextResponse.json({ error: 'eBay not connected' }, { status: 400 });
  }

  const adapter = new EbayAdapter(creds);
  await adapter.replyToOffer(offerId, action, counterAmount);

  // Mark the notification read so it leaves the unread list.
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  return NextResponse.json({ ok: true });
}
