import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uploadStudioPhotos } from './upload-studio-photos'

const img = (name: string, type = 'image/jpeg') => new File(['x'], name, { type })

function fakeFetch(respond: (n: number) => Response) {
  const calls: FormData[] = []
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(init.body as FormData)
    return respond(calls.length)
  }) as unknown as typeof fetch
  return { calls, impl }
}

const ok = (n: number) => Response.json({ photoUrl: `u${n}` })

test('posts files in order with displayOrder = startOrder + i', async () => {
  const { calls, impl } = fakeFetch(ok)
  const urls = await uploadStudioPhotos('L1', [img('a.jpg'), img('b.jpg')], 3, { fetchImpl: impl })
  assert.deepEqual(urls, ['u1', 'u2'])
  assert.deepEqual(calls.map((f) => (f.get('photo') as File).name), ['a.jpg', 'b.jpg'])
  assert.deepEqual(calls.map((f) => f.get('displayOrder')), ['3', '4'])
  assert.equal(calls[0].get('listingId'), 'L1')
})

test('calls onProgress after each file', async () => {
  const { impl } = fakeFetch(ok)
  const seen: Array<[number, number]> = []
  await uploadStudioPhotos('L1', [img('a.jpg'), img('b.jpg')], 0, {
    fetchImpl: impl, onProgress: (d, t) => seen.push([d, t]),
  })
  assert.deepEqual(seen, [[1, 2], [2, 2]])
})

test('rejects with body.error on non-OK', async () => {
  const { impl } = fakeFetch(() => Response.json({ error: 'x' }, { status: 500 }))
  await assert.rejects(uploadStudioPhotos('L1', [img('a.jpg')], 0, { fetchImpl: impl }), { message: 'x' })
})

test('skips non-image files', async () => {
  const { calls, impl } = fakeFetch(ok)
  const urls = await uploadStudioPhotos('L1', [img('n.txt', 'text/plain'), img('a.jpg')], 0, { fetchImpl: impl })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].get('displayOrder'), '0')
  assert.deepEqual(urls, ['u1'])
})

test('non-JSON error body falls back to status message', async () => {
  const { impl } = fakeFetch(() => new Response('<html>', { status: 500 }))
  await assert.rejects(uploadStudioPhotos('L1', [img('a.jpg')], 0, { fetchImpl: impl }), { message: 'Upload failed (500)' })
})
