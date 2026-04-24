import { NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'

export async function POST(request: Request) {
  const body = (await request.json()) as { listingId?: string; step?: number }

  if (!body.listingId || body.step === undefined) {
    return NextResponse.json(
      { error: 'listingId and step are required' },
      { status: 400 }
    )
  }

  await inngest.send({
    name: 'pipeline/retry-step',
    data: {
      listingId: body.listingId,
      step: body.step,
    },
  })

  return NextResponse.json({ ok: true })
}
