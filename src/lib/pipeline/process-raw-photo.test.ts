import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { processRawPhoto } from './process-raw-photo'
import type { uploadFile } from '@/lib/storage'

async function tinyPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .jpeg()
    .toBuffer()
}

function fakeFetch(buffer: Buffer): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  })) as unknown as typeof fetch
}

function stubSupabaseUpdate(result: { data: Array<{ id: string }> | null; error: { message: string } | null }) {
  const calls: Array<{ table: string; values: unknown; eqCol: string; eqId: string }> = []
  const supabase = {
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: (eqCol: string, eqId: string) => ({
          select: (_cols: string) => {
            calls.push({ table, values, eqCol, eqId })
            return Promise.resolve(result)
          },
        }),
      }),
    }),
  }
  return { supabase: supabase as unknown as SupabaseClient, calls }
}

test('processRawPhoto: on success, uploads the cropped/denoised photo and writes processed_url to the matched photos row', async () => {
  const photoBuffer = await tinyPhoto()
  const { supabase, calls } = stubSupabaseUpdate({ data: [{ id: 'photo-1' }], error: null })
  const uploadCalls: Array<{ path: string; contentType: string }> = []
  const upload: typeof uploadFile = async (path, _body, contentType) => {
    uploadCalls.push({ path, contentType })
    return 'https://cdn.example.com/intake/listing-1/processed-photo-1.jpg'
  }

  await processRawPhoto(
    'photo-1',
    'https://storage.example.com/raw.jpg',
    'intake/listing-1/processed-photo-1.png',
    { supabase, fetchPhoto: fakeFetch(photoBuffer), upload }
  )

  assert.equal(uploadCalls.length, 1)
  assert.equal(uploadCalls[0].path, 'intake/listing-1/processed-photo-1.png')
  assert.equal(uploadCalls[0].contentType, 'image/jpeg')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].table, 'photos')
  assert.deepEqual(calls[0].values, {
    processed_url: 'https://cdn.example.com/intake/listing-1/processed-photo-1.jpg',
  })
  assert.equal(calls[0].eqId, 'photo-1')
})

test('processRawPhoto: throws when the update matches zero photos rows, instead of silently orphaning the uploaded file', async () => {
  const photoBuffer = await tinyPhoto()
  const { supabase } = stubSupabaseUpdate({ data: [], error: null })
  const upload: typeof uploadFile = async () => 'https://cdn.example.com/orphaned.jpg'

  await assert.rejects(
    () =>
      processRawPhoto(
        'missing-photo',
        'https://storage.example.com/raw.jpg',
        'intake/listing-1/processed.png',
        { supabase, fetchPhoto: fakeFetch(photoBuffer), upload }
      ),
    /no photos row matched id missing-photo/
  )
})

test('processRawPhoto: propagates an upload failure without attempting the photos row update', async () => {
  const photoBuffer = await tinyPhoto()
  const { supabase, calls } = stubSupabaseUpdate({ data: [{ id: 'photo-1' }], error: null })
  const upload: typeof uploadFile = async () => {
    throw new Error('R2 upload failed (500): boom')
  }

  await assert.rejects(
    () =>
      processRawPhoto(
        'photo-1',
        'https://storage.example.com/raw.jpg',
        'intake/listing-1/processed.png',
        { supabase, fetchPhoto: fakeFetch(photoBuffer), upload }
      ),
    /R2 upload failed/
  )
  assert.equal(calls.length, 0)
})
