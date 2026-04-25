import { streamAgentResponse } from '@/lib/agent/chat'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params
  const body = await req.json() as { message?: string }

  if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
    return Response.json({ error: 'message is required' }, { status: 400 })
  }

  const message = body.message.trim()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      await streamAgentResponse(listingId, message, (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, role, content, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ conversations: data ?? [] })
}
