import { NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'

export async function POST(request: Request) {
  const body = (await request.json()) as {
    listingId?: string
    confirmed?: boolean
    corrections?: string | null
  }

  if (!body.listingId || body.confirmed === undefined) {
    return NextResponse.json(
      { error: 'listingId and confirmed are required' },
      { status: 400 }
    )
  }

  await inngest.send({
    name: 'pipeline/id-confirmed',
    data: {
      listingId: body.listingId,
      confirmed: body.confirmed,
      corrections: body.corrections ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
