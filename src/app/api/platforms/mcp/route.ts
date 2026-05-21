import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PLATFORM_TOOLS, dispatchToolCall } from '@/lib/platforms/mcp-server';

function getSupabaseBrowserClient(req: NextRequest) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
}

// GET /api/platforms/mcp — list available tools
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ tools: PLATFORM_TOOLS });
}

// POST /api/platforms/mcp — dispatch a tool call
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseBrowserClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as { name?: string; input?: Record<string, unknown> };
  if (!body.name || !body.input) {
    return NextResponse.json({ error: 'name and input are required' }, { status: 400 });
  }

  // Inject authenticated user_id — callers cannot override it
  const input = { ...body.input, user_id: user.id };

  try {
    const result = await dispatchToolCall({ name: body.name, input });
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
