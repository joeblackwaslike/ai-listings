import type { SupabaseClient } from '@supabase/supabase-js'
import { streamAgentResponse } from '@/lib/agent/chat'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { createClient } from '@/lib/supabase/server'
import type { ApiKeys } from '@/lib/user-api-keys'
import { getUserApiKeys } from '@/lib/user-api-keys'

export interface AgentPostDeps {
  streamAgentResponse: typeof streamAgentResponse
  getUserApiKeys: typeof getUserApiKeys
}

const defaultPostDeps: AgentPostDeps = { streamAgentResponse, getUserApiKeys }

export async function handleAgentPost(
  sessionClient: SupabaseClient,
  listingId: string,
  req: Request,
  deps: AgentPostDeps = defaultPostDeps
) {
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: listing } = await sessionClient
    .from('listings')
    .select('id')
    .eq('id', listingId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!listing) return Response.json({ error: 'Not found' }, { status: 404 })

  let apiKeys: ApiKeys
  try {
    apiKeys = await deps.getUserApiKeys(user.id)
  } catch {
    return Response.json({ error: 'Failed to load API keys' }, { status: 500 })
  }

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
        await deps.streamAgentResponse(listingId, message, (event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }, apiKeys)
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

export async function handleAgentGet(sessionClient: SupabaseClient, supabase: SupabaseClient, listingId: string) {
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: listing } = await supabase
    .from('listings')
    .select('id')
    .eq('id', listingId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!listing) return Response.json({ error: 'Not found' }, { status: 404 })

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params
  return handleAgentPost(await createClient(), listingId, req)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params
  return handleAgentGet(await createClient(), getSupabaseAdmin(), listingId)
}
