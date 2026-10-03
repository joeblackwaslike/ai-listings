import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEbayCreds } from '@/lib/platforms/credentials';
import { EbayAdapter } from '@/lib/platforms/adapters/ebay';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { platform: string; threadId: string; body: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { platform, threadId, body: messageBody } = body;
  if (!platform || !threadId || !messageBody?.trim()) {
    return NextResponse.json({ error: 'Missing platform, threadId, or body' }, { status: 400 });
  }

  if (platform !== 'ebay') {
    return NextResponse.json({ error: 'Only eBay messaging is currently supported' }, { status: 400 });
  }

  const creds = await getEbayCreds(user.id);
  if (!creds) {
    return NextResponse.json({ error: 'eBay not connected' }, { status: 400 });
  }

  const adapter = new EbayAdapter(creds);
  await adapter.sendMessage(threadId, messageBody);

  // Record the outbound message so it shows up in the thread UI immediately.
  const { data: newMsg } = await supabase
    .from('messages')
    .insert({
      user_id: user.id,
      platform,
      thread_id: threadId,
      message_id: `outbound-${Date.now()}`,
      direction: 'outbound',
      from_username: 'me',
      body: messageBody,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  return NextResponse.json({ ok: true, message: newMsg });
}
