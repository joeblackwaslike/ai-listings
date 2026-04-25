import { streamAgentResponse } from '@/lib/agent/chat'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params

  let body: { message?: string }
  try {
    body = await req.json() as { message?: string }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
    return Response.json({ error: 'message is required' }, { status: 400 })
  }

  const message = body.message.trim()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await streamAgentResponse(listingId, message, (event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        })
      } finally {
        controller.close()
      }
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
